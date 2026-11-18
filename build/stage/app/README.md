# WalkWell — Walking App Sign-in / Sign-up

A clean, responsive sign-in and sign-up page for a **Walking Application**, built with **standard HTML + CSS** on the front end and a **Node.js / Express** API backed by **Oracle Database**.

Inspired by the Dribbble "Login Page — Walking Application" look: a soft mint-to-sky gradient hero panel with a walking illustration, a floating rounded form card, tabbed Sign in / Sign up, and smooth micro-interactions.

---

## ✨ Features

- **Split-screen UI** — hero illustration panel + floating form card
- **Tabbed Login / Signup** with animated slider
- **Client-side validation** with inline error messages
- **Password show/hide toggle**
- **Loading spinners**, success/error **toasts**
- **Responsive** (desktop, tablet, mobile) + `prefers-reduced-motion` support
- **Accessible** — semantic HTML, labels, ARIA, keyboard-friendly
- **Backend auth** — bcrypt password hashing, JWT sessions, account lockout
- **Login audit log** (`login_dtls`)
- **Tests** — Jest + Supertest integration & validation tests

---

## 🗂️ Project structure

```
D:\HomePage\
├── public\
│   ├── index.html            # Single-page login/signup UI
│   ├── css\styles.css        # All standard CSS
│   └── js\app.js             # Frontend logic (fetch calls)
├── src\
│   ├── server.js             # Express entry
│   ├── config\db.js          # Oracle pool + in-memory mock fallback
│   ├── routes\auth.js        # /api/login, /api/signup, /api/me
│   └── controllers\authController.js
├── sql\schema.sql            # Oracle DDL
├── tests\                    # Jest + Supertest
├── .env                      # Local config (gitignored)
├── .env.example              # Config template
└── package.json
```

---

## 🗄️ Database schema

### `signup_dtls` — user profile
| Column | Type | Notes |
|--------|------|-------|
| `USER_ID` | VARCHAR2(50) | PK |
| `NAME` | VARCHAR2(100) | |
| `PASSWORD_HASH` | VARCHAR2(255) | bcrypt hash — never plaintext |
| `CREATED_DATE` / `CREATED_TIME` | DATE / VARCHAR2 | |
| `LAST_LOGIN_DATE` / `LAST_LOGIN_TIME` | DATE / VARCHAR2 | |
| `IS_ACTIVE` | NUMBER(1) | |
| `FAILED_ATTEMPTS` | NUMBER | lockout tracking |
| `LOCKED_UNTIL` | DATE | |

### `login_dtls` — login audit log (1 row per attempt)
`LOGIN_ID` (PK) · `USER_ID` (FK) · `LOGIN_DATE` · `LOGIN_TIME` · `IP_ADDRESS` · `STATUS` (SUCCESS/FAILED/LOCKED) · `USER_AGENT` · `CREATED_DATE`

> **Design note:** user profile and login events are separated so you get a clean 1-to-many audit trail instead of overwriting login info.

---

## 🔒 Password "encryption" — important

Passwords are **hashed with bcrypt**, not reversibly encrypted. This is the industry standard:
- A one-way hash means even a DBA cannot recover the original password.
- bcrypt automatically generates a unique salt per password and is deliberately slow to resist brute force.

This satisfies "password must be protected in the database" while being far more secure than reversible encryption. If you specifically require reversible encryption (e.g. to email passwords — not recommended), tell me and I'll switch to AES-256 with a key, with an explicit security warning.

---

## 🚀 Quick start

### Option A — Run without Oracle (mock DB, fastest for preview)
```bash
npm install
# .env already sets USE_MOCK_DB=true
npm start
# open http://localhost:3000
```

### Option B — Run with a real Oracle database
1. Edit `.env`:
   ```
   USE_MOCK_DB=false
   ORACLE_USER=...
   ORACLE_PASSWORD=...
   ORACLE_CONNECTION_STRING=host:1521/SERVICE
   JWT_SECRET=a_long_random_secret
   ```
2. Run `sql/schema.sql` against your Oracle instance.
3. `npm start`

> Oracle **thin mode** is used, so no Instant Client install is needed.

---

## 🧪 Tests

```bash
npm test
```
Covers: signup success/duplicate/validation, login success/wrong-password/lockout, SQL-injection resistance, protected route, static file serving.

---

## 🔌 API

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/api/signup` | `{userId, name, password}` | `{ok, token, user}` |
| `POST` | `/api/login` | `{userId, password}` | `{ok, token, user}` |
| `GET` | `/api/me` | `Authorization: Bearer <token>` | `{ok, user}` |
| `GET` | `/api/health` | — | `{ok, mode}` |

---

## 🛡️ Security highlights

- bcrypt hashing (cost 12)
- JWT auth on protected routes
- Parameterized queries (no SQL injection)
- Account lockout after 5 failed attempts (15 min)
- Input validation & sanitization on client + server
- Secrets in `.env` (gitignored)