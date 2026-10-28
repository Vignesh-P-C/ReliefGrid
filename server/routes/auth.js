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

  try {
    const user = await findUserByPhone(phone);
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

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
