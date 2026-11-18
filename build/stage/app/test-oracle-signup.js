/* Controlled test: signup AND signin through the app's REAL Oracle path.
   Verifies data is actually persisted from a separate connection.
   Creates temporary rows, then deletes them. */
process.env.USE_MOCK_DB = 'false';
process.env.ORACLE_USER = 'demouser';
process.env.ORACLE_PASSWORD = 'demouser';
process.env.ORACLE_CONNECTION_STRING = 'localhost:1521/FREEPDB1';
process.env.JWT_SECRET = 'test_secret';

const oracledb = require('oracledb');
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const db = require('./src/config/db.js');
const controller = require('./src/controllers/authController.js');

const TEST_USER = 'oracle_probe_user';
setTimeout(() => { console.error('[TIMEOUT] forcing exit'); process.exit(2); }, 30000).unref();

function freshConn() {
  return oracledb.getConnection({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectionString: process.env.ORACLE_CONNECTION_STRING,
  });
}

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

async function probe(label) {
  const conn = await freshConn();
  try {
    const u = await conn.execute('SELECT COUNT(*) N FROM signup_dtls WHERE USER_ID = :u', [TEST_USER]);
    const l = await conn.execute('SELECT COUNT(*) N FROM login_dtls WHERE USER_ID = :u', [TEST_USER]);
    let hash = '-';
    if (u.rows[0].N > 0) {
      const h = await conn.execute('SELECT PASSWORD_HASH FROM signup_dtls WHERE USER_ID = :u', [TEST_USER]);
      hash = h.rows[0].PASSWORD_HASH ? h.rows[0].PASSWORD_HASH.slice(0, 7) + '...' : 'NULL';
    }
    console.log(`[${label}] signup_dtls rows=${u.rows[0].N}, login_dtls rows=${l.rows[0].N}, hash=${hash}`);
    return { users: u.rows[0].N, logins: l.rows[0].N };
  } finally { await conn.close(); }
}

async function cleanup() {
  const conn = await freshConn();
  try {
    await conn.execute('DELETE FROM login_dtls WHERE USER_ID = :u', [TEST_USER], { autoCommit: true });
    await conn.execute('DELETE FROM signup_dtls WHERE USER_ID = :u', [TEST_USER], { autoCommit: true });
  } finally { await conn.close(); }
}

(async () => {
  await db.init();
  await cleanup();
  console.log('===== TEST: REAL ORACLE PATH =====');
  await probe('BEFORE');

  // --- SIGNUP ---
  const sres = fakeRes();
  await controller.signup(
    { body: { userId: TEST_USER, name: 'Oracle Probe', password: 'testpass123' } },
    sres, (e) => console.log('[signup err]', e && e.message)
  );
  console.log('[SIGNUP] status =', sres.statusCode, '| ok =', sres.body && sres.body.ok);
  const afterSignup = await probe('AFTER SIGNUP');

  // --- LOGIN (correct password) ---
  const lres = fakeRes();
  await controller.login(
    { body: { userId: TEST_USER, password: 'testpass123' }, headers: { 'user-agent': 'diagnostic' }, ip: '127.0.0.1' },
    lres, (e) => console.log('[login err]', e && e.message)
  );
  console.log('[LOGIN] status =', lres.statusCode, '| ok =', lres.body && lres.body.ok);
  const afterLogin = await probe('AFTER LOGIN');

  // --- LOGIN (wrong password) => should log FAILED + increment counter ---
  const wres = fakeRes();
  await controller.login(
    { body: { userId: TEST_USER, password: 'wrongpassword' }, headers: { 'user-agent': 'diagnostic' }, ip: '127.0.0.1' },
    wres, (e) => console.log('[login-wrong err]', e && e.message)
  );
  console.log('[LOGIN WRONG] status =', wres.statusCode, '| remaining =', wres.body && wres.body.remainingAttempts);
  const afterWrong = await probe('AFTER WRONG LOGIN');

  const conn = await freshConn();
  const stat = await conn.execute(
    "SELECT STATUS, COUNT(*) N FROM login_dtls WHERE USER_ID = :u GROUP BY STATUS", [TEST_USER]
  );
  console.log('[AUDIT STATUS BREAKDOWN]', JSON.stringify(stat.rows));
  const user = await conn.execute(
    'SELECT FAILED_ATTEMPTS, LAST_LOGIN_TIME FROM signup_dtls WHERE USER_ID = :u', [TEST_USER]
  );
  console.log('[USER COUNTERS]', JSON.stringify(user.rows[0]));
  await conn.close();

  console.log('[RESULT]',
    afterSignup.users === 1 && afterLogin.logins === 1 && afterWrong.logins === 2
      ? 'PASS — signup + signin data PERSISTED in real Oracle'
      : 'FAIL — data missing in Oracle');

  await cleanup();
  await db.close();
})().catch(async (e) => {
  console.error('[FATAL]', e.message);
  try { await cleanup(); } catch (_) {}
  try { await db.close(); } catch (_) {}
});
