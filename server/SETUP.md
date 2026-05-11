# SoberWatch PostgreSQL Setup Guide

This guide will walk you through setting up PostgreSQL for the SoberWatch project.

## Table of Contents
1. [PostgreSQL Installation](#postgresql-installation)
2. [Create Database & User](#create-database--user)
3. [Initialize Database Schema](#initialize-database-schema)
4. [Verify Connection](#verify-connection)
5. [Troubleshooting](#troubleshooting)

---

## PostgreSQL Installation

### Windows

1. Download PostgreSQL from: https://www.postgresql.org/download/windows/
2. Run the installer and follow the setup wizard
3. **Important**: Remember the password you set for the `postgres` user
4. Default port is `5432` (keep this)
5. Accept default settings for most options

After installation, PostgreSQL should start automatically.

---

## Create Database & User

### Option 1: Using pgAdmin (Easier - GUI)

1. Open **pgAdmin** (comes with PostgreSQL)
   - Search for "pgAdmin" in Windows Start menu
   - Default login: email is `postgres@pgadmin.org` and password is usually blank

2. Connect to your local server:
   - Click "Servers" in the left panel
   - Right-click "Servers" → "Create" → "Server"
   - Name: `Local` (or any name)
   - Connection tab:
     - Host: `localhost`
     - Port: `5432`
     - Username: `postgres`
     - Password: (the password you set during installation)
   - Click "Save"

3. Create the database:
   - Expand your server in the left panel
   - Right-click "Databases" → "Create" → "Database"
   - Database name: `soberwatch`
   - Owner: `postgres`
   - Click "Save"

✓ Database created!

### Option 2: Using Command Line (psql)

1. Open **Command Prompt** or **PowerShell**

2. Connect to PostgreSQL:
   ```powershell
   psql -U postgres -h localhost
   ```
   Enter your postgres password when prompted

3. Create the database:
   ```sql
   CREATE DATABASE soberwatch;
   ```

4. Verify it was created:
   ```sql
   \l
   ```
   You should see `soberwatch` in the list

5. Exit psql:
   ```sql
   \q
   ```

✓ Database created!

---

## Verify .env Configuration

Check that `.env` in the `server/` directory has the correct settings:

```env
PORT=4000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=soberwatch
DB_USER=postgres
DB_PASSWORD=YOUR_PASSWORD
JWT_SECRET=soberwatch_secret_key_change_in_production
CLIENT_ORIGIN=http://localhost:8080
```

Replace `YOUR_PASSWORD` with the password you set for the `postgres` user.

---

## Initialize Database Schema

The database is created, but we need to add tables. We have a script for this!

### Step 1: Make sure you're in the server directory

```powershell
cd c:\Users\Students\Desktop\soberwatch\server
```

### Step 2: Run the initialization script

```powershell
node src/init-db.js
```

You should see output like:
```
📊 Initializing SoberWatch database...

Executing: CREATE TABLE IF NOT EXISTS users...
Executing: CREATE TABLE IF NOT EXISTS logs...
Executing: CREATE INDEX IF NOT EXISTS idx_logs_timestamp_desc...
...

✓ Database schema created successfully!

📋 Created tables:
   • logs
   • users

📈 Table row counts:
   • logs: 0 rows
   • users: 0 rows

✓ Database initialization complete!
```

✓ Tables created!

---

## Start the Server & Test Connection

### Step 1: Make sure you're in the server directory

```powershell
cd c:\Users\Students\Desktop\soberwatch\server
```

### Step 2: Start the server

```powershell
npm run dev
```

or

```powershell
node src/index.js
```

You should see:
```
🚀 API listening on http://localhost:4000

Testing database connection...
✓ Connected to PostgreSQL database
✓ Database connection test successful: { now: 2026-04-30T... }
```

✓ Connection successful!

---

## Verify Connection

### Test 1: Check Server Logs

If you see the success messages above, you're good to go!

### Test 2: Test API Endpoints

Using PowerShell, test the endpoints:

#### Get all logs:
```powershell
curl -Uri "http://localhost:4000/api/logs" | ConvertFrom-Json
```

Should return: `[]` (empty array, since no data yet)

#### Add a log entry:
```powershell
$body = @{
    device_id = "DEVICE-001"
    alcohol_level = 0.05
    timestamp = $null
} | ConvertTo-Json

curl -Uri "http://localhost:4000/api/logs" `
     -Method Post `
     -ContentType "application/json" `
     -Body $body
```

Should return the created log entry with an ID.

#### Get logs again:
```powershell
curl -Uri "http://localhost:4000/api/logs" | ConvertFrom-Json
```

Should now show the log entry you just created!

### Test 3: Check Database in pgAdmin

1. Open pgAdmin
2. Navigate to: `Servers` → `Local` → `Databases` → `soberwatch` → `Schemas` → `public` → `Tables`
3. Right-click `logs` → `View/Edit Data` → `All Rows`
4. You should see the log entry you just created!

✓ Everything works!

---

## Troubleshooting

### "ECONNREFUSED: Connection refused"

**Cause**: PostgreSQL is not running

**Fix**:
- Windows: Search for "Services" → Find "postgresql-x64-..." → Right-click → "Start"
- Or restart your computer

---

### "Database soberwatch does not exist"

**Cause**: Database wasn't created

**Fix**:
1. Use pgAdmin or psql to create the database (see above)
2. Run `node src/init-db.js` to create tables

---

### "Role postgres does not exist" or authentication fails

**Cause**: Wrong password or username in DATABASE_URL

**Fix**:
1. Update `.env` with correct postgres password
2. Test with psql first:
   ```powershell
   psql -U postgres -h localhost
   ```

---

### "The server is not responding" (in pgAdmin)

**Cause**: PostgreSQL crashed or stopped

**Fix**:
1. Check if PostgreSQL service is running (see troubleshooting above)
2. Restart PostgreSQL service

---

### "Port 5432 is already in use"

**Cause**: Another PostgreSQL instance is running, or something else is using port 5432

**Fix**:
1. Check if you already have PostgreSQL running on another system or WSL
2. You can change the port in your `.env` DATABASE_URL (not recommended unless necessary)

---

## Database Schema

### Users Table
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role VARCHAR(50) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Purpose**: Store user accounts for authentication

### Logs Table
```sql
CREATE TABLE logs (
  id SERIAL PRIMARY KEY,
  device_id VARCHAR(50) NOT NULL,
  alcohol_level DECIMAL(5, 2) NOT NULL,
  status VARCHAR(20) NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Purpose**: Store alcohol level readings from IoT devices

---

## Quick Reference

| Item | Value |
|------|-------|
| Host | localhost |
| Port | 5432 |
| Database | soberwatch |
| User | postgres |
| Password | (the one you set during installation) |
| Server Port | 4000 |
| Client Origin | http://localhost:8080 |

---

## Next Steps

1. ✅ PostgreSQL installed
2. ✅ Database created
3. ✅ Tables initialized
4. ✅ Connection tested
5. 🔄 Start developing your SoberWatch app!

For more info, see the [PostgreSQL documentation](https://www.postgresql.org/docs/).
