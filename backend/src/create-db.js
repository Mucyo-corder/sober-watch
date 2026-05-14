/**

 * Create the soberwatch database

 * Run this before init-db.js

 * 

 * Usage: node src/create-db.js

 */



import pg from "pg";

import dotenv from "dotenv";



dotenv.config();



const { Client } = pg;



async function createDatabase() {

  // Connect to default postgres database first

  const client = new Client({

    host: "localhost",

    port: 5432,

    user: "postgres",

    password: process.env.POSTGRES_PASSWORD || "phanie",

    database: "postgres", // Connect to default database

  });



  try {

    console.log("\n🗄️  Creating soberwatch database...\n");



    await client.connect();

    console.log("✓ Connected to PostgreSQL");



    // Check if database exists

    const result = await client.query(`

      SELECT 1 FROM pg_database 

      WHERE datname = 'soberwatch'

    `);



    if (result.rows.length > 0) {

      console.log("✓ Database 'soberwatch' already exists");

    } else {

      // Create database

      await client.query("CREATE DATABASE soberwatch");

      console.log("✓ Database 'soberwatch' created successfully");

    }



    await client.end();

    console.log("✓ Connection closed\n");

    process.exit(0);

  } catch (err) {

    console.error("\n✗ Error:", err.message);

    console.error("\nMake sure:");

    console.error("  1. PostgreSQL is running");

    console.error("  2. Password is correct in POSTGRES_PASSWORD env var");

    await client.end();

    process.exit(1);

  }

}



createDatabase();

