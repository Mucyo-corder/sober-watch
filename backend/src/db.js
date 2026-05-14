import pg from "pg";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: join(__dirname, "../.env"),
});

const { Pool } = pg;

/* -------------------------------------------------------
   Helpers
------------------------------------------------------- */

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v === undefined || v === null) continue;

    const s = String(v).trim();

    if (s !== "") return s;
  }

  return "";
}

function buildDatabaseUrlFromParts() {
  const host = firstNonEmpty(process.env.DB_HOST);

  const port = firstNonEmpty(process.env.DB_PORT, "6543");

  const database = firstNonEmpty(
    process.env.DB_DATABASE,
    process.env.DB_NAME,
    "postgres"
  );

  // IMPORTANT FOR SUPABASE
  // must be postgres.PROJECT_REF
  const user = firstNonEmpty(
    process.env.DB_USERNAME,
    process.env.DB_USER
  );

  const password = firstNonEmpty(process.env.DB_PASSWORD);

  if (!host || !user || !password) {
    return "";
  }

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

function resolveConnectionString() {
  return firstNonEmpty(
    process.env.DATABASE_URL,
    process.env.SUPABASE_DB_URL,
    process.env.POSTGRES_URL,
    buildDatabaseUrlFromParts()
  );
}

function isSupabase(connectionString) {
  return /supabase\.com/i.test(connectionString || "");
}

function isTransactionPooler(connectionString) {
  return /pooler\.supabase\.com:6543/i.test(connectionString || "");
}

/* -------------------------------------------------------
   Pool Config
------------------------------------------------------- */

function getPoolConfig() {
  const connectionString = resolveConnectionString();

  const baseConfig = {
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  };

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is missing. Please configure your database connection."
    );
  }

  const config = {
    ...baseConfig,
    connectionString,

    // REQUIRED FOR SUPABASE
    ssl: {
      rejectUnauthorized: false,
    },
  };

  // IMPORTANT FOR SUPABASE TRANSACTION POOLER
  if (isTransactionPooler(connectionString)) {
    config.max = 1;

    // disable prepared statements
    config.statement_timeout = 30000;
    config.query_timeout = 30000;

    // IMPORTANT
    config.keepAlive = true;
  }

  return config;
}

/* -------------------------------------------------------
   Pool
------------------------------------------------------- */

export const pool = new Pool(getPoolConfig());

pool.on("connect", () => {
  console.log("✓ PostgreSQL connected successfully");
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error:", err);
});

/* -------------------------------------------------------
   Test Connection
------------------------------------------------------- */

export async function testConnection(retries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(
        `Testing database connection (attempt ${attempt}/${retries})...`
      );

      const result = await pool.query("SELECT NOW()");

      console.log(
        "✓ Database connection successful:",
        result.rows[0]
      );

      return true;
    } catch (err) {
      console.error(
        `✗ Connection failed (attempt ${attempt}/${retries}):`,
        err.message
      );

      if (attempt < retries) {
        console.log(`Retrying in ${delayMs}ms...`);

        await new Promise((resolve) =>
          setTimeout(resolve, delayMs)
        );
      }
    }
  }

  return false;
}

/* -------------------------------------------------------
   Close Pool
------------------------------------------------------- */

export async function closePool() {
  try {
    await pool.end();

    console.log("✓ Database pool closed");
  } catch (err) {
    console.error("Error closing pool:", err);
  }
}