import pg from "pg";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const { Pool } = pg;

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s !== "") return s;
  }
  return "";
}

/** Build URI from discrete vars (matches Supabase “Connection pooling” UI: host, port, user, DB, password). */
function buildDatabaseUrlFromParts() {
  const host = firstNonEmpty(process.env.DB_HOST);
  const port = firstNonEmpty(process.env.DB_PORT, "5432");
  const database = firstNonEmpty(process.env.DB_DATABASE, process.env.DB_NAME, "postgres");
  const user = firstNonEmpty(process.env.DB_USERNAME, process.env.DB_USER, "postgres");
  const password = firstNonEmpty(process.env.DB_PASSWORD);
  if (!host || !password) return "";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

function isSupabaseHost(s) {
  return /\bsupabase\.(com|co)\b/i.test(String(s || ""));
}

/** Supabase transaction pooler (PgBouncer) — disable named prepared statements in node-pg. */
function isSupabaseTransactionPooler(connectionString) {
  return /pooler\.supabase\.com:6543\b/i.test(String(connectionString || ""));
}

function resolveConnectionString() {
  return firstNonEmpty(
    process.env.DATABASE_URL,
    process.env.SUPABASE_DB_URL,
    process.env.POSTGRES_URL,
    buildDatabaseUrlFromParts()
  );
}

function getPoolConfig() {
  const connectionString = resolveConnectionString();
  const host = firstNonEmpty(process.env.DB_HOST);
  const port = Number(firstNonEmpty(process.env.DB_PORT, "5432")) || 5432;

  const base = {
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  };

  if (connectionString) {
    const needsSsl =
      /\bsupabase\.(com|co)\b/i.test(connectionString) ||
      process.env.DB_SSL === "true" ||
      (host && isSupabaseHost(host));
    const txPooler = isSupabaseTransactionPooler(connectionString);
    return {
      ...base,
      connectionString,
      ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
      ...(txPooler ? { prepareThreshold: 0 } : {}),
    };
  }

  return {
    ...base,
    host: host || "localhost",
    port,
    database: firstNonEmpty(process.env.DB_DATABASE, process.env.DB_NAME, "soberwatch"),
    user: firstNonEmpty(process.env.DB_USERNAME, process.env.DB_USER, "postgres"),
    password: firstNonEmpty(process.env.DB_PASSWORD, ""),
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  };
}

export const pool = new Pool(getPoolConfig());

pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
});

let didLogTarget = false;
pool.on("connect", () => {
  if (didLogTarget) return;
  didLogTarget = true;
  const cs = resolveConnectionString();
  const label =
    cs && /\bsupabase\.(com|co)\b/i.test(cs)
      ? "Supabase PostgreSQL"
      : cs
        ? "PostgreSQL"
        : "PostgreSQL";
  console.log(`✓ Pool ready (${label})`);
});

export async function testConnection(retries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await pool.query("SELECT NOW()");
      console.log("✓ Database connection test successful:", result.rows[0]);
      return true;
    } catch (err) {
      const isLastAttempt = attempt === retries;
      console.error(
        `✗ Database connection test failed (attempt ${attempt}/${retries}): ${err.message}`
      );
      if (!isLastAttempt) {
        console.log(`  Retrying in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  return false;
}

export async function closePool() {
  try {
    await pool.end();
    console.log("✓ Database pool closed");
  } catch (err) {
    console.error("Error closing pool:", err);
  }
}
