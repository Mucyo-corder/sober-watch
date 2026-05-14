import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing in environment variables");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false,
  },

  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,

  // 🔥 IMPORTANT FOR SUPABASE POOLER
  prepareThreshold: 0,
});

pool.on("connect", () => {
  console.log("✓ PostgreSQL connected successfully");
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error:", err);
});

export async function testConnection() {
  try {
    const result = await pool.query("SELECT NOW()");
    console.log("✓ DB OK:", result.rows[0]);
    return true;
  } catch (err) {
    console.error("DB connection failed:", err.message);
    return false;
  }
}

export async function closePool() {
  await pool.end();
}