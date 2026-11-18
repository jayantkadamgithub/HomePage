const oracledb = require('oracledb');
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
const U = 'live_probe_user';
(async () => {
  const c = await oracledb.getConnection({ user: 'demouser', password: 'demouser', connectionString: 'localhost:1521/FREEPDB1' });
  try {
    const u = await c.execute('SELECT USER_ID, NAME, PASSWORD_HASH, CREATED_DATE, CREATED_TIME, LAST_LOGIN_TIME, FAILED_ATTEMPTS FROM signup_dtls WHERE USER_ID = :u', [U]);
    console.log('[signup_dtls]', JSON.stringify(u.rows.map(r => ({ ...r, PASSWORD_HASH: r.PASSWORD_HASH.slice(0,10)+'...' }))));
    const l = await c.execute('SELECT LOGIN_ID, STATUS, LOGIN_TIME, IP_ADDRESS FROM login_dtls WHERE USER_ID = :u ORDER BY LOGIN_ID', [U]);
    console.log('[login_dtls]', JSON.stringify(l.rows));
  } finally {
    await c.execute('DELETE FROM login_dtls WHERE USER_ID = :u', [U], { autoCommit: true });
    await c.execute('DELETE FROM signup_dtls WHERE USER_ID = :u', [U], { autoCommit: true });
    console.log('[CLEANUP] live test rows removed');
    await c.close();
  }
})().catch(e => console.error('ERR', e.message));
