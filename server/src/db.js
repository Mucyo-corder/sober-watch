import pg from "pg";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const { Pool } = pg;

// Create connection pool with error handling
// Supabase requires DATABASE_URL with SSL enabled
const connectionString = process.env.DATABASE_URL;
export const pool = new Pool(
  connectionString
    ? {
        connectionString,
        ssl: { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      }
    : {
        host: process.env.DB_HOST || "localhost",
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || "soberwatch",
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD || "",
        ssl: { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      }
);

// Handle pool errors
pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
});

pool.on("connect", () => {
  console.log("✓ Connected to PostgreSQL database");
});

// Test the connection
export async function testConnection() {
  try {
    const result = await pool.query("SELECT NOW()");
    console.log("✓ Database connection test successful:", result.rows[0]);
    return true;
  } catch (err) {
    console.error("✗ Database connection test failed:", err.message);
    return false;
  }
}

// Close the pool on application exit
export async function closePool() {
  try {
    await pool.end();
    console.log("✓ Database pool closed");
  } catch (err) {
    console.error("Error closing pool:", err);
  }
}
