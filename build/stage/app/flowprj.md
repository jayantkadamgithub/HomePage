# WalkWell — Detailed Project Flow

This document explains **how the project works end-to-end**: where sign-up / sign-in data is
stored and validated, whether Oracle is actually storing data right now, and exactly what
Node.js is doing.

---

## 🗺️ High-Level Architecture

```
┌──────────────┐     HTTP (JSON)      ┌───────────────────────────────┐      ┌─────────────────────┐
│   BROWSER    │ ───────────────────▶ │        NODE.JS (Express)        │ ───▶ │  DATA STORE          │
│              │ ◀─────────────────── │                                 │ ◀─── │                      │
│ index.html   │     JSON responses   │  server.js  → routes/auth.js    │      │  • Oracle DB (real)  │
│ styles.css   │                      │              → authController.js │      │       OR             │
│ app.js       │                      │              → config/db.js      │      │  • In-memory (mock)  │
└──────────────┘                      └───────────────────────────────┘      └─────────────────────┘
```

- **Frontend** = plain HTML + CSS + vanilla JavaScript (`public/`).
- **Backend** = Node.js + Express (`src/`).
- **Data store** = either a real **Oracle DB** or an **in-memory mock** (controlled by `.env`).

---

## 1️⃣ Where Signup & Signin Details Are Stored and Validated

### 📥 Validation happens in TWO layers

| Layer | Where | What it checks |
|-------|-------|----------------|
| **Client-side** | `public/js/app.js` | Empty fields, password length ≥ 8, password == confirm, userId ≥ 3 chars. Shows inline errors **before** sending. |
| **Server-side** | `src/routes/auth.js` (express-validator) + `src/controllers/authController.js` | Re-validates every field on the server (never trusts the browser). Checks required fields, userId length 3–50, name length, password 8–72 chars. |

### 🧾 Signup flow — step by step

```
User fills Signup form  (public/index.html)
        │  submit
        ▼
public/js/app.js  ── client validation (empty, pw length, pw match)
        │  POST /api/signup { userId, name, password }
        ▼
src/routes/auth.js  ── express-validator rules + validate()
        │  (if invalid → 400 "first error message")
        ▼
src/controllers/authController.js  → signup()
   1. Trim & check fields present        → 400 if missing
   2. Check password length ≥ 8          → 400 if too short
   3. SELECT ... FROM signup_dtls        → 409 if user already exists
   4. bcrypt.hash(password, 12)          → one-way hash (NEVER plaintext)
   5. INSERT INTO signup_dtls (...)      → stores USER_ID, NAME, PASSWORD_HASH,
                                            CREATED_DATE/TIME, IS_ACTIVE=1,
                                            FAILED_ATTEMPTS=0
   6. jwt.sign(...)                       → returns a session token
        │
        ▼
src/config/db.js → query()
   • if USE_MOCK_DB=true  → runMock()   (in-memory Map)
   • if USE_MOCK_DB=false → Oracle conn.execute()
        │
        ▼
201 Created  { ok:true, token, user }
        │
        ▼
app.js shows green toast, stores token, switches to Login tab
```

**Where signup data lives:** table **`signup_dtls`**, one row per user
(`USER_ID` PK, `NAME`, `PASSWORD_HASH`, `CREATED_DATE`, `CREATED_TIME`, ...).

### 🔐 Signin flow — step by step

```
User fills Signin form  (public/index.html)
        │  submit
        ▼
public/js/app.js  ── client validation (empty userId / password)
        │  POST /api/login { userId, password }
        ▼
src/routes/auth.js  ── express-validator + validate()
        ▼
src/controllers/authController.js  → login()
   1. Check fields present                → 400 if missing
   2. SELECT ... FROM signup_dtls         → find the user
        • user not found → logAttempt(FAILED) → 401
   3. Check LOCKED_UNTIL                  → if locked → logAttempt(LOCKED) → 423
   4. bcrypt.compare(password, hash)      → verify password
        • wrong → FAILED_ATTEMPTS++, maybe LOCKED_UNTIL set → logAttempt(FAILED) → 401
        • correct → reset FAILED_ATTEMPTS=0, set LAST_LOGIN_DATE/TIME
   5. logAttempt(SUCCESS)                 → INSERT INTO login_dtls
   6. jwt.sign(...)                        → returns token
        │
        ▼
src/config/db.js → query()  (mock or Oracle)
        │
        ▼
200 OK  { ok:true, token, user }
        │
        ▼
app.js stores token, shows "Login successful" toast
```

**Where signin data lives:**
- **User row** in `signup_dtls` gets updated (`LAST_LOGIN_DATE`, `LAST_LOGIN_TIME`,
  `FAILED_ATTEMPTS`, `LOCKED_UNTIL`).
- **Every login attempt** is appended to table **`login_dtls`**
  (`LOGIN_ID`, `USER_ID`, `LOGIN_DATE`, `LOGIN_TIME`, `IP_ADDRESS`, `STATUS`, `USER_AGENT`).
  `LOGIN_ID` is allocated atomically by `id_counter` via `db.nextId()` (a concurrency-safe
  sequence emulator) — see `signup.md`.

> **Key point:** The password itself is **never stored in plain text** and **never returned**.
> Only a **bcrypt hash** sits in `signup_dtls.PASSWORD_HASH`.

---

## 2️⃣ Is Oracle DB Storing This Data Right Now?

### ✅ Yes — the app is now running in real Oracle mode.

The investigation found that it originally was **not**, due to three bugs (all fixed — see
`signup.md` for the full test report). Current proof:

- `.env` contains **`USE_MOCK_DB=false`** with real credentials
  (`demouser` / `demouser` / `localhost:1521/FREEPDB1`).
- The live health check returns **`{"ok":true,"mode":"oracle"}`**.
- A live HTTP signup + signin was verified from a separate connection: rows appeared in
  `SIGNUP_DTLS` (with a bcrypt hash) and `LOGIN_DTLS` (with `SUCCESS` status).

### Three root causes that were fixed (details in `signup.md`)

| # | Problem | Fix |
|---|---------|-----|
| 1 | `USE_MOCK_DB=true` routed all queries to an in-memory `Map` | Set to `false` with real credentials |
| 2 | `oracledb.fetchTypeHandler = false` threw `NJS-004` on init | Removed the invalid assignment |
| 3 | Oracle writes were never committed (rolled back on `conn.close()`); audit INSERT failed with `ORA-01400` on `LOGIN_ID` | AutoCommit for DML + explicit `LOGIN_ID` generation + logged audit errors |

### Current behaviour

| | Mock mode (`USE_MOCK_DB=true`) | Current Oracle mode (`false`) |
|---|---|---|
| Where data goes | RAM (`Map`) inside the Node process | Oracle tables `signup_dtls` / `login_dtls` |
| Survives restart? | ❌ No | ✅ Yes — persisted on disk |
| `oracledb` used? | ❌ No | ✅ Yes (thin mode) |
| Config | none needed | `.env` credentials (`sql/schema.sql` already applied) |

### To switch back to mock (for offline dev)
Set `USE_MOCK_DB=true` in `.env` and restart with `npm start`. Health will return `"mode":"mock"`.

> **Summary:** Signup/signin data **is now persisted in Oracle**. To temporarily use the
> in-memory mock instead, flip `USE_MOCK_DB=true`. Full investigation and test evidence is in
> `signup.md`.

---

## 3️⃣ What Node.js Does (its responsibilities)

Node.js is the **backend engine**. When you run `npm start`, it runs `src/server.js`.
Its jobs:

### a) Web server & routing
- Uses **Express** to listen on a port (`PORT`, default `3000`).
- Serves the **frontend static files** from `public/` (`express.static`) — so opening
  `http://localhost:3000` returns `index.html`, `css/styles.css`, `js/app.js`.
- Defines API routes:
  | Route | Controller | Purpose |
  |-------|-----------|---------|
  | `GET /api/health` | inline | DB connectivity + mode check |
  | `POST /api/signup` | `authController.signup` | create account |
  | `POST /api/login` | `authController.login` | authenticate |
  | `GET /api/me` | `authController.me` | protected (needs JWT) |
- Has a catch-all that returns `index.html` (single-page app friendly).

### b) Request parsing & validation
- `express.json()` / `express.urlencoded()` parse incoming JSON/form bodies.
- `express-validator` enforces field rules before the controller runs.

### c) Business logic (the controllers)
- **Password hashing** with **bcrypt** (`bcrypt.hash` on signup, `bcrypt.compare` on login).
- **JWT creation/verification** with `jsonwebtoken` — issues a token on success and verifies
  it for protected routes (e.g. `/api/me`).
- **Account-lockout logic** — counts failed attempts, locks the account for N minutes.
- **Audit logging** — writes every attempt to `login_dtls`.

### d) Database access
- `src/config/db.js` is the **single data-access layer**.
- It exposes `query(sql, binds)` and **chooses the backend** at runtime:
  - `USE_MOCK_DB=true` → in-memory mock (current).
  - `USE_MOCK_DB=false` → **Oracle** via the `oracledb` **thin mode** (no Instant Client needed),
    using a small connection **pool** (poolMax = 4).
- All queries use **bind variables** (`:userId`, `:hash`, ...) → **SQL-injection safe**.

### e) Configuration & secrets
- Loads `.env` via `dotenv` (`JWT_SECRET`, DB credentials, lockout policy, etc.).
- Reads tunables: `MAX_FAILED_ATTEMPTS` (default 5), `LOCKOUT_MINUTES` (default 15),
  `JWT_EXPIRES_IN` (default 1h).

### f) Error handling & lifecycle
- Central Express error handler returns JSON `{ ok:false, message }` with proper status codes.
- On startup it initializes the DB (if Oracle) and logs which mode is active.
- Exports `{ app, start }` so tests can import the app without opening a port.

### What Node.js does NOT do
- It does **not** render HTML/CSS (the browser does that).
- It does **not** store data in a file — storage is delegated to Oracle or the mock Map.

---

## 🔁 Complete Request Lifecycle (one picture)

```
BROWSER                         NODE.JS (Express)                      DATA STORE
  │                                  │                                   │
  │ GET /  (open page)               │                                   │
  │─────────────────────────────────▶│ serve public/index.html           │
  │◀─────────────────────────────────│                                   │
  │                                  │                                   │
  │ POST /api/signup                 │                                   │
  │─────────────────────────────────▶│ express-validator                 │
  │                                  │ authController.signup             │
  │                                  │ bcrypt.hash(password)             │
  │                                  │ INSERT INTO signup_dtls ─────────▶│ (mock Map or Oracle)
  │                                  │ ◀──────────── ok ────────────────│
  │◀── 201 {token,user} ─────────────│ jwt.sign()                        │
  │                                  │                                   │
  │ POST /api/login                  │                                   │
  │─────────────────────────────────▶│ SELECT signup_dtls ──────────────▶│
  │                                  │ ◀────────── user row ────────────│
  │                                  │ bcrypt.compare(password, hash)    │
  │                                  │ UPDATE counters / INSERT login_dtls▶│
  │◀── 200 {token,user} ─────────────│ jwt.sign()                        │
```

---

## 📂 File-to-Responsibility Map

| File | Role |
|------|------|
| `public/index.html` | The sign-in / sign-up UI (structure) |
| `public/css/styles.css` | All styling (the "look & feel") |
| `public/js/app.js` | Client validation, tab switching, API calls, toasts |
| `src/server.js` | Express app: static files, routes, error handler, startup |
| `src/routes/auth.js` | Route definitions + express-validator rules + JWT middleware |
| `src/controllers/authController.js` | Core auth logic: signup, login, me, audit log |
| `src/config/db.js` | Data layer: Oracle pool **or** in-memory mock; `query()` dispatch |
| `sql/schema.sql` | Oracle DDL for `signup_dtls` and `login_dtls` |
| `tests/*.test.js` | Jest + Supertest coverage |
| `.env` | Runtime config (currently `USE_MOCK_DB=true`) |

---

## ✅ Quick answers to your 3 questions

1. **Where are signup/signin details stored & validated?**
   - **Validated** on the client (`public/js/app.js`) *and* re-validated on the server
     (`src/routes/auth.js` + `src/controllers/authController.js`).
   - **Stored** in table **`signup_dtls`** (users) and **`login_dtls`** (login audit log) —
     via the data layer `src/config/db.js`.

2. **Is Oracle DB storing this data right now?**
   - **Yes.** The app is in **real Oracle mode** (`USE_MOCK_DB=false`, health returns
     `"mode":"oracle"`). Data is persisted in `SIGNUP_DTLS` / `LOGIN_DTLS`. Originally it was
     not — three bugs (mock flag, invalid `fetchTypeHandler`, missing commits) were found and
     fixed; full evidence is in `signup.md`. Set `USE_MOCK_DB=true` to use the in-memory mock.

3. **What does Node.js do?**
   - Runs the Express web server, serves the frontend, parses & validates requests, hashes
     passwords (bcrypt), issues JWTs, enforces account lockout, writes the login audit log,
     talks to the database (Oracle or mock) through one data-access layer, loads `.env`
     config, and handles errors — all without storing data itself.