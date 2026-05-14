# PostgreSQL Setup - Quick Start

Follow these steps to get your SoberWatch backend connected to PostgreSQL.

## Prerequisites
- PostgreSQL installed on your system
- PostgreSQL running on localhost:5432
- The postgres user password (set during installation)

## Step-by-Step

### 1. Update .env with your password

Edit `backend/.env`:

```env
PORT=4000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=soberwatch
DB_USER=postgres
DB_PASSWORD=YOUR_PASSWORD_HERE
JWT_SECRET=soberwatch_secret_key_change_in_production
CLIENT_ORIGIN=http://localhost:8080
```

Replace `YOUR_PASSWORD_HERE` with the password you set for the `postgres` user during PostgreSQL installation.

### 2. Create the database

Use **pgAdmin** or command line:

**pgAdmin (GUI - Easier):**
1. Open pgAdmin from Start menu
2. Servers → Right-click → Create → Server
3. Name: "Local"
4. Connection: host=localhost, port=5432, user=postgres, password=YOUR_PASSWORD
5. Save
6. Expand server → Databases → Right-click → Create → Database
7. Name: "soberwatch"
8. Owner: postgres
9. Save

**Command Line:**
```powershell
psql -U postgres -h localhost
# Enter password when prompted
CREATE DATABASE soberwatch;
\l          # List databases - you should see soberwatch
\q          # Exit
```

### 3. Initialize database tables

```powershell
cd backend
npm run init-db
```

You should see:
```
📊 Initializing SoberWatch database...
...
✓ Database schema created successfully!
```

### 4. Test the connection

```powershell
npm run test-db
```

Expected output:
```
🧪 SoberWatch Database Connection Tests
...
✅ All tests passed!
```

### 5. Start the server

```powershell
npm run dev
```

Expected output:
```
🚀 API listening on http://localhost:4000

Testing database connection...
✓ Connected to PostgreSQL database
✓ Database connection test successful: { now: 2026-04-30T... }
```

✅ **You're all set!**

---

## Available Commands

```powershell
# Development server with auto-reload
npm run dev

# Production server
npm start

# Initialize database (creates tables)
npm run init-db

# Test database connection
npm run test-db
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "ECONNREFUSED" | PostgreSQL is not running - start the service |
| "Database soberwatch does not exist" | Run `npm run init-db` to create tables |
| "Authentication failed" | Check password in DATABASE_URL matches postgres password |
| "Port 5432 already in use" | Another PostgreSQL instance is running |

---

## Need More Help?

See the full setup guide: [SETUP.md](SETUP.md)

---

## What Gets Created?

### Users Table
Stores user accounts for authentication
```
id | email | password | role | created_at | updated_at
```

### Logs Table
Stores alcohol level readings from IoT devices
```
id | device_id | alcohol_level | status | timestamp
```

---

**Database ready! Happy coding! 🎉**
