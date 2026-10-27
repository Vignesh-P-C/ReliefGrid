const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { normalisePhone } = require('../lib/phone');

const router = express.Router();

// Matches Users.name/Users.phone column limits in schema.sql (Audit #34).
const NAME_MAX_LENGTH = 100;
const PHONE_MAX_LENGTH = 15;

function validateNameAndPhone(name, phone) {
  if (typeof name !== 'string' || name.trim() === '' || name.trim().length > NAME_MAX_LENGTH) {
    return `name is required and must be ${NAME_MAX_LENGTH} characters or fewer`;
  }
  // Separators are not part of the number, so they do not count against the
  // column limit: "+91 98765 43210" is well inside it once they are removed.
  const normalisedPhone = normalisePhone(phone);
  if (normalisedPhone === '' || normalisedPhone.length > PHONE_MAX_LENGTH) {
    return `phone is required and must be at most ${PHONE_MAX_LENGTH} digits (spaces, dashes and brackets are ignored)`;
  }
  return null;
}

// Numbers are stored normalised, so login has to normalise too — otherwise the
// person who registered as "+91 98765 43210" could never sign in. The raw value
// is a second candidate so accounts created before this rule (which may hold
// separators within the 15-character limit) keep working.
async function findUserByPhone(phone) {
  const raw = typeof phone === 'string' ? phone.trim() : String(phone ?? '');
  const normalised = normalisePhone(raw);
  const candidates = normalised === raw ? [raw] : [raw, normalised];

  for (const candidate of candidates) {
    const result = await pool.query('SELECT * FROM Users WHERE phone = $1', [candidate]);
    if (result.rowCount > 0) return result.rows[0];
  }
  return undefined;
}

async function createUser({ name, phone, email, password, role }, res) {
  const password_hash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    `INSERT INTO Users (name, phone, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING user_id, name, phone, role`,
    [name, phone, email || null, password_hash, role]
  );
  res.status(201).json(result.rows[0]);
}

// ------------------------------------------------------------
// Login throttling (Audit #50)
// ------------------------------------------------------------
//
// Keyed by the number being tried and the caller's address, so one attacked
// account cannot be used to lock out everybody, and one address cannot try a
// long list of numbers. In-memory on purpose: the API is a single process, and
// a Map has no operational cost. It resets on deploy, and a shared store would
// be needed behind more than one instance.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const loginFailures = new Map();

function throttleKey(req, phone) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return `${phone}|${forwarded || req.ip || 'unknown'}`;
}

function blockedForMs(key) {
  const entry = loginFailures.get(key);
  if (!entry || !entry.blockedUntil) return 0;
  const remaining = entry.blockedUntil - Date.now();
  if (remaining <= 0) {
    loginFailures.delete(key);
    return 0;
  }
  return remaining;
}

function recordLoginFailure(key) {
  const now = Date.now();
  const entry = loginFailures.get(key) || { count: 0, firstFailedAt: now, blockedUntil: 0 };
  if (now - entry.firstFailedAt > LOGIN_WINDOW_MS) {
    entry.count = 0;
    entry.firstFailedAt = now;
    entry.blockedUntil = 0;
  }
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_FAILURES) entry.blockedUntil = now + LOGIN_WINDOW_MS;
  loginFailures.set(key, entry);

  // Bounded memory: drop finished entries once the map is worth walking.
  if (loginFailures.size > 1000) {
    for (const [candidate, value] of loginFailures) {
      const expiry = value.blockedUntil || value.firstFailedAt + LOGIN_WINDOW_MS;
      if (expiry <= now) loginFailures.delete(candidate);
    }
  }
}

// GET /api/auth/me — lets the dashboard rebuild its session from the token it
// already holds, instead of forcing a fresh sign-in after a reload (Audit #46).
// The role is read from the database rather than trusted from the token, so a
// role change takes effect on the next reload.
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT user_id, name, role FROM Users WHERE user_id = $1',
      [req.user.user_id]
    );
    if (result.rowCount === 0) {
      return res.status(401).json({ message: 'This account no longer exists' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load the signed-in account' });
  }
});

// POST /api/auth/register — public self-registration. Always creates a
// Volunteer account; it cannot be used to grant Admin/ShelterCoordinator.
router.post('/register', async (req, res) => {
  const { name, phone, email, password } = req.body;
  if (!name || !phone || !password) {
    return res.status(400).json({ message: 'name, phone, and password are required' });
  }
  const validationError = validateNameAndPhone(name, phone);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  try {
    await createUser({ name: name.trim(), phone: normalisePhone(phone), email, password, role: 'Volunteer' }, res);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'A user with that phone number already exists' });
    }
    console.error(err);
    res.status(500).json({ message: 'Registration failed' });
  }
});

// POST /api/auth/register/staff — Admin-only. Creates Admin/ShelterCoordinator
// accounts; this is the only way to grant an elevated role.
router.post('/register/staff', requireAuth, requireRole('Admin'), async (req, res) => {
  const { name, phone, email, password, role } = req.body;
  if (!name || !phone || !password || !['Admin', 'ShelterCoordinator'].includes(role)) {
    return res.status(400).json({ message: 'name, phone, password, and a role of Admin or ShelterCoordinator are required' });
  }
  const validationError = validateNameAndPhone(name, phone);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  try {
    await createUser({ name: name.trim(), phone: normalisePhone(phone), email, password, role }, res);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'A user with that phone number already exists' });
    }
    console.error(err);
    res.status(500).json({ message: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ message: 'phone and password are required' });
  }

  const key = throttleKey(req, String(phone).trim());
  const blockedFor = blockedForMs(key);
  if (blockedFor > 0) {
    const minutes = Math.ceil(blockedFor / 60000);
    res.set('Retry-After', String(Math.ceil(blockedFor / 1000)));
    return res.status(429).json({
      message: `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    });
  }

  try {
    const user = await findUserByPhone(phone);
    if (!user) {
      recordLoginFailure(key);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      recordLoginFailure(key);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    loginFailures.delete(key);
    const token = jwt.sign(
      { user_id: user.user_id, role: user.role, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({ token, user: { user_id: user.user_id, name: user.name, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Login failed' });
  }
});

module.exports = router;
