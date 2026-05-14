import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { pool, testConnection, closePool } from "./db.js";
import { sendAlertEmail, isEmailConfigured } from "./email.js";
import QRCode from "qrcode";
import alertRoutes from "./routes/alertRoutes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const app = express();
const port = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || "soberwatch_secret_key_change_in_production";

/** Ensures email-notification table exists (older DBs may be missing it). */
async function ensureNotificationSettingsSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_settings (
        id SERIAL PRIMARY KEY,
        device_id VARCHAR(50) NOT NULL DEFAULT 'all',
        email VARCHAR(255) NOT NULL,
        alert_types VARCHAR(20)[] NOT NULL DEFAULT '{"WARNING","DANGER"}',
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      ALTER TABLE notification_settings
      ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE;
    `);
  } catch (e) {
    console.error("ensureNotificationSettingsSchema:", e.message);
  }
}

function pgErrorPayload(err, fallbackMessage) {
  return {
    error: fallbackMessage,
    detail: err?.message || String(err),
    code: err?.code,
  };
}

// Store QR authentication tokens in memory (in production, use Redis or database)
const qrAuthTokens = new Map();

// Single device ID for testing
const SINGLE_DEVICE_ID = "DEVICE-001";

// Generate realistic mock alcohol level for testing
function generateMockAlcoholLevel() {
  // Generate values between 0.000 and 0.100 with some randomness
  // Bias towards lower values but occasionally high values for testing
  const random = Math.random();
  if (random < 0.6) {
    // 60% chance of SAFE (0.000 - 0.019)
    return (Math.random() * 0.019).toFixed(3);
  } else if (random < 0.9) {
    // 30% chance of WARNING (0.020 - 0.049)
    return (0.020 + Math.random() * 0.029).toFixed(3);
  } else {
    // 10% chance of DANGER (0.050 - 0.100)
    return (0.050 + Math.random() * 0.050).toFixed(3);
  }
}

function parseOriginList(envValue) {
  if (!envValue || typeof envValue !== "string") return [];
  return envValue
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

const allowedOrigins = [
  ...parseOriginList(process.env.CLIENT_ORIGINS),
  ...parseOriginList(process.env.ALLOWED_ORIGINS),
  process.env.CLIENT_ORIGIN,
  "http://localhost:8080",
  "http://localhost:8081",
  "http://localhost:8082",
  "http://localhost:8083",
  "http://localhost:8084",
  "http://localhost:8085",
  "http://localhost:5173",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:8081",
  "http://127.0.0.1:8082",
  "http://127.0.0.1:8083",
  "http://127.0.0.1:8084",
  "http://127.0.0.1:8085",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:54670",
  "https://sober-watch.onrender.com",
  "https://frontend.onrender.com",
  "https://frontend-9wly.onrender.com",
].filter(Boolean);

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    if (hostname === "localhost" || hostname === "127.0.0.1") return true;
    // Vite "Network" URL (phone / another PC on LAN)
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

// Never use callback(null, false) — cors treats !origin as failure and calls next(err), which hits
// the global error handler and becomes 500 "Internal server error" (including on POST /api/auth/signup).
app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedCorsOrigin(origin)) {
        return callback(null, true);
      }
      if (process.env.NODE_ENV !== "production") {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
    maxAge: 86_400,
  })
);
app.use(express.json());

// Alert routes for gas monitoring
app.use("/api", alertRoutes);

// Root endpoint - returns backend status
app.get("/", (_req, res) => {
  res.json({
    status: "OK",
    message: "Backend is running successfully"
  });
});

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({ status: "OK" });
});

// Server info for QR code (returns frontend URL on local network)
app.get("/api/server-info", (_req, res) => {
  const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:8080";
  res.json({
    frontend_url: clientOrigin,
    api_url: `http://localhost:${port}`,
    message: "Use this URL for QR code on local network"
  });
});

function classifyAlcohol(level) {
  if (level >= 0.05) return "DANGER";
  if (level >= 0.02) return "WARNING";
  return "SAFE";
}

// Baseline Auto-Learning: incrementally update per-device mean & stddev using Welford's algorithm
async function updateBaseline(deviceId, alcoholLevel) {
  try {
    const existing = await pool.query(
      "SELECT mean_level, std_dev, sample_count FROM device_baselines WHERE device_id = $1",
      [deviceId]
    );

    if (existing.rows.length === 0) {
      // First reading for this device — seed the baseline
      await pool.query(
        `INSERT INTO device_baselines (device_id, mean_level, std_dev, sample_count, last_reading, updated_at)
         VALUES ($1, $2, 0, 1, $2, CURRENT_TIMESTAMP)`,
        [deviceId, alcoholLevel]
      );
    } else {
      const row = existing.rows[0];
      const n = Number(row.sample_count);
      const oldMean = Number(row.mean_level);
      const newN = n + 1;
      const newMean = oldMean + (alcoholLevel - oldMean) / newN;
      // Welford's online variance: update M2 then derive stddev
      const oldVar = Number(row.std_dev) ** 2;
      const newVar = oldVar + (alcoholLevel - oldMean) * (alcoholLevel - newMean);
      const newStdDev = newN > 1 ? Math.sqrt(newVar / (newN - 1)) : 0;

      await pool.query(
        `UPDATE device_baselines
         SET mean_level = $2, std_dev = $3, sample_count = $4, last_reading = $5, updated_at = CURRENT_TIMESTAMP
         WHERE device_id = $1`,
        [deviceId, newMean, newStdDev, newN, alcoholLevel]
      );
    }
  } catch (err) {
    console.error("Baseline update error:", err.message);
  }
}

// Get baseline info for a device (returns { mean, stdDev, sampleCount, deviation } or null)
async function getBaselineInfo(deviceId, alcoholLevel) {
  try {
    const result = await pool.query(
      "SELECT mean_level, std_dev, sample_count, deviation_threshold FROM device_baselines WHERE device_id = $1",
      [deviceId]
    );
    if (result.rows.length === 0 || Number(result.rows[0].sample_count) < 5) {
      return null; // Not enough data for meaningful baseline
    }
    const row = result.rows[0];
    const mean = Number(row.mean_level);
    const stdDev = Number(row.std_dev);
    const deviation = stdDev > 0 ? (alcoholLevel - mean) / stdDev : 0;
    return { mean, stdDev, sampleCount: Number(row.sample_count), deviation, threshold: Number(row.deviation_threshold) };
  } catch {
    return null;
  }
}

// Automatically archive alerts older than 5 minutes to history table
// Single statement = one implicit transaction (works with Supabase transaction pooler / PgBouncer).
async function archiveOldAlerts() {
  try {
    const result = await pool.query(`
      WITH to_archive AS (
        DELETE FROM alerts
        WHERE created_at < NOW() - INTERVAL '5 minutes'
        RETURNING log_id, device_id, alcohol_level, status, acknowledged, acknowledged_at, acknowledged_by, created_at
      )
      INSERT INTO alerts_history (log_id, device_id, alcohol_level, status, acknowledged, acknowledged_at, acknowledged_by, created_at)
      SELECT log_id, device_id, alcohol_level, status, acknowledged, acknowledged_at, acknowledged_by, created_at
      FROM to_archive
      RETURNING id;
    `);
    const count = result.rowCount;
    if (count > 0) {
      console.log(`[Archive] ${count} alert(s) moved to history`);
    }
  } catch (err) {
    console.error("Archive alerts error:", err);
  }
}

// Audit logging helper
async function auditLog(action, entityType, entityId, userId, userEmail, details, ipAddress) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, user_email, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, userEmail, action, entityType, entityId, details, ipAddress]
    );
  } catch (err) {
    console.error("Audit log error:", err);
  }
}

/** When JWT auth is off, audit entries use anonymous actor. */
function auditActor(req) {
  const u = req.user;
  return { id: u?.id ?? null, email: u?.email ?? "anonymous" };
}

function parseCredentials(body) {
  const emailRaw = body?.email;
  const passwordRaw = body?.password;
  if (typeof emailRaw !== "string" || typeof passwordRaw !== "string") {
    return { error: "Email and password are required" };
  }
  const email = emailRaw.trim().toLowerCase();
  if (!email || !passwordRaw) {
    return { error: "Email and password are required" };
  }
  return { email, password: passwordRaw };
}

async function verifyPassword(plain, passwordHash) {
  if (typeof passwordHash !== "string" || passwordHash.length < 10) {
    return false;
  }
  try {
    return await bcrypt.compare(plain, passwordHash);
  } catch {
    return false;
  }
}

// Auth: Signup — stores bcrypt-hashed password in PostgreSQL (first user becomes admin)
app.post("/api/auth/signup", async (req, res) => {
  const parsed = parseCredentials(req.body);
  if ("error" in parsed) {
    return res.status(400).json({ error: parsed.error });
  }
  const { email, password } = parsed;

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const countResult = await pool.query("SELECT COUNT(*)::int AS c FROM users");
    const isFirstUser = Number(countResult.rows[0]?.c ?? 0) === 0;
    const role = isFirstUser ? "admin" : "user";

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const result = await pool.query(
      "INSERT INTO users (email, password, role) VALUES ($1, $2, $3) RETURNING id, email, role",
      [email, hashedPassword, role]
    );
    const user = result.rows[0];

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });

    await auditLog(
      "user_signup",
      "user",
      user.id,
      user.id,
      user.email,
      "New account registered",
      req.ip || req.socket.remoteAddress
    );

    return res.status(201).json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    console.error("Signup error:", err);
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Email already registered" });
    }
    return res.status(500).json({ error: "Failed to create user" });
  }
});

// Auth: Login
app.post("/api/auth/login", async (req, res) => {
  const parsed = parseCredentials(req.body);
  if ("error" in parsed) {
    return res.status(400).json({ error: parsed.error });
  }
  const { email, password } = parsed;

  try {
    const result = await pool.query("SELECT id, email, password, role FROM users WHERE email = $1", [email]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const validPassword = await verifyPassword(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Generate token
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });

    await auditLog(
      "user_login",
      "user",
      user.id,
      user.id,
      user.email,
      "User logged in",
      req.ip || req.socket.remoteAddress
    );

    return res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/logs", async (req, res) => {
  let { device_id, alcohol_level, timestamp } = req.body ?? {};
  
  // Use single device ID if not provided
  if (!device_id) {
    device_id = SINGLE_DEVICE_ID;
  }

  // Only use mock data if no value is provided at all
  if (alcohol_level === undefined || alcohol_level === null || alcohol_level === "") {
    alcohol_level = generateMockAlcoholLevel();
  }

  const numericLevel = Number(alcohol_level);
  if (Number.isNaN(numericLevel) || numericLevel < 0) {
    return res.status(400).json({ error: "alcohol_level must be a valid non-negative number" });
  }

  const status = classifyAlcohol(numericLevel);
  const query = `
    INSERT INTO logs (device_id, alcohol_level, status, timestamp)
    VALUES ($1, $2, $3, COALESCE($4, CURRENT_TIMESTAMP))
    RETURNING id, device_id, alcohol_level, status, timestamp
  `;
  const values = [device_id, numericLevel, status, timestamp ?? null];

  const result = await pool.query(query, values);
  const logEntry = result.rows[0];

  // Update baseline auto-learning
  await updateBaseline(device_id, numericLevel);

  // Get baseline info for deviation detection and email
  const baselineInfo = await getBaselineInfo(device_id, numericLevel);

  // Add baseline deviation info to response
  if (baselineInfo) {
    logEntry.baseline = baselineInfo;
    if (baselineInfo.deviation >= baselineInfo.threshold && status === "SAFE") {
      logEntry.baseline_anomaly = true;
    }
  }

  // Create alert if status is WARNING or DANGER
  if (status === "WARNING" || status === "DANGER") {
    const alertQuery = `
      INSERT INTO alerts (log_id, device_id, alcohol_level, status)
      VALUES ($1, $2, $3, $4)
      RETURNING id, log_id, device_id, alcohol_level, status, acknowledged, created_at
    `;
    const alertValues = [logEntry.id, device_id, numericLevel, status];
    const alertResult = await pool.query(alertQuery, alertValues);
    logEntry.alert = alertResult.rows[0];

    // Send email alert (async, non-blocking)
    const baselineMean = baselineInfo ? baselineInfo.mean : null;
    const baselineDeviation = baselineInfo ? baselineInfo.deviation : null;
    sendAlertEmail(device_id, numericLevel, status, baselineMean, baselineDeviation).catch(() => {});
  }

  return res.status(201).json(logEntry);
});

app.get("/api/logs", async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, device_id, alcohol_level, status, timestamp FROM logs ORDER BY timestamp DESC"
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Get logs error:", err);
    return res.status(500).json(pgErrorPayload(err, "Failed to fetch logs"));
  }
});

// ─── Weekly / Monthly Report API ───────────────────────────────────────────

// GET /api/reports/weekly?year=2026&month=5&device=DEVICE-001
// Returns totals per status + per-device breakdown for the specified month
app.get("/api/reports/weekly", async (req, res) => {
  try {
    const { year, month, device } = req.query;
    if (!year || !month) {
      return res.status(400).json({ error: "year and month query params are required" });
    }
    const y = Number(year);
    const m = Number(month);
    if (Number.isNaN(y) || Number.isNaN(m) || m < 1 || m > 12) {
      return res.status(400).json({ error: "Invalid year or month" });
    }

    // Build date range for the entire month
    const startDate = new Date(y, m - 1, 1);
    const endDate = new Date(y, m, 1); // first day of next month (exclusive)

    let baseQuery = `
      SELECT device_id, status, COUNT(*)::integer AS count
      FROM logs
      WHERE timestamp >= $1 AND timestamp < $2
    `;
    let params = [startDate.toISOString(), endDate.toISOString()];

    if (device) {
      baseQuery += ` AND device_id = $3`;
      params.push(device);
    }

    baseQuery += ` GROUP BY device_id, status ORDER BY device_id, status`;

    const result = await pool.query(baseQuery, params);

    // Aggregate per device and overall
    const perDevice = {};
    let overall = { SAFE: 0, WARNING: 0, DANGER: 0, total: 0 };

    for (const row of result.rows) {
      const dev = row.device_id;
      const status = row.status;
      const count = Number(row.count);

      if (!perDevice[dev]) {
        perDevice[dev] = { SAFE: 0, WARNING: 0, DANGER: 0, total: 0 };
      }
      perDevice[dev][status] = count;
      perDevice[dev].total += count;
      overall[status] += count;
      overall.total += count;
    }

    return res.json({
      period: { year: y, month: m, startDate: startDate.toISOString(), endDate: endDate.toISOString() },
      overall,
      perDevice,
    });
  } catch (err) {
    console.error("Weekly report error:", err);
    return res.status(500).json(pgErrorPayload(err, "Failed to generate weekly report"));
  }
});

// GET /api/reports/monthly?year=2026&device=DEVICE-001
// Returns monthly totals across all months or per-device per month
app.get("/api/reports/monthly", async (req, res) => {
  try {
    const { year, device } = req.query;
    if (!year) {
      return res.status(400).json({ error: "year query param is required" });
    }
    const y = Number(year);
    if (Number.isNaN(y)) {
      return res.status(400).json({ error: "Invalid year" });
    }

    let baseQuery = `
      SELECT DATE_TRUNC('month', timestamp) AS month, device_id, status, COUNT(*)::integer AS count
      FROM logs
      WHERE EXTRACT(YEAR FROM timestamp) = $1
    `;
    let params = [y];

    if (device) {
      baseQuery += ` AND device_id = $2`;
      params.push(device);
    }

    baseQuery += ` GROUP BY DATE_TRUNC('month', timestamp), device_id, status ORDER BY month, device_id`;

    const result = await pool.query(baseQuery, params);

    const perMonth = {};

    for (const row of result.rows) {
      const monthKey = new Date(row.month).toISOString().slice(0, 7); // "YYYY-MM"
      const dev = row.device_id;
      const status = row.status;
      const count = Number(row.count);

      if (!perMonth[monthKey]) {
        perMonth[monthKey] = { devices: {}, overall: { SAFE: 0, WARNING: 0, DANGER: 0, total: 0 } };
      }
      if (!perMonth[monthKey].devices[dev]) {
        perMonth[monthKey].devices[dev] = { SAFE: 0, WARNING: 0, DANGER: 0, total: 0 };
      }
      perMonth[monthKey].devices[dev][status] = count;
      perMonth[monthKey].devices[dev].total += count;
      perMonth[monthKey].overall[status] += count;
      perMonth[monthKey].overall.total += count;
    }

    return res.json({ year: y, perMonth });
  } catch (err) {
    console.error("Monthly report error:", err);
    return res.status(500).json(pgErrorPayload(err, "Failed to generate monthly report"));
  }
});

app.get("/api/public/logs", async (req, res) => {
  const { device } = req.query;
  let query = `
    SELECT device_id, alcohol_level, status, timestamp
    FROM logs
  `;
  let params = [];
  
  if (device) {
    query += " WHERE device_id = $1";
    params.push(device);
  }
  
  query += " ORDER BY timestamp DESC LIMIT 50";
  
  const result = await pool.query(query, params);
  return res.json(result.rows);
});

app.get("/api/alerts", async (req, res) => {
  try {
    const { acknowledged } = req.query;
    let query = `
    SELECT id, log_id, device_id, alcohol_level, status, acknowledged, acknowledged_at, acknowledged_by, created_at
    FROM alerts
    ORDER BY created_at DESC
  `;
    let params = [];

    if (acknowledged !== undefined) {
      query += " WHERE acknowledged = $1";
      params.push(acknowledged === "true");
    }

    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("Get alerts error:", err);
    return res.status(500).json(pgErrorPayload(err, "Failed to fetch alerts"));
  }
});

app.get("/api/alerts/history", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, log_id, device_id, alcohol_level, status, acknowledged, acknowledged_at, acknowledged_by, created_at, archived_at
     FROM alerts_history
     ORDER BY archived_at DESC`
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Get alerts history error:", err);
    return res.status(500).json(pgErrorPayload(err, "Failed to fetch alert history"));
  }
});

app.get("/api/audit", async (req, res) => {
  const { action, entity_type, user_id } = req.query;
  let where = "";
  let params = [];
  let paramIndex = 1;

  if (action) {
    where += ` WHERE action = $${paramIndex}`;
    params.push(action);
    paramIndex++;
  }
  if (entity_type) {
    where += where ? ` AND entity_type = $${paramIndex}` : ` WHERE entity_type = $${paramIndex}`;
    params.push(entity_type);
    paramIndex++;
  }
  if (user_id) {
    where += where ? ` AND user_id = $${paramIndex}` : ` WHERE user_id = $${paramIndex}`;
    params.push(user_id);
    paramIndex++;
  }

  const result = await pool.query(
    `SELECT id, user_id, user_email, action, entity_type, entity_id, details, ip_address, created_at
     FROM audit_log
     ${where}
     ORDER BY created_at DESC
     LIMIT 500`,
    params
  );
  return res.json(result.rows);
});

app.patch("/api/alerts/:id/acknowledge", async (req, res) => {
  const { id } = req.params;
  const { acknowledged_by } = req.body ?? {};
  const actor = auditActor(req);

  const query = `
    UPDATE alerts
    SET acknowledged = TRUE, acknowledged_at = CURRENT_TIMESTAMP, acknowledged_by = $1
    WHERE id = $2
    RETURNING id, log_id, device_id, alcohol_level, status, acknowledged, acknowledged_at, acknowledged_by, created_at
  `;
  const values = [acknowledged_by ?? null, id];

  const result = await pool.query(query, values);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Alert not found" });
  }

  const alert = result.rows[0];
  await auditLog(
    "acknowledge_alert",
    "alert",
    alert.id,
    actor.id,
    actor.email,
    `Acknowledged alert for device ${alert.device_id} with status ${alert.status}`,
    req.ip || req.socket.remoteAddress
  );

  return res.json(alert);
});

// Delete a single log and its associated alert
app.delete("/api/logs/:id", async (req, res) => {
  const { id } = req.params;
  const actor = auditActor(req);
  try {
    // Delete associated alert first (if any)
    await pool.query("DELETE FROM alerts WHERE log_id = $1", [id]);
    // Delete the log
    const result = await pool.query("DELETE FROM logs WHERE id = $1 RETURNING id", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Log not found" });
    }

    await auditLog(
      "delete_log",
      "log",
      Number(id),
      actor.id,
      actor.email,
      `Deleted log entry ID ${id}`,
      req.ip || req.socket.remoteAddress
    );

    return res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    console.error("Delete log error:", err);
    return res.status(500).json({ error: "Failed to delete log" });
  }
});

// Delete all logs and alerts
app.delete("/api/logs", async (req, res) => {
  const actor = auditActor(req);
  try {
    await pool.query("TRUNCATE logs RESTART IDENTITY CASCADE");

    await auditLog(
      "delete_all_logs",
      "log",
      null,
      actor.id,
      actor.email,
      "Cleared all logs and alerts",
      req.ip || req.socket.remoteAddress
    );

    return res.json({ deleted: true, message: "All logs and alerts cleared" });
  } catch (err) {
    console.error("Delete all logs error:", err);
    return res.status(500).json({ error: "Failed to clear logs" });
  }
});

// QR Code Authentication Endpoints
app.post("/api/auth/qr/generate", async (req, res) => {
  const { email } = req.body ?? {};

  try {
    let user = null;

    if (email) {
      const result = await pool.query("SELECT id, email, role FROM users WHERE email = $1", [email.toLowerCase()]);
      user = result.rows[0];
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
    } else {
      let result = await pool.query(
        "SELECT id, email, role FROM users WHERE role = $1 ORDER BY id ASC LIMIT 1",
        ["admin"]
      );
      user = result.rows[0];
      if (!user) {
        result = await pool.query("SELECT id, email, role FROM users ORDER BY id ASC LIMIT 1");
        user = result.rows[0];
      }
      if (!user) {
        return res.status(404).json({ error: "No accounts yet. Create an account with email and password first." });
      }
    }

    // Generate a unique token
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes expiration

    // Store the token
    qrAuthTokens.set(token, {
      userId: user.id,
      email: user.email,
      role: user.role,
      expiresAt,
    });

    // Clean up expired tokens
    const now = Date.now();
    for (const [key, value] of qrAuthTokens.entries()) {
      if (value.expiresAt < now) {
        qrAuthTokens.delete(key);
      }
    }

    // Generate QR code URL
    const qrUrl = `${process.env.CLIENT_ORIGIN || "http://localhost:5173"}/auth/qr?token=${token}`;
    const qrCodeDataUrl = await QRCode.toDataURL(qrUrl, { width: 200, margin: 1 });

    return res.json({
      token,
      qrCode: qrCodeDataUrl,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  } catch (err) {
    console.error("QR generation error:", err);
    return res.status(500).json({ error: "Failed to generate QR code" });
  }
});

app.post("/api/auth/qr/verify", async (req, res) => {
  const { token } = req.body ?? {};
  if (!token) {
    return res.status(400).json({ error: "Token is required" });
  }

  const authData = qrAuthTokens.get(token);
  if (!authData) {
    return res.status(404).json({ error: "Invalid or expired token" });
  }

  if (Date.now() > authData.expiresAt) {
    qrAuthTokens.delete(token);
    return res.status(400).json({ error: "Token has expired" });
  }

  // Generate JWT token
  const jwtToken = jwt.sign(
    { id: authData.userId, email: authData.email, role: authData.role ?? "user" },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  // Remove the used token
  qrAuthTokens.delete(token);

  return res.json({
    token: jwtToken,
    user: { id: authData.userId, email: authData.email, role: authData.role ?? "user" }
  });
});

// ─── Baseline Auto-Learning API ───────────────────────────────────────────

// Get all device baselines
app.get("/api/baselines", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT device_id, mean_level, std_dev, sample_count, last_reading, deviation_threshold, updated_at
       FROM device_baselines ORDER BY device_id`
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Get baselines error:", err);
    return res.status(500).json(pgErrorPayload(err, "Failed to fetch baselines"));
  }
});

// Get baseline for a specific device
app.get("/api/baselines/:deviceId", async (req, res) => {
  const { deviceId } = req.params;
  try {
    const result = await pool.query(
      `SELECT device_id, mean_level, std_dev, sample_count, last_reading, deviation_threshold, updated_at
       FROM device_baselines WHERE device_id = $1`,
      [deviceId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No baseline found for this device" });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Get baseline error:", err);
    return res.status(500).json({ error: "Failed to fetch baseline" });
  }
});

// Update deviation threshold for a device
app.patch("/api/baselines/:deviceId", async (req, res) => {
  const { deviceId } = req.params;
  const { deviation_threshold } = req.body ?? {};
  if (deviation_threshold === undefined) {
    return res.status(400).json({ error: "deviation_threshold is required" });
  }
  try {
    const result = await pool.query(
      `UPDATE device_baselines SET deviation_threshold = $2, updated_at = CURRENT_TIMESTAMP
       WHERE device_id = $1 RETURNING *`,
      [deviceId, deviation_threshold]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No baseline found for this device" });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Update baseline error:", err);
    return res.status(500).json({ error: "Failed to update baseline" });
  }
});

// Recalculate baselines from all historical logs (re-train)
app.post("/api/baselines/recalculate", async (_req, res) => {
  try {
    // Delete existing baselines
    await pool.query("DELETE FROM device_baselines");

    // Compute baselines from all logs per device
    const result = await pool.query(`
      INSERT INTO device_baselines (device_id, mean_level, std_dev, sample_count, last_reading, updated_at)
      SELECT
        device_id,
        AVG(alcohol_level) AS mean_level,
        COALESCE(STDDEV(alcohol_level), 0) AS std_dev,
        COUNT(*)::INTEGER AS sample_count,
        MAX(alcohol_level) AS last_reading,
        CURRENT_TIMESTAMP AS updated_at
      FROM logs
      GROUP BY device_id
      ON CONFLICT (device_id) DO UPDATE SET
        mean_level = EXCLUDED.mean_level,
        std_dev = EXCLUDED.std_dev,
        sample_count = EXCLUDED.sample_count,
        last_reading = EXCLUDED.last_reading,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `);

    return res.json({ recalculated: true, baselines: result.rows });
  } catch (err) {
    console.error("Recalculate baselines error:", err);
    return res.status(500).json({ error: "Failed to recalculate baselines" });
  }
});

// ─── Notification Settings API (Email Alerts) ────────────────────────────

// Get all notification settings (public - view only)
app.get("/api/notifications", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, device_id, email, alert_types, enabled, created_at
       FROM notification_settings ORDER BY id`
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Get notifications error:", err);
    return res.status(500).json(pgErrorPayload(err, "Failed to fetch notification settings"));
  }
});

// Must be registered before /api/notifications/:id — otherwise "status" is captured as :id (400).
app.get("/api/notifications/status", async (_req, res) => {
  return res.json({ configured: isEmailConfigured() });
});

// Get a single notification setting by ID
app.get("/api/notifications/:id", async (req, res) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "Invalid notification id" });
  }
  try {
    const result = await pool.query(
      `SELECT id, device_id, email, alert_types, enabled, created_at
       FROM notification_settings WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Notification setting not found" });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Get notification error:", err);
    return res.status(500).json(pgErrorPayload(err, "Failed to fetch notification setting"));
  }
});

// Add a new notification email (public for testing)
app.post("/api/notifications", async (req, res) => {
  const { device_id, email, alert_types } = req.body ?? {};
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }
  try {
    const result = await pool.query(
      `INSERT INTO notification_settings (device_id, email, alert_types)
       VALUES ($1, $2, $3)
       RETURNING id, device_id, email, alert_types, enabled, created_at`,
      [device_id || "all", email, alert_types || ["WARNING", "DANGER"]]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create notification error:", err);
    return res.status(500).json(pgErrorPayload(err, "Failed to create notification setting"));
  }
});

// Update a notification setting (public for testing)
app.patch("/api/notifications/:id", async (req, res) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "Invalid notification id" });
  }
  const { device_id, email, alert_types, enabled } = req.body ?? {};
  try {
    const existing = await pool.query("SELECT * FROM notification_settings WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Notification setting not found" });
    }

    const sets = [];
    const vals = [];
    let p = 1;
    if (device_id !== undefined) {
      sets.push(`device_id = $${p++}`);
      vals.push(device_id);
    }
    if (email !== undefined) {
      sets.push(`email = $${p++}`);
      vals.push(email);
    }
    if (alert_types !== undefined) {
      sets.push(`alert_types = $${p++}`);
      vals.push(alert_types);
    }
    if (enabled !== undefined) {
      sets.push(`enabled = $${p++}`);
      vals.push(enabled);
    }

    if (sets.length === 0) {
      return res.json(existing.rows[0]);
    }

    vals.push(id);
    const result = await pool.query(
      `UPDATE notification_settings SET ${sets.join(", ")} WHERE id = $${p} RETURNING id, device_id, email, alert_types, enabled, created_at`,
      vals
    );
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Update notification error:", err);
    return res.status(500).json(pgErrorPayload(err, "Failed to update notification setting"));
  }
});

// Delete a notification setting (public for testing)
app.delete("/api/notifications/:id", async (req, res) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "Invalid notification id" });
  }
  try {
    const result = await pool.query("DELETE FROM notification_settings WHERE id = $1 RETURNING id", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Notification setting not found" });
    }
    return res.json({ deleted: true });
  } catch (err) {
    console.error("Delete notification error:", err);
    return res.status(500).json(pgErrorPayload(err, "Failed to delete notification setting"));
  }
});

// Test email endpoint — sends a test alert email
app.get("/api/test-email", async (_req, res) => {
  try {
    await sendAlertEmail("TEST-DEVICE", 0.075, "DANGER", 0.020, 2.5);
    return res.json({ success: true, message: "Test email sent" });
  } catch (err) {
    console.error("Test email error:", err);
    return res.status(500).json({ error: "Failed to send test email" });
  }
});

app.use((err, _req, res, _next) => {
  if (err && err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "Not allowed by CORS" });
  }
  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
});

// Start server and test database connection
const server = app.listen(port, async () => {
  console.log(`\n🚀 API listening on http://localhost:${port}\n`);
  
  // Test database connection
  console.log("Testing database connection...");
  const connected = await testConnection();
  
  if (!connected) {
    console.error("\n⚠️  WARNING: Could not connect to PostgreSQL database");
    console.error("Make sure:");
    console.error("  1. PostgreSQL / Supabase is reachable");
    console.error("  2. Tables exist (run: npm run init-db in backend/)");
    console.error("  3. DATABASE_URL or DB_HOST / DB_USERNAME / DB_DATABASE / DB_PASSWORD in backend/.env");
    console.error("\nServer is running but database queries will fail.\n");
  } else {
    await ensureNotificationSettingsSchema();
    console.log("✓ notification_settings table ready\n");
    
    // Run initial archive on startup to clean any old alerts
    try {
      await archiveOldAlerts();
    } catch (e) {
      console.error("Initial archive failed:", e.message);
    }
  }
});

// Background job: archive old alerts every minute
const ARCHIVE_INTERVAL_MS = 60 * 1000; // 1 minute
setInterval(() => {
  archiveOldAlerts().catch((err) => {
    console.error("Scheduled archive failed:", err.message);
  });
}, ARCHIVE_INTERVAL_MS);
console.log(`[Scheduler] Alert archive job configured (every ${ARCHIVE_INTERVAL_MS / 1000}s)`);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully...");
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
});

process.on("SIGTERM", async () => {
  console.log("\nShutting down gracefully...");
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
});
