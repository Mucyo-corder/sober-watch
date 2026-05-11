/**
 * Database Initialization Script
 * Run this script to create tables and schema in PostgreSQL
 * 
 * Usage: node src/init-db.js
 */

import dotenv from "dotenv";
import { pool } from "./db.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const schema = `
  -- Users table for authentication
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Logs table for device alcohol readings
  CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL,
    alcohol_level DECIMAL(5, 2) NOT NULL,
    status VARCHAR(20) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Alerts table for tracking threshold breaches
  CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    log_id INTEGER REFERENCES logs(id),
    device_id VARCHAR(50) NOT NULL,
    alcohol_level DECIMAL(5, 2) NOT NULL,
    status VARCHAR(20) NOT NULL,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMP,
    acknowledged_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Create indexes for faster queries
  CREATE INDEX IF NOT EXISTS idx_logs_timestamp_desc 
    ON logs (timestamp DESC);

  CREATE INDEX IF NOT EXISTS idx_logs_device_id 
    ON logs (device_id);

  CREATE INDEX IF NOT EXISTS idx_users_email 
    ON users (email);

  CREATE INDEX IF NOT EXISTS idx_alerts_device_id 
    ON alerts (device_id);

  CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged 
    ON alerts (acknowledged);

  CREATE INDEX IF NOT EXISTS idx_alerts_created_at 
    ON alerts (created_at DESC);

  -- Alerts history table for archived alerts older than 10 minutes
  CREATE TABLE IF NOT EXISTS alerts_history (
    id SERIAL PRIMARY KEY,
    log_id INTEGER,
    device_id VARCHAR(50) NOT NULL,
    alcohol_level DECIMAL(5, 2) NOT NULL,
    status VARCHAR(20) NOT NULL,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMP,
    acknowledged_by VARCHAR(255),
    created_at TIMESTAMP NOT NULL,
    archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_alerts_history_created_at 
    ON alerts_history (created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_alerts_history_device_id 
    ON alerts_history (device_id);

  -- Audit log for tracking user actions
  CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    user_email VARCHAR(255),
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50),
    entity_id INTEGER,
    details TEXT,
    ip_address VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_audit_log_user_id 
    ON audit_log (user_id);

  CREATE INDEX IF NOT EXISTS idx_audit_log_created_at 
    ON audit_log (created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_audit_log_entity 
    ON audit_log (entity_type, entity_id);

  -- Device baselines for auto-learning normal alcohol levels per device
  CREATE TABLE IF NOT EXISTS device_baselines (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL UNIQUE,
    mean_level DECIMAL(8,4) NOT NULL DEFAULT 0,
    std_dev DECIMAL(8,4) NOT NULL DEFAULT 0,
    sample_count INTEGER NOT NULL DEFAULT 0,
    last_reading DECIMAL(8,4),
    deviation_threshold DECIMAL(4,1) NOT NULL DEFAULT 2.0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_device_baselines_device_id 
    ON device_baselines (device_id);

  -- Notification settings for email alerts
  CREATE TABLE IF NOT EXISTS notification_settings (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL DEFAULT 'all',
    email VARCHAR(255) NOT NULL,
    alert_types VARCHAR(20)[] NOT NULL DEFAULT '{"WARNING","DANGER"}',
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_notification_settings_device_id 
    ON notification_settings (device_id);

  CREATE INDEX IF NOT EXISTS idx_notification_settings_email 
    ON notification_settings (email);
`;

async function initializeDatabase() {
  try {
    console.log("\n📊 Initializing SoberWatch database...\n");

    // Split the schema into individual statements
    const statements = schema
      .split(";")
      .map((stmt) => stmt.trim())
      .filter((stmt) => stmt.length > 0);

    // Execute each statement
    for (const statement of statements) {
      console.log(`Executing: ${statement.substring(0, 50)}...`);
      await pool.query(statement);
    }

    console.log("\n✓ Database schema created successfully!\n");

    // Verify tables were created
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    console.log("📋 Created tables:");
    tables.rows.forEach((row) => {
      console.log(`   • ${row.table_name}`);
    });

    // Get table row counts
    console.log("\n📈 Table row counts:");
    for (const row of tables.rows) {
      const count = await pool.query(
        `SELECT COUNT(*) FROM ${row.table_name}`
      );
      console.log(
        `   • ${row.table_name}: ${count.rows[0].count} rows`
      );
    }

    console.log(
      "\n✓ Database initialization complete!\n"
    );

    await pool.end();
  } catch (err) {
    console.error(
      "\n✗ Error initializing database:",
      err.message
    );
    console.error("\nMake sure:");
    console.error("  1. PostgreSQL is running");
    console.error(
      "  2. The 'soberwatch' database exists (see setup guide)"
    );
    console.error(
      "  3. DATABASE_URL in .env is correct\n"
    );
    await pool.end();
    process.exit(1);
  }
}

initializeDatabase();
