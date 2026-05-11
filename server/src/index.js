import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { pool, testConnection, closePool } from "./db.js";
import { authRequired } from "./middleware.js";
import { sendAlertEmail, isEmailConfigured } from "./email.js";
import QRCode from "qrcode";
import alertRoutes from "./routes/alertRoutes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const app = express();
const port = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";

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

const allowedOrigins = [
  process.env.CLIENT_ORIGIN,
  "http://localhost:8080",
  "http://localhost:5173",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:54670",
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
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

// Automatically archive alerts older than 10 minutes to history table
async function archiveOldAlerts() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO alerts_history (log_id, device_id, alcohol_level, status, acknowledged, acknowledged_at, acknowledged_by, created_at)
      SELECT log_id, device_id, alcohol_level, status, acknowledged, acknowledged_at, acknowledged_by, created_at
      FROM alerts
      WHERE created_at < NOW() - INTERVAL '10 minutes'
    `);
    await client.query(`
      DELETE FROM alerts
      WHERE created_at < NOW() - INTERVAL '10 minutes'
    `);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Archive alerts error:", err);
  } finally {
    client.release();
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

// Auth: Admin Signup
app.post("/api/auth/signup", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    // Check if user already exists
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Email already registered" });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert user into database
    const result = await pool.query(
      "INSERT INTO users (email, password, role) VALUES ($1, $2, $3) RETURNING id, email, role",
      [email.toLowerCase(), hashedPassword, "admin"]
    );
    const user = result.rows[0];

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });

    await auditLog(
      "user_signup",
      "user",
      user.id,
      user.id,
      user.email,
      "New admin account created",
      req.ip || req.socket.remoteAddress
    );

    return res.status(201).json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ error: "Failed to create user" });
  }
});

// Auth: Login
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const result = await pool.query("SELECT id, email, password, role FROM users WHERE email = $1", [email.toLowerCase()]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Check if admin
    if (user.role !== "admin") {
      return res.status(403).json({ error: "Only admin accounts can access the dashboard" });
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
  const result = await pool.query(
    "SELECT id, device_id, alcohol_level, status, timestamp FROM logs ORDER BY timestamp DESC"
  );
  return res.json(result.rows);
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
});

app.get("/api/alerts/history", async (_req, res) => {
  const result = await pool.query(
    `SELECT id, log_id, device_id, alcohol_level, status, acknowledged, acknowledged_at, acknowledged_by, created_at, archived_at
     FROM alerts_history
     ORDER BY archived_at DESC`
  );
  return res.json(result.rows);
});

app.get("/api/audit", authRequired, async (req, res) => {
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

app.patch("/api/alerts/:id/acknowledge", authRequired, async (req, res) => {
  const { id } = req.params;
  const { acknowledged_by } = req.body ?? {};
  const user = req.user;

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
    user.id,
    user.email,
    `Acknowledged alert for device ${alert.device_id} with status ${alert.status}`,
    req.ip || req.socket.remoteAddress
  );

  return res.json(alert);
});

// Delete a single log and its associated alert
app.delete("/api/logs/:id", authRequired, async (req, res) => {
  const { id } = req.params;
  const user = req.user;
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
      user.id,
      user.email,
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
app.delete("/api/logs", authRequired, async (req, res) => {
  const user = req.user;
  try {
    await pool.query("TRUNCATE logs RESTART IDENTITY CASCADE");

    await auditLog(
      "delete_all_logs",
      "log",
      null,
      user.id,
      user.email,
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
      // No email provided — use the first admin user
      const result = await pool.query("SELECT id, email, role FROM users WHERE role = $1 LIMIT 1", ["admin"]);
      user = result.rows[0];
      if (!user) {
        return res.status(404).json({ error: "No admin account found. Please sign up first." });
      }
    }

    // Generate a unique token
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes expiration

    // Store the token
    qrAuthTokens.set(token, {
      userId: user.id,
      email: user.email,
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
    { id: authData.userId, email: authData.email, role: "admin" },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  // Remove the used token
  qrAuthTokens.delete(token);

  return res.json({
    token: jwtToken,
    user: { id: authData.userId, email: authData.email, role: "admin" }
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
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
    return res.status(500).json({ error: "Failed to fetch baselines" });
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
app.patch("/api/baselines/:deviceId", authRequired, async (req, res) => {
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
app.post("/api/baselines/recalculate", authRequired, async (_req, res) => {
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
    return res.status(500).json({ error: "Failed to fetch notification settings" });
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
    return res.status(500).json({ error: "Failed to create notification setting" });
  }
});

// Update a notification setting (public for testing)
app.patch("/api/notifications/:id", async (req, res) => {
  const { id } = req.params;
  const { device_id, email, alert_types, enabled } = req.body ?? {};
  try {
    const existing = await pool.query("SELECT * FROM notification_settings WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Notification setting not found" });
    }
    const result = await pool.query(
      `UPDATE notification_settings
       SET device_id = COALESCE($2, device_id),
           email = COALESCE($3, email),
           alert_types = COALESCE($4, alert_types),
           enabled = COALESCE($5, enabled)
       WHERE id = $1
       RETURNING id, device_id, email, alert_types, enabled, created_at`,
      [id, device_id ?? null, email ?? null, alert_types ?? null, enabled ?? null]
    );
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Update notification error:", err);
    return res.status(500).json({ error: "Failed to update notification setting" });
  }
});

// Delete a notification setting (public for testing)
app.delete("/api/notifications/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("DELETE FROM notification_settings WHERE id = $1 RETURNING id", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Notification setting not found" });
    }
    return res.json({ deleted: true });
  } catch (err) {
    console.error("Delete notification error:", err);
    return res.status(500).json({ error: "Failed to delete notification setting" });
  }
});

// Check email configuration status
app.get("/api/notifications/status", async (_req, res) => {
  return res.json({ configured: isEmailConfigured() });
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

// Start server and test database connection
const server = app.listen(port, async () => {
  console.log(`\n🚀 API listening on http://localhost:${port}\n`);
  
  // Test database connection
  console.log("Testing database connection...");
  const connected = await testConnection();
  
  if (!connected) {
    console.error("\n⚠️  WARNING: Could not connect to PostgreSQL database");
    console.error("Make sure:");
    console.error("  1. PostgreSQL is running");
    console.error("  2. The 'soberwatch' database exists");
    console.error("  3. DATABASE_URL is correct in .env");
    console.error("\nServer is running but database queries will fail.\n");
  }
});

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
