# WalkWell — Homepage Setup & Run Process

This document records the steps to set up, run, and publish the WalkWell sign-in / sign-up
website (built with standard HTML + CSS, Node.js/Express backend, and Oracle-ready storage)
as your homepage.

---

## ✅ Prerequisites

- **Node.js** (v18+) installed. Verify with:

  ```powershell
  node --version
  npm --version
  ```

  If not installed, download the LTS build from <https://nodejs.org>.

- (Optional) **Oracle Database** access if you want the real database instead of the
  built-in mock store.

---

## 🚀 Steps to Run the Website

### 1. Open a terminal in the project folder

```powershell
cd D:\HomePage
```

### 2. Install dependencies (first run, or after `package.json` changes)

```powershell
npm install
```

### 3. (Optional) Configure the database

The app runs out-of-the-box with a **built-in mock database** (no Oracle needed) because
`.env` contains `USE_MOCK_DB=true`.

To use a **real Oracle DB** instead, edit `.env`:

```
USE_MOCK_DB=false
ORACLE_USER=your_user
ORACLE_PASSWORD=your_password
ORACLE_CONNECTION_STRING=host:1521/SERVICE
```

Then create the tables once by running `sql/schema.sql` in your Oracle client
(SQL*Plus / SQL Developer).

### 4. Start the server

```powershell
npm start
```

Expected output:

```
[db] using in-memory MOCK database
Walking App running at http://localhost:3000
```

### 5. Open it in your browser

- **Sign in:** <http://localhost:3000>
- **Sign up:** <http://localhost:3000/?tab=signup>

The page is now live. To stop it, press `Ctrl + C` in the terminal.

---

## 🏠 Set It as Your Homepage

### Option A — Browser homepage (quickest)

1. Open **http://localhost:3000** in Chrome / Edge.
2. Configure startup page:
   - **Chrome:** Settings → *On startup* → "Open a specific page" → Add `http://localhost:3000`.
   - **Edge:** Settings → *Start, home, and new tabs* → "Open these pages" → Add `http://localhost:3000`.
3. Whenever the browser opens (with the server running), the site loads first.

> ⚠️ The server must be running for the homepage to load. Use Option B to auto-start it.

### Option B — Auto-start with Windows (recommended)

So the homepage always works without manually running `npm start`:

1. Create `start-walking-app.bat` in `D:\HomePage`:

   ```bat
   @echo off
   cd /d D:\HomePage
   start "" http://localhost:3000
   npm start
   ```

2. Press `Win + R`, type `shell:startup`, press Enter (opens the Startup folder).
3. Copy a shortcut to `start-walking-app.bat` into that folder.

Now the site launches and the browser opens it automatically at every login.

---

## 🔧 Useful Commands

| Task | Command |
|------|---------|
| Start server | `npm start` |
| Run tests | `npm test` |
| Syntax check | `npm run check` |
| Use a different port | set `PORT=4000` in `.env`, then `npm start` |

---

## 🧪 Tests

```powershell
npm test
```

Covers: signup success / duplicate / validation, login success / wrong password / lockout,
SQL-injection resistance, protected route, and static file serving.

---

## ⚙️ Configuration (`.env`)

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | HTTP port | `3000` |
| `USE_MOCK_DB` | `true` = in-memory store, `false` = real Oracle | `true` |
| `ORACLE_USER` | Oracle username | — |
| `ORACLE_PASSWORD` | Oracle password | — |
| `ORACLE_CONNECTION_STRING` | `host:port/SERVICE` | `localhost:1521/FREEPDB1` |
| `JWT_SECRET` | Secret used to sign tokens | change in production |
| `MAX_FAILED_ATTEMPTS` | Failures before lockout | `5` |
| `LOCKOUT_MINUTES` | Lockout duration | `15` |

---

## ❓ Common Issues

- **"npm not recognized"** → Node.js isn't installed or not on PATH. Reinstall Node LTS and
  reopen the terminal.
- **"Port 3000 already in use"** → another app uses the port. Change `PORT` in `.env`
  (e.g. `PORT=4000`) or stop the other process.
- **Login shows "Network error"** → the server isn't running. Run `npm start` first.
- **Blank page** → make sure you visit `http://localhost:3000` (not a `file://` path).

---

## 📸 Preview Screenshots

Rendered previews captured from the running app:

- `preview-login.png` — Sign in (desktop)
- `preview-signup.png` — Sign up (desktop)
- `preview-mobile.png` — Mobile layout

---

## 🔒 Notes

- Passwords are **bcrypt-hashed** (one-way, never stored in plaintext).
- All database access uses **parameterized queries** (SQL-injection safe).
- Login attempts are logged to `login_dtls` and accounts lock after repeated failures.