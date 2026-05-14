# SoberWatch (PostgreSQL + Express)

This project now uses:
- Frontend: React + Vite dashboard (UI unchanged)
- Backend: Node.js + Express REST API
- Database: PostgreSQL

## 1) Database setup

1. Create a PostgreSQL database named `soberwatch`.
2. Run the schema:

```sql
\i server/sql/schema.sql
```

3. Create accounts through the app: open the frontend, go to **Sign up**, and register with any email and password. Credentials are stored in PostgreSQL (bcrypt-hashed). The first registered user is assigned the `admin` role; later users are `user`. All registered users can sign in and use the dashboard.

   (Optional) You can still insert a user manually with SQL if you prefer not to use the UI.

## 2) Backend setup

```bash
cd server
npm install
copy .env.example .env
```

Update `server/.env` with your PostgreSQL connection and JWT secret:
- `DATABASE_URL`
- `JWT_SECRET`
- `CLIENT_ORIGIN` (default `http://localhost:5173`)

Start backend:

```bash
npm run dev
```

Backend runs at `http://localhost:4000`.

## 3) Frontend setup

At project root:

```bash
npm install
npm run dev
```

Ensure root `.env` contains:

```env
VITE_API_BASE_URL="http://localhost:4000"
```

Frontend runs at `http://localhost:5173`.

## 4) API endpoints

- `POST /api/logs`
  - For ESP32 readings
  - Body: `{ "device_id": "gate-1", "alcohol_level": 0.05, "timestamp": "2026-04-30T10:15:00Z" }`
  - Status is computed server-side (`SAFE`, `WARNING`, `HIGH`)

- `GET /api/logs`
  - Returns logs ordered newest first (no auth required in current build)

- `POST /api/auth/signup`
  - Body: `{ "email": "...", "password": "..." }`
  - Creates a user in the database and returns a JWT

- `POST /api/auth/login`
  - Body: `{ "email": "...", "password": "..." }`
  - Returns JWT and user details when the password matches the stored hash

## 5) ESP32 integration

In the setup page sketch, only the endpoint was changed to:
- `POST <API_BASE_URL>/api/logs`

Hardware behavior and reading logic remain unchanged.
