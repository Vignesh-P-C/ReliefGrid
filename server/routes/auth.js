const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

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

  try {
    await createUser({ name, phone, email, password, role: 'Volunteer' }, res);
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

  try {
    await createUser({ name, phone, email, password, role }, res);
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
    const result = await pool.query('SELECT * FROM Users WHERE phone = $1', [phone]);
    const user = result.rows[0];
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
