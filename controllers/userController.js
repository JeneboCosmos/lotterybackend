 const db = require('../config/db'); // mysql2/promise connection
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// CREATE (REGISTER)
exports.register = async (req, res) => {
  const { username, email, phone, password, role, agent_id } = req.body;
  console.log('📥 Register Request:', { username, email, role, agent_id });

  // Only allow writer, agent, or admin
  if (!['writer', 'agent', 'admin'].includes(role)) {
    return res.status(400).json({ msg: 'Invalid role selected' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const role_id = `${role}-${Date.now()}`; // Always generate role_id

  try {
    const sql = `
      INSERT INTO users (username, email, phone, password, role, role_id, agent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    await db.query(sql, [
      username,
      email,
      phone,
      hashedPassword,
      role,
      role_id,
      role === 'writer' ? agent_id : null
    ]);

    console.log('✅ User registered successfully:', username);
    res.status(201).json({
      msg: 'User registered successfully',
      user: { username, email, phone, role, role_id, agent_id: role === 'writer' ? agent_id : null }
    });
  } catch (err) {
    console.error('❌ DB Error during registration:', err.message);
    res.status(500).json({ msg: err.message });
  }
};

// LOGIN



exports.login = async (req, res) => { 
  const { email, password, platform_reference } = req.body;
  console.log('📥 Login Request:', { email, platform_reference });

  if (!email || !password) {
    return res.status(400).json({ msg: 'Email and password are required' });
  }

  try {
    // 1️⃣ Fetch user by email
    const [results] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (results.length === 0) {
      return res.status(400).json({ msg: 'Invalid email or password' });
    }

    const user = results[0];

    if (user.is_enabled === 0) {
      return res.status(403).json({ msg: 'Account is disabled. Please contact admin.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: 'Invalid email or password' });
    }

    let platform = null;

    // 2️⃣ Validate platform_reference for agent
    if (user.role === 'agent') {
      if (!platform_reference) {
        return res.status(400).json({ msg: 'Platform reference is required for agents' });
      }

      const [platformRows] = await db.query(
        'SELECT * FROM platforms WHERE platform_reference = ? AND agent_id = ?',
        [platform_reference, user.user_id]
      );

      if (platformRows.length === 0) {
        return res.status(400).json({ msg: 'Invalid platform reference for this agent' });
      }

      platform = platformRows[0];
    }

    // 3️⃣ Validate platform_reference for writer
    if (user.role === 'writer') {
      if (!platform_reference) {
        return res.status(400).json({ msg: 'Platform reference is required for writers' });
      }

      const [platformRows] = await db.query(
        'SELECT * FROM platforms WHERE platform_reference = ? AND agent_id = ?',
        [platform_reference, user.agent_id]
      );

      if (platformRows.length === 0) {
        return res.status(400).json({ msg: 'Invalid platform reference for this writer\'s agent' });
      }

      platform = platformRows[0];
    }

    // ✅ Admin login uses only email + password (no platform check)
    if (user.role === 'admin') {
      console.log('🔐 Admin login - using only email and password');

      const token = jwt.sign(
        { user_id: user.user_id, role: user.role, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
      );

      console.log(`✅ ADMIN login successful for:`, user.username);

      return res.json({
        msg: 'Admin login successful',
        token,
        user: {
          user_id: user.user_id,
          username: user.username,
          role: user.role,
          email: user.email,
          phone: user.phone,
          role_id: user.role_id,
          balance: user.balance
        }
      });
    }

    // 4️⃣ Fetch the POS linked to this platform (for agent/writer)
    const [posRows] = await db.query(
      `SELECT pos_id, status AS pos_status, platform_reference
       FROM pos_devices
       WHERE platform_reference = ?`,
      [platform.platform_reference]
    );

    if (posRows.length === 0) {
      console.warn('⚠️ No POS found for platform:', platform.platform_reference);
    }

    const pos = posRows[0] || null;
    const pos_id = pos ? pos.pos_id : null;

    // 5️⃣ Generate JWT token
    const token = jwt.sign(
      { user_id: user.user_id, role: user.role, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    console.log(`✅ ${user.role} login successful for:`, user.username);

    // 6️⃣ Send final response
    res.json({
      msg: 'Login successful',
      token,
      user: {
        user_id: user.user_id,
        username: user.username,
        role: user.role,
        email: user.email,
        phone: user.phone,
        role_id: user.role_id,
        agent_id: user.agent_id,
        balance: user.balance,
        pos_id,           // single POS linked to the platform
        platform          // platform info
      }
    });
  } catch (err) {
    console.error('❌ DB Error during login:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
};

// Get all users
exports.getAllUsers = async (req, res) => {
  try {
    const [results] = await db.query('SELECT * FROM users');
    res.json(results);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// Get user by ID
exports.getUserById = async (req, res) => {
  const { id } = req.params;
  try {
    const [results] = await db.query('SELECT * FROM users WHERE user_id = ?', [id]);
    if (results.length === 0) return res.status(404).json({ msg: 'User not found' });
    res.json(results[0]);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// Update user by ID
exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const { username, email, phone } = req.body;
  try {
    const sql = 'UPDATE users SET username = ?, email = ?, phone = ? WHERE user_id = ?';
    await db.query(sql, [username, email, phone, id]);
    res.json({ msg: 'User updated successfully' });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// Delete user by ID
exports.deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM users WHERE user_id = ?', [id]);
    res.json({ msg: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// Enable or disable user
exports.toggleUserStatus = async (req, res) => {
  const { id } = req.params;
  const { is_enabled } = req.body;

  console.log('📥 Toggle Request:', { user_id: id, is_enabled });

  if (typeof is_enabled !== 'number' || ![0, 1].includes(is_enabled)) {
    console.warn('⚠️ Invalid is_enabled value:', is_enabled);
    return res.status(400).json({ msg: 'Invalid value for is_enabled (must be 0 or 1)' });
  }

  try {
    const sql = 'UPDATE users SET is_enabled = ? WHERE user_id = ?';
    const [result] = await db.query(sql, [is_enabled, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ msg: 'User not found' });
    }

    res.json({ msg: `User has been ${is_enabled ? 'enabled' : 'disabled'} successfully.` });
  } catch (err) {
    console.error('❌ Error in toggleUserStatus:', err.message);
    res.status(500).json({ msg: err.message });
  }
};

// Get all writers for a specific agent
exports.getWritersByAgent = async (req, res) => {
  const { agentId } = req.params;
  try {
    const [writers] = await db.query(
  "SELECT * FROM users WHERE role = ? AND agent_id = ?",
  ['writer', agentId]
);

    res.json(writers);
  } catch (err) {
    console.error('❌ Error fetching writers by agent:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
};


