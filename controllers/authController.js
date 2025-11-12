
const db = require('../config/db');       // MySQL database connection
const bcrypt = require('bcryptjs');       // Password hashing utility
const jwt = require('jsonwebtoken');      // Token generation
require('dotenv').config();               // Load environment variables


exports.register = (req, res) => {
  const { username, email, phone, password, role } = req.body;
  console.log('📥 Register Request:', { username, email, role });

  // Validate the provided role
  if (!['writer', 'agent', 'admin', 'player'].includes(role)) {
    console.warn('⚠️ Invalid role during registration:', role);
    return res.status(400).json({ msg: 'Invalid role' });
  }

  // Hash user password before saving
  const hashedPassword = bcrypt.hashSync(password, 10);

  // Generate a unique role ID (e.g., "writer-1730140900000")
  const role_id = `${role}-${Date.now()}`;

  // SQL query to insert a new user
  const sql = `
    INSERT INTO users (username, email, phone, password, role, role_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  // Execute the SQL query
  db.query(sql, [username, email, phone, hashedPassword, role, role_id], (err, result) => {
    if (err) {
      console.error('❌ DB Error during registration:', err.message);
      return res.status(500).json({ msg: err.message });
    }

    console.log('✅ User registered successfully:', username);
    res.status(201).json({
      msg: 'User registered successfully',
      user: { username, email, phone, role, role_id }
    });
  });
};

/**
 * @function login
 * @description Handles user login.
 *  - Verifies user existence by email.
 *  - Compares the provided password with the stored hash.
 *  - Generates and returns a JWT token.
 *
 * @route POST /api/auth/login
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {JSON} Token and authenticated user info.
 */





exports.login = (req, res) => {
  const { email, password } = req.body; // ✅ login by email
  console.log('📥 Login Request:', { email });

  // 1️⃣ Fetch user by email
  const userSql = `
    SELECT user_id, username, email, role, phone, balance, role_id, agent_id, password
    FROM users
    WHERE email = ?
  `;

  db.query(userSql, [email], (err, users) => {
    if (err) {
      console.error('❌ DB Error fetching user:', err.message);
      return res.status(500).json({ msg: err.message });
    }

    if (users.length === 0) {
      console.warn('⚠️ No user found for email:', email);
      return res.status(400).json({ msg: 'Invalid credentials' });
    }

    const user = users[0];
    console.log('✅ User found:', user);

    // 2️⃣ Verify password
    if (!user.password || !bcrypt.compareSync(password, user.password)) {
      console.warn('⚠️ Invalid password for:', email);
      return res.status(400).json({ msg: 'Invalid credentials' });
    }
    console.log('🔑 Password verified');

    // 3️⃣ Fetch all POS devices for this user
    

    db.query(posSql, [user.user_id], (err, posDevices) => {
      if (err) {
        console.error('❌ DB Error fetching POS devices:', err.message);
        return res.status(500).json({ msg: err.message });
      }

      console.log('💡 POS devices found:', posDevices);

      // 4️⃣ Map POS devices with platform info
      const posArray = posDevices.map(p => ({
        pos_id: p.pos_id,
        status: p.pos_status,
        platform: p.platform_id
          ? {
              platform_id: p.platform_id,
              platform_reference: p.platform_reference,
              platform_name: p.platform_name,
              balance: p.platform_balance,
              status: p.platform_status,
              agent_id: p.platform_agent_id,
              created_at: p.platform_created,
              updated_at: p.platform_updated,
              admin_id: p.platform_admin
            }
          : null
      }));

      // 5️⃣ First POS ID at top level (if exists)
      const firstPosId = posArray.length > 0 ? posArray[0].pos_id : null;

      // 6️⃣ Generate JWT token
      const token = jwt.sign(
        { user_id: user.user_id, role: user.role, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
      );
      console.log('🔐 JWT token generated');

      // 7️⃣ Build response object
      const responseUser = {
        user_id: user.user_id,
        username: user.username,
        role: user.role,
        email: user.email,
        phone: user.phone,
        role_id: user.role_id,
        agent_id: user.agent_id || null,
        balance: user.balance,
        pos_id: firstPosId,   // ✅ top-level POS ID
        pos_devices: posArray  // ✅ all POS devices
      };

      console.log('🚀 Final Response Object:', responseUser);

      res.json({
        msg: 'Login successful',
        token,
        user: responseUser
      });
    });
  });
};





