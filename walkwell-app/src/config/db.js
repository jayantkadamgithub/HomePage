/**
 * Oracle DB connection + in-memory mock fallback.
 *
 * Set USE_MOCK_DB=true in .env to run without a real Oracle instance
 * (handy for local dev and for the automated test suite).
 * Set USE_MOCK_DB=false and provide Oracle credentials to use Oracle thin mode.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

let useMock = String(process.env.USE_MOCK_DB || '').toLowerCase() === 'true';
let oracledb = null;
let pool = null;

// ---------------------------------------------------------------------------
// MOCK STORE (in-memory) — used when USE_MOCK_DB=true
// ---------------------------------------------------------------------------
const mock = {
  users: new Map(),   // userId -> { ... }
  logins: [],         // array of login events
  seq: 1,
};

function mockReset() {
  mock.users.clear();
  mock.logins.length = 0;
  mock.seq = 1;
}

// Generic query runner that dispatches to mock or Oracle
async function query(sql, binds = {}, options = {}) {
  if (useMock) {
    return runMock(sql, binds, options);
  }
  const conn = await pool.getConnection();
  try {
    // CRITICAL: node-oracledb rolls back uncommitted work when a connection
    // is closed. DML (INSERT/UPDATE/DELETE) must be committed or signup/login
    // data silently disappears. Force autoCommit for write statements.
    const op = sql.trim().split(/\s+/)[0].toUpperCase();
    if (op === 'INSERT' || op === 'UPDATE' || op === 'DELETE' || op === 'MERGE') {
      options = Object.assign({}, options, { autoCommit: true });
    }
    const result = await conn.execute(sql, binds, options);
    return result;
  } finally {
    await conn.close();
  }
}

function runMock(sql, binds) {
  // Case-insensitive bind accessor (Oracle bind names are case-insensitive;
  // callers may send { userId } while SQL uses :USER_ID).
  const b = {};
  Object.keys(binds || {}).forEach(function (k) {
    b[k.toUpperCase()] = binds[k];
  });
  const has = function (key) { return Object.prototype.hasOwnProperty.call(b, key); };

  const s = sql.trim().toUpperCase();

  // INSERT into signup_dtls
  // Controller binds: :userId, :name, :hash, :createdTime
  if (s.startsWith('INSERT INTO SIGNUP_DTLS')) {
    mock.users.set(b.USERID, {
      USER_ID: b.USERID,
      NAME: b.NAME,
      PASSWORD_HASH: b.HASH,
      CREATED_DATE: new Date(),
      CREATED_TIME: b.CREATEDTIME || new Date().toISOString().slice(11, 19),
      LAST_LOGIN_DATE: null,
      LAST_LOGIN_TIME: null,
      IS_ACTIVE: 1,
      FAILED_ATTEMPTS: 0,
      LOCKED_UNTIL: null,
    });
    return { rowsAffected: 1, outBlobs: undefined };
  }

  // SELECT ... FROM signup_dtls WHERE USER_ID = :userId
  if (s.startsWith('SELECT') && s.includes('SIGNUP_DTLS') && s.includes('USER_ID =')) {
    const row = mock.users.get(b.USERID);
    return { rows: row ? [row] : [] };
  }

  // UPDATE signup_dtls — controller binds vary:
  //   fail:   :userId, :failed, :lockedUntil
  //   success::userId, :loginTime
  if (s.startsWith('UPDATE SIGNUP_DTLS')) {
    const user = mock.users.get(b.USERID);
    if (!user) return { rowsAffected: 0 };
    if (b.FAILED !== undefined) user.FAILED_ATTEMPTS = b.FAILED;
    if (has('LOCKEDUNTIL')) user.LOCKED_UNTIL = b.LOCKEDUNTIL;
    if (b.LOGINTIME !== undefined) user.LAST_LOGIN_TIME = b.LOGINTIME;
    if (b.LOGINTIME !== undefined) user.LAST_LOGIN_DATE = new Date();
    return { rowsAffected: 1 };
  }

  // INSERT into login_dtls — binds: :userId, :loginTime, :ip, :status, :userAgent
  if (s.startsWith('INSERT INTO LOGIN_DTLS')) {
    const id = mock.seq++;
    mock.logins.push({
      LOGIN_ID: id,
      USER_ID: b.USERID,
      LOGIN_DATE: new Date(),
      LOGIN_TIME: b.LOGINTIME || new Date().toISOString().slice(11, 19),
      IP_ADDRESS: b.IP || null,
      STATUS: b.STATUS,
      USER_AGENT: b.USERAGENT || null,
      CREATED_DATE: new Date(),
    });
    return { rowsAffected: 1, outBlobs: undefined };
  }

  // SELECT ... FROM login_dtls WHERE user_id = :userId
  if (s.startsWith('SELECT') && s.includes('LOGIN_DTLS')) {
    const rows = mock.logins
      .filter((r) => r.USER_ID === b.USERID)
      .sort((a, z) => z.LOGIN_ID - a.LOGIN_ID);
    return { rows };
  }

  // Simple health check
  if (s.startsWith('SELECT 1')) {
    return { rows: [{ '1': 1 }] };
  }

  return { rows: [] };
}

// ---------------------------------------------------------------------------
// ORACLE INIT (thin mode — no Instant Client required)
// ---------------------------------------------------------------------------
async function initOracle() {
  oracledb = require('oracledb');
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  // oracledb 6.x: fetchTypeHandler must be a function or undefined —
  // assigning false throws NJS-004 (invalid value for property).

  const connectionString =
    process.env.ORACLE_CONNECTION_STRING || 'localhost:1521/FREEPDB1';

  pool = await oracledb.createPool({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectionString,
    poolMin: 0,
    poolMax: 4,
    poolIncrement: 1,
  });
}

let initPromise = null;
async function init() {
  if (useMock) return; // nothing to do
  if (!initPromise) initPromise = initOracle();
  return initPromise;
}

/**
 * Allocate the next ID from a database-backed sequence emulator.
 * Uses an atomic UPDATE ... RETURNING so concurrent logins get unique IDs.
 * In mock mode the in-memory store assigns its own sequential ID.
 */
async function nextId(seqName) {
  if (useMock) return null;
  const orcl = oracledb || require('oracledb');
  const result = await query(
    'UPDATE id_counter SET next_val = next_val + 1 WHERE seq_name = :name RETURNING next_val - 1 INTO :id',
    {
      name: seqName,
      id: { dir: orcl.BIND_OUT, type: orcl.NUMBER },
    }
  );
  const v = result.outBinds && result.outBinds.id;
  return Array.isArray(v) ? v[0] : v;
}

async function healthCheck() {
  try {
    await query('SELECT 1 FROM dual');
    return { ok: true, mode: useMock ? 'mock' : 'oracle' };
  } catch (err) {
    return { ok: false, mode: useMock ? 'mock' : 'oracle', error: err.message };
  }
}

function isMock() {
  return useMock;
}

async function close() {
  if (pool) {
    try { await pool.close(10); } catch (_) { /* ignore */ }
    pool = null;
  }
}

module.exports = {
  query,
  init,
  nextId,
  healthCheck,
  close,
  isMock,
  mockReset,
  _setMock(v) { useMock = v; },
  _getOracle() { return oracledb; },
};