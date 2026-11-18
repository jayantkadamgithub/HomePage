# Signup / Signin → Real Oracle DB — Investigation & Test Report

**File:** `signup.md`
**Date:** 2026-11-18
**Project:** WalkWell sign-in / sign-up (Node.js + Express + Oracle)
**Requested by user:** "Check why data is not inserted into Oracle DB (real) while signup and signin the user, provide detailed test report."

---

## 1. Executive Summary

Signup/signin data was **not** reaching the real Oracle DB. Investigation found **three independent root causes**, all now fixed and verified.

| # | Root cause | Impact | Status |
|---|-----------|--------|--------|
| **RC-1** | `.env` had `USE_MOCK_DB=true` | Every query was routed to an in-memory JavaScript `Map`, never to Oracle. This was the **primary** reason. | ✅ Fixed — set to `false` |
| **RC-2** | `oracledb.fetchTypeHandler = false` | Oracle init threw **`NJS-004: invalid value for property "fetchTypeHandler"`**. Even with correct credentials, the Oracle path could not start. | ✅ Fixed — removed the invalid assignment |
| **RC-3** | Oracle writes were never committed | `conn.close()` silently **rolled back** INSERTs/UPDATEs. Signup returned `201 OK` but the row vanished. Audit log writes were also swallowed by an empty `catch`. | ✅ Fixed — autoCommit for DML + explicit `LOGIN_ID` |

**Current state:** the app is running in **real Oracle mode** (`health` returns `{"ok":true,"mode":"oracle"}`), and a live HTTP signup + signin was verified to persist rows in `signup_dtls` and `login_dtls`.

---

## 2. Environment / Test Setup

| Item | Value |
|------|-------|
| Node.js | project `package.json` (oracledb 6.10.0) |
| DB host | `localhost:1521/FREEPDB1` |
| DB user | `demouser` (verified: `SELECT USER FROM dual` → `DEMOUSER`) |
| Tables present | `SIGNUP_DTLS`, `LOGIN_DTLS` (confirmed via `USER_TABLES`) |
| App URL | `http://localhost:3000` |
| Oracle driver mode | thin mode (no Instant Client) |

> A listener was confirmed on port 1521 (`Test-NetConnection ... → True`, owning PID 24764). Credentials `demouser/demouser` connect successfully; `walking_app/walking_app_pw` and `system/oracle` fail with `ORA-01017`.

---

## 3. Investigation Detail (per root cause)

### RC-1 — Mock mode was active (primary cause)

**Evidence:**
- `.env` line 11: `USE_MOCK_DB=true`
- `src/config/db.js` line 11: `let useMock = String(process.env.USE_MOCK_DB ... ) === 'true';`
- `query()` (line 31–45) dispatches to `runMock()` when `useMock` is true.
- Live health check before fix: `{"ok":true,"mode":"mock"}`

**What happened:** signup INSERTs went into `mock.users` — a plain JavaScript `Map` in the Node process's RAM. It is not persisted anywhere and is wiped on restart. The API still returned `201 {"ok":true,...}`, so it *looked* like success while Oracle received nothing.

**Fix applied:** `.env` now has `USE_MOCK_DB=false` with the real credentials uncommented:
```
ORACLE_USER=demouser
ORACLE_PASSWORD=demouser
ORACLE_CONNECTION_STRING=localhost:1521/FREEPDB1
USE_MOCK_DB=false
```
Server restarted; health now returns `{"ok":true,"mode":"oracle"}`.

---

### RC-2 — Invalid oracledb property (would have blocked Oracle anyway)

**Evidence — diagnostic output after first flipping the flag:**
```
[ORACLE] attempting init with -> localhost:1521/FREEPDB1
[ORACLE] CONNECTION FAILED: NJS-004: invalid value for property "fetchTypeHandler"
[ORACLE] code = NJS-004
```

**Cause:** `src/config/db.js` contained:
```js
oracledb.fetchTypeHandler = false;   // invalid in oracledb 6.x
```
In node-oracledb 6.x, `fetchTypeHandler` must be a **function or undefined**; `false` throws NJS-004.

**Fix applied:** removed the assignment (kept only `oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;`). After the fix, `db.init()` connected successfully.

---

### RC-3 — Writes rolled back + audit errors swallowed

**Test:** `test-oracle-signup.js` called `authController.signup()` through the real Oracle path, then queried `signup_dtls` from a **separate** connection.

**Before fix:**
```
[SIGNUP RESPONSE] status = 201 | ok = true
[AFTER SIGNUP] signup_dtls rows=1, login_dtls rows=0
[RESULT] DATA NOT PERSISTED
```
The row count was 1 only within the same session; from a separate connection it was 0 — the INSERT had been rolled back when `conn.close()` ran.

**Cause 3a — no commit:** `query()` called `conn.execute(...)` and then `conn.close()`. node-oracledb rolls back uncommitted work on close.

**Fix 3a:** `query()` now forces `autoCommit: true` for `INSERT/UPDATE/DELETE/MERGE`:
```js
const op = sql.trim().split(/\s+/)[0].toUpperCase();
if (['INSERT','UPDATE','DELETE','MERGE'].includes(op)) {
  options = Object.assign({}, options, { autoCommit: true });
}
```

**Cause 3b — login audit INSERT failed silently:** direct probe of the exact `logAttempt()` SQL returned:
```
ORA-01400: cannot insert NULL into ("DEMOUSER"."LOGIN_DTLS"."LOGIN_ID")
```
The live table's `LOGIN_ID` has no working auto-generation, and `logAttempt()` had an empty `catch (_) {}` that hid the error.

**Fix 3b:** explicitly generate the ID in the INSERT (works with both the provided `schema.sql` `BY DEFAULT ON NULL` identity and the live table):
```sql
INSERT INTO login_dtls
 (LOGIN_ID, USER_ID, LOGIN_DATE, LOGIN_TIME, IP_ADDRESS, STATUS, USER_AGENT, CREATED_DATE)
VALUES
 ((SELECT NVL(MAX(LOGIN_ID),0)+1 FROM login_dtls),
  :userId, SYSDATE, :loginTime, :ip, :status, :userAgent, SYSDATE)
```
The empty catch was replaced with a logged error:
```js
console.error('[audit] failed to write login_dtls:', err.message);
```

---

## 4. Test Results

### Test A — Real Oracle data-layer regression (`test-oracle-signup.js`)
```
===== TEST: REAL ORACLE PATH =====
[BEFORE]           signup_dtls rows=0, login_dtls rows=0
[SIGNUP]           status = 201 | ok = true
[AFTER SIGNUP]     signup_dtls rows=1, login_dtls rows=0, hash=$2a$12$...
[LOGIN]            status = 200 | ok = true
[AFTER LOGIN]      signup_dtls rows=1, login_dtls rows=1
[LOGIN WRONG]      status = 401 | remaining = 4
[AFTER WRONG LOGIN] signup_dtls rows=1, login_dtls rows=2
[AUDIT STATUS BREAKDOWN] [{"STATUS":"SUCCESS","N":1},{"STATUS":"FAILED","N":1}]
[USER COUNTERS]    {"FAILED_ATTEMPTS":1,"LAST_LOGIN_TIME":"05:36:14"}
[RESULT] PASS — signup + signin data PERSISTED in real Oracle
```

### Test B — Live HTTP end-to-end against running server
```
POST /api/signup {userId:'live_probe_user'} → 201 (first call), duplicate → 409
POST /api/login  {userId:'live_probe_user', password:'livepass123'} → 200 + JWT
GET  /api/health → {"ok":true,"mode":"oracle"}
```
Verified from a **separate Oracle connection** (`verify-oracle.js`):
```
[signup_dtls] [{"USER_ID":"live_probe_user","NAME":"Live Probe",
  "PASSWORD_HASH":"$2a$12$Dwd...","CREATED_DATE":"2026-11-18T05:36:54Z",
  "CREATED_TIME":"05:36:54","LAST_LOGIN_TIME":"05:36:55","FAILED_ATTEMPTS":0}]
[login_dtls] [{"LOGIN_ID":1,"STATUS":"SUCCESS","LOGIN_TIME":"05:36:55","IP_ADDRESS":"::1"}]
```
✅ Password stored as **bcrypt hash** (never plaintext).
✅ Login attempt recorded with `SUCCESS` status.
✅ All temporary test rows were deleted afterwards.

### Test C — Existing automated suite
```
npm run check  → clean (all 5 JS files parse)
npm test       → Test Suites: 2 passed, 2 total; Tests: 21 passed, 21 total
```

---

## 5. Where Data Is Stored / Validated (recap)

| Concern | Answer |
|---------|--------|
| Signup user row | Oracle table **`SIGNUP_DTLS`** (USER_ID PK, NAME, PASSWORD_HASH, dates, IS_ACTIVE, FAILED_ATTEMPTS, LOCKED_UNTIL) |
| Signin events | Oracle table **`LOGIN_DTLS`** (LOGIN_ID, USER_ID, dates, IP, STATUS, USER_AGENT) |
| Password | **bcrypt hash** in `PASSWORD_HASH` (one-way, salted) |
| Validation | Client (`public/js/app.js`) + server (`src/routes/auth.js` express-validator + `src/controllers/authController.js`) |
| Data layer | `src/config/db.js` `query()` — now commits writes and supports both Oracle and mock |

---

## 6. Files Changed During This Fix

| File | Change |
|------|--------|
| `.env` | `USE_MOCK_DB=false`; uncommented real Oracle credentials |
| `src/config/db.js` | Removed invalid `fetchTypeHandler`; added autoCommit for DML |
| `src/controllers/authController.js` | `logAttempt()` now supplies `LOGIN_ID` explicitly and logs audit errors |
| `flowprj.md` | Updated to reflect Oracle is now active (see that file) |
| `test-oracle-signup.js`, `verify-oracle.js` | Added as reusable diagnostics |

---

## 7. Current Status & How to Verify Yourself

The server is running in Oracle mode. Verify:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
# → {"ok":true,"mode":"oracle"}
```

Then register any user through the UI at http://localhost:3000/?tab=signup and check:

```sql
SELECT USER_ID, NAME, PASSWORD_HASH, CREATED_DATE FROM signup_dtls;
SELECT USER_ID, STATUS, LOGIN_TIME, IP_ADDRESS FROM login_dtls;
```

To revert to the in-memory mock (e.g. for offline dev), set `USE_MOCK_DB=true` in `.env` and restart.

---

## 8. Follow-up completed: concurrency-safe ID generation ✅

The original recommendation was to replace `MAX(LOGIN_ID)+1` with a sequence. This has been
**implemented**, but with a constraint discovered during the work: the app's DB user
`demouser` has only `CREATE TABLE`, `CREATE SESSION`, `CREATE PROCEDURE` — **no
`CREATE SEQUENCE` privilege** (verified via `USER_SYS_PRIVS`), and no DBA credentials were
available to grant it.

**Solution:** a database-backed **sequence emulator** — an `id_counter` table with an atomic
`UPDATE id_counter SET next_val = next_val + 1 ... RETURNING next_val - 1 INTO :id`.
This gives the same uniqueness guarantee as an Oracle sequence and is concurrency-safe.

**Changes made:**
| File | Change |
|------|--------|
| `sql/schema.sql` | `CREATE SEQUENCE` replaced with `id_counter` table + seed row |
| `migrate-counter.js` | Migration script (already run — `id_counter` exists in the live DB) |
| `src/config/db.js` | Added and exported `nextId(seqName)` using an OUT bind |
| `src/controllers/authController.js` | `logAttempt()` now calls `db.nextId('LOGIN_DTLS')` instead of `MAX()+1` |

**Verification:**
- 20 IDs allocated concurrently → **all unique** (`4, 21, 22, ... 23`).
- Full Oracle signup/signin regression → **PASS** (`login_dtls` rows 1, 2, 3...).
- Live HTTP signup + login → `LOGIN_ID = 3`, persisted and verified from a separate connection.
- `npm test` → 21/21 passing; `npm run check` → clean.

Remaining recommendations:
1. **Change `JWT_SECRET`** from the dev default to a long random value before production use.
2. **Add a startup schema check** so a missing `id_counter` / tables is detected immediately.
3. If a DBA later grants `CREATE SEQUENCE`, you may switch to a native `login_dtls_seq.NEXTVAL`.
