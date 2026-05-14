/**
 * Database Connection Test Script
 * Verifies all database components are working correctly
 * 
 * Usage: node src/test-db.js
 */

import dotenv from "dotenv";
import { pool, testConnection } from "./db.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

async function runTests() {
  console.log("\n🧪 SoberWatch Database Connection Tests\n");
  console.log("=" .repeat(50));

  try {
    // Test 1: Connection
    console.log("\n✓ Test 1: Database Connection");
    const connected = await testConnection();

    if (!connected) {
      console.error(
        "✗ Failed to connect. Check DATABASE_URL or DB_* vars in backend/.env and network access."
      );
      process.exit(1);
    }

    // Test 2: Tables exist
    console.log("\n✓ Test 2: Checking Tables");
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    if (tables.rows.length === 0) {
      console.warn("  ⚠️  No tables found. Run: node src/init-db.js");
    } else {
      console.log(`  Found ${tables.rows.length} tables:`);
      tables.rows.forEach((row) => {
        console.log(`    • ${row.table_name}`);
      });
    }

    // Test 3: Query logs table
    console.log("\n✓ Test 3: Query logs table");
    const logs = await pool.query(`
      SELECT COUNT(*) as count FROM logs;
    `);
    console.log(`  Logs in database: ${logs.rows[0].count}`);

    // Test 4: Query users table
    console.log("\n✓ Test 4: Query users table");
    const users = await pool.query(`
      SELECT COUNT(*) as count FROM users;
    `);
    console.log(`  Users in database: ${users.rows[0].count}`);

    // Test 5: Insert test data
    console.log("\n✓ Test 5: Insert test data");
    const testResult = await pool.query(`
      INSERT INTO logs (device_id, alcohol_level, status)
      VALUES ('TEST-001', 0.08, 'WARNING')
      RETURNING id, device_id, alcohol_level, status, timestamp;
    `);
    console.log("  Test data inserted:");
    console.log(
      `    ID: ${testResult.rows[0].id}`
    );
    console.log(
      `    Device: ${testResult.rows[0].device_id}`
    );
    console.log(
      `    Level: ${testResult.rows[0].alcohol_level}`
    );
    console.log(
      `    Status: ${testResult.rows[0].status}`
    );

    // Test 6: Select test data
    console.log("\n✓ Test 6: Select test data");
    const selectResult = await pool.query(`
      SELECT * FROM logs 
      WHERE device_id = 'TEST-001'
      LIMIT 1;
    `);
    console.log(`  Retrieved ${selectResult.rows.length} record(s)`);

    // Test 7: Delete test data
    console.log("\n✓ Test 7: Clean up test data");
    const deleteResult = await pool.query(`
      DELETE FROM logs 
      WHERE device_id = 'TEST-001';
    `);
    console.log(`  Deleted ${deleteResult.rowCount} record(s)`);

    console.log("\n" + "=".repeat(50));
    console.log("✅ All tests passed!\n");

    await pool.end();
  } catch (err) {
    console.error("\n✗ Test failed:", err.message);
    console.error("\nPossible causes:");
    console.error("  • PostgreSQL is not running");
    console.error(
      "  • DATABASE_URL or DB_HOST / DB_USERNAME / DB_DATABASE / DB_PASSWORD in backend/.env is incorrect"
    );
    console.error(
      "  • Database tables not initialized (run: node src/init-db.js)"
    );
    await pool.end();
    process.exit(1);
  }
}

runTests();
