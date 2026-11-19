/**
 * Authentication controller: signup + login.
 * Uses bcrypt for password hashing and JWT for sessions.
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const MAX_FAILED = parseInt(process.env.MAX_FAILED_ATTEMPTS || '5', 10);
const LOCKOUT_MIN = parseInt(process.env.LOCKOUT_MINUTES || '15', 10);

function nowTime() {
  return new Date().toISOString().slice(11, 19); // HH:MM:SS
}

/**
 * POST /api/signup
 * body: { userId, name, password }
 */
async function signup(req, res, next) {
  try {
    const userId = String(req.body.userId || '').trim();
    const name = String(req.body.name || '').trim();
    const password = String(req.body.password || '');

    if (!userId || !name || !password) {
      return res.status(400).json({ ok: false, message: 'userId, name and password are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, message: 'Password must be at least 8 characters.' });
    }

    // Does user already exist?
    const existing = await db.query(
      'SELECT USER_ID FROM signup_dtls WHERE USER_ID = :userId',
      { userId }
    );
    if (existing.rows && existing.rows.length > 0) {
      return res.status(409).json({ ok: false, message: 'User ID already registered.' });
    }

    // Hash the password (bcrypt — irreversible, with salt)
    const hash = await bcrypt.hash(password, 12);

    await db.query(
      `INSERT INTO signup_dtls
         (USER_ID, NAME, PASSWORD_HASH, CREATED_DATE, CREATED_TIME,
          IS_ACTIVE, FAILED_ATTEMPTS)
       VALUES
         (:userId, :name, :hash, SYSDATE, :createdTime, 1, 0)`,
      { userId, name, hash, createdTime: nowTime() }
    );

    const token = jwt.sign({ userId, name }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.status(201).json({
      ok: true,
      message: 'Account created successfully.',
      token,
      user: { userId, name },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/login
 * body: { userId, password }
 */
async function login(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.ip || null;
  const userAgent = req.headers['user-agent'] || null;
  try {
    const userId = String(req.body.userId || '').trim();
    const password = String(req.body.password || '');

    if (!userId || !password) {
      return res.status(400).json({ ok: false, message: 'userId and password are required.' });
    }

    const result = await db.query(
      `SELECT USER_ID, NAME, PASSWORD_HASH, IS_ACTIVE,
              FAILED_ATTEMPTS, LOCKED_UNTIL
         FROM signup_dtls WHERE USER_ID = :userId`,
      { userId }
    );
    const user = result.rows && result.rows[0];

    if (!user) {
      // No signup_dtls row exists, so an audit insert would violate FK_LOGIN_USER.
      // Nothing to attach the attempt to — return 401 without logging.
      return res.status(401).json({ ok: false, message: 'Invalid credentials.' });
    }

    // Check lockout
    if (user.LOCKED_UNTIL && new Date(user.LOCKED_UNTIL) > new Date()) {
      await logAttempt(userId, ip, userAgent, 'LOCKED');
      return res.status(423).json({
        ok: false,
        message: 'Account temporarily locked. Try again later.',
      });
    }

    const match = await bcrypt.compare(password, user.PASSWORD_HASH);
    if (!match) {
      // Increment failed attempts
      const failed = (user.FAILED_ATTEMPTS || 0) + 1;
      const shouldLock = failed >= MAX_FAILED;
      await db.query(
        `UPDATE signup_dtls
            SET FAILED_ATTEMPTS = :failed,
                LOCKED_UNTIL = :lockedUntil
          WHERE USER_ID = :userId`,
        {
          userId,
          failed,
          lockedUntil: shouldLock
            ? new Date(Date.now() + LOCKOUT_MIN * 60 * 1000)
            : null,
        }
      );
      await logAttempt(userId, ip, userAgent, 'FAILED');
      return res.status(401).json({
        ok: false,
        message: 'Invalid credentials.',
        remainingAttempts: Math.max(0, MAX_FAILED - failed),
      });
    }

    // Success: reset counters, update last login
    await db.query(
      `UPDATE signup_dtls
          SET FAILED_ATTEMPTS = 0,
              LOCKED_UNTIL = NULL,
              LAST_LOGIN_DATE = SYSDATE,
              LAST_LOGIN_TIME = :loginTime
        WHERE USER_ID = :userId`,
      { userId, loginTime: nowTime() }
    );
    await logAttempt(userId, ip, userAgent, 'SUCCESS');

    const token = jwt.sign({ userId, name: user.NAME }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.status(200).json({
      ok: true,
      message: 'Login successful.',
      token,
      user: { userId: user.USER_ID, name: user.NAME },
    });
  } catch (err) {
    return next(err);
  }
}

async function logAttempt(userId, ip, userAgent, status) {
  try {
    // Atomic, concurrency-safe ID (Oracle sequence emulator). Mock mode returns
    // null and the mock store assigns its own sequential LOGIN_ID.
    const id = await db.nextId('LOGIN_DTLS');
    const withId = id !== null && id !== undefined;

    const cols = withId
      ? '(LOGIN_ID, USER_ID, LOGIN_DATE, LOGIN_TIME, IP_ADDRESS, STATUS, USER_AGENT, CREATED_DATE)'
      : '(USER_ID, LOGIN_DATE, LOGIN_TIME, IP_ADDRESS, STATUS, USER_AGENT, CREATED_DATE)';
    const vals = withId
      ? '(:id, :userId, SYSDATE, :loginTime, :ip, :status, :userAgent, SYSDATE)'
      : '(:userId, SYSDATE, :loginTime, :ip, :status, :userAgent, SYSDATE)';
    const binds = Object.assign(
      { userId, loginTime: nowTime(), ip, status, userAgent },
      withId ? { id } : {}
    );

    await db.query(`INSERT INTO login_dtls ${cols} VALUES ${vals}`, binds);
  } catch (err) {
    // Audit logging must never break the auth flow — but surface the reason.
    // eslint-disable-next-line no-console
    console.error('[audit] failed to write login_dtls:', err.message);
  }
}

/**
 * GET /api/me  (protected)
 */
function me(req, res) {
  return res.status(200).json({ ok: true, user: req.authUser });
}

module.exports = { signup, login, me, logAttempt };