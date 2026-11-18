const express = require('express');
const { body } = require('express-validator');
const jwt = require('jsonwebtoken');
const { signup, login, me } = require('../controllers/authController');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

// Signup validation
const signupRules = [
  body('userId').trim().isLength({ min: 3, max: 50 }).withMessage('User ID must be 3-50 chars.'),
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Name required (max 100).'),
  body('password').isLength({ min: 8, max: 72 }).withMessage('Password must be 8-72 chars.'),
];

// Login validation
const loginRules = [
  body('userId').trim().notEmpty().withMessage('User ID required.'),
  body('password').notEmpty().withMessage('Password required.'),
];

function validate(req, res, next) {
  const { validationResult } = require('express-validator');
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ ok: false, message: errors.array()[0].msg });
  }
  next();
}

// Auth middleware for protected routes
function requireAuth(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, message: 'No token provided.' });
  try {
    req.authUser = jwt.verify(token, JWT_SECRET);
    next();
  } catch (_) {
    return res.status(401).json({ ok: false, message: 'Invalid or expired token.' });
  }
}

router.post('/signup', signupRules, validate, signup);
router.post('/login', loginRules, validate, login);
router.get('/me', requireAuth, me);

module.exports = router;