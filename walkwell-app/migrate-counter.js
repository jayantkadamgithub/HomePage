/* Migration: create the id_counter sequence emulator in the live Oracle DB. */
const oracledb = require('oracledb');
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
(async () => {
  const c = await oracledb.getConnection({ user: 'demouser', password: 'demouser', connectionString: 'localhost:1521/FREEPDB1' });
  try {
    const q = await c.execute("SELECT COUNT(*) CNT FROM USER_TABLES WHERE TABLE_NAME='ID_COUNTER'");
    if (q.rows[0].CNT === 0) {
      await c.execute('CREATE TABLE id_counter (SEQ_NAME VARCHAR2(50) NOT NULL, NEXT_VAL NUMBER NOT NULL, CONSTRAINT PK_ID_COUNTER PRIMARY KEY (SEQ_NAME))', [], { autoCommit: true });
      console.log('[DB] created id_counter table');
    } else {
      console.log('[DB] id_counter table already exists');
    }
    const r = await c.execute("SELECT COUNT(*) CNT FROM id_counter WHERE SEQ_NAME='LOGIN_DTLS'");
    if (r.rows[0].CNT === 0) {
      const m = await c.execute('SELECT NVL(MAX(LOGIN_ID),0) M FROM login_dtls');
      await c.execute("INSERT INTO id_counter (SEQ_NAME, NEXT_VAL) VALUES ('LOGIN_DTLS', :v)", [m.rows[0].M + 1], { autoCommit: true });
      console.log('[DB] seeded LOGIN_DTLS counter at', m.rows[0].M + 1);
    } else {
      const v = await c.execute("SELECT NEXT_VAL FROM id_counter WHERE SEQ_NAME='LOGIN_DTLS'");
      console.log('[DB] existing counter next_val =', v.rows[0].NEXT_VAL);
    }
  } finally { await c.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
