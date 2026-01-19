const db = require('../config/db'); // mysql2/promise connection
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const logger = require('../logs/logger'); // Import logger

// CREATE (REGISTER)
exports.register = async (req, res) => {
  const {
    username, email, phone, password, role, agent_id, platform_id,
    physical_address, digital_address, postal_address,
    guarantor_name, guarantor_phone,
    next_of_kin_name, next_of_kin_phone,
    ghana_card_number
  } = req.body;

  logger.info(`Register attempt - Username: ${username}, Email: ${email}, Role: ${role}`);

  if (!['writer', 'agent', 'admin'].includes(role)) {
    logger.warn(`Register failed - Invalid role: ${role}`);
    return res.status(400).json({ msg: 'Invalid role selected' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const role_id = `${role}-${Date.now()}`;

  try {
    const sql = `
      INSERT INTO users 
      (username, email, phone, password, role, role_id, 
       agent_id, platform_id, physical_address, digital_address, postal_address,
       guarantor_name, guarantor_phone,
       next_of_kin_name, next_of_kin_phone,
       ghana_card_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await db.query(sql, [
      username, email, phone, hashedPassword, role, role_id,
      role === 'writer' ? agent_id : null,
      role === 'writer' ? platform_id : null,
      physical_address, digital_address, postal_address,
      guarantor_name, guarantor_phone,
      next_of_kin_name, next_of_kin_phone,
      ghana_card_number
    ]);

    logger.info(`User registered successfully - Username: ${username}, Role: ${role}`);

    res.status(201).json({
      msg: 'User registered successfully',
      user: {
        username, email, phone, role, role_id,
        agent_id: role === 'writer' ? agent_id : null,
        platform_id: role === 'writer' ? platform_id : null
      }
    });
  } catch (err) {
    logger.error(`DB Error during registration - Username: ${username}, Error: ${err.message}`);
    res.status(500).json({ msg: err.message });
  }
};

// LOGIN
exports.login = async (req, res) => {
  const { email, password, platform_reference } = req.body;
  logger.info(`Login attempt - Email: ${email}, Platform: ${platform_reference}`);

  if (!email || !password) {
    logger.warn(`Login failed - Missing email or password`);
    return res.status(400).json({ msg: 'Email and password are required' });
  }

  try {
    const [results] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (results.length === 0) {
      logger.warn(`Login failed - Invalid email: ${email}`);
      return res.status(400).json({ msg: 'Invalid email or password' });
    }

    const user = results[0];

    if (user.is_enabled === 0) {
      logger.warn(`Login blocked - Disabled account: ${email}`);
      return res.status(403).json({ msg: 'Account is disabled. Please contact admin.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      logger.warn(`Login failed - Wrong password for: ${email}`);
      return res.status(400).json({ msg: 'Invalid email or password' });
    }

    let platform = null;

    if (user.role === 'agent') {
      if (!platform_reference) {
        logger.warn(`Login failed - Agent missing platform reference: ${email}`);
        return res.status(400).json({ msg: 'Platform reference is required for agents' });
      }
      const [platformRows] = await db.query(
        'SELECT * FROM platforms WHERE platform_reference = ? AND agent_id = ?',
        [platform_reference, user.user_id]
      );
      if (platformRows.length === 0) {
        logger.warn(`Login failed - Invalid platform reference for agent: ${email}`);
        return res.status(400).json({ msg: 'Invalid platform reference for this agent' });
      }
      platform = platformRows[0];
      if (platform.status === 'inactive') {
        logger.warn(`Login blocked - Inactive platform for agent: ${email}`);
        return res.status(403).json({ msg: 'This platform is currently inactive. Please contact your admin.' });
      }
    }

    if (user.role === 'writer') {
      if (!platform_reference) {
        logger.warn(`Login failed - Writer missing platform reference: ${email}`);
        return res.status(400).json({ msg: 'Platform reference is required for writers' });
      }
      const [platformRows] = await db.query(
        'SELECT * FROM platforms WHERE platform_reference = ? AND agent_id = ?',
        [platform_reference, user.agent_id]
      );
      if (platformRows.length === 0) {
        logger.warn(`Login failed - Invalid platform reference for writer's agent: ${email}`);
        return res.status(400).json({ msg: 'Invalid platform reference for this writer\'s agent' });
      }
      platform = platformRows[0];
      if (platform.status === 'inactive') {
        logger.warn(`Login blocked - Inactive platform for writer: ${email}`);
        return res.status(403).json({ msg: 'This platform is currently inactive. Please contact your agent.' });
      }
    }

    if (user.role === 'admin') {
      logger.info(`Admin login successful - Email: ${email}`);
      const token = jwt.sign({ user_id: user.user_id, role: user.role, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1d' });
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

    const [posRows] = await db.query(
      `SELECT pos_id, status AS pos_status, platform_reference
       FROM pos_devices
       WHERE platform_reference = ?`,
      [platform.platform_reference]
    );
    const pos = posRows[0] || null;
    const pos_id = pos ? pos.pos_id : null;

    const token = jwt.sign({ user_id: user.user_id, role: user.role, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1d' });

    logger.info(`Login successful - User ID: ${user.user_id}, Role: ${user.role}, Email: ${email}`);

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
        pos_id,
        platform
      }
    });

  } catch (err) {
    logger.error(`DB Error during login - Email: ${email}, Error: ${err.message}`);
    res.status(500).json({ msg: 'Internal server error' });
  }
};

// GET all users
exports.getAllUsers = async (req, res) => {
  try {
    const [results] = await db.query('SELECT * FROM users');
    logger.info('Fetched all users');
    res.json(results);
  } catch (err) {
    logger.error(`Error fetching users - ${err.message}`);
    res.status(500).json({ msg: err.message });
  }
};

// GET user by ID
exports.getUserById = async (req, res) => {
  const { id } = req.params;
  try {
    const [results] = await db.query('SELECT * FROM users WHERE user_id = ?', [id]);
    if (results.length === 0) {
      logger.warn(`User not found - ID: ${id}`);
      return res.status(404).json({ msg: 'User not found' });
    }
    logger.info(`Fetched user - ID: ${id}`);
    res.json(results[0]);
  } catch (err) {
    logger.error(`Error fetching user by ID - ${id}, Error: ${err.message}`);
    res.status(500).json({ msg: err.message });
  }
};

// UPDATE user
exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const {
    username, email, phone, physical_address, digital_address, postal_address,
    guarantor_name, guarantor_phone, next_of_kin_name, next_of_kin_phone, balance
  } = req.body;

  try {
    const sql = `
      UPDATE users 
      SET username = ?, email = ?, phone = ?, physical_address = ?, digital_address = ?, postal_address = ?, 
          guarantor_name = ?, guarantor_phone = ?, next_of_kin_name = ?, next_of_kin_phone = ?, balance = ?
      WHERE user_id = ?
    `;
    await db.query(sql, [username, email, phone, physical_address, digital_address, postal_address,
      guarantor_name, guarantor_phone, next_of_kin_name, next_of_kin_phone, balance, id
    ]);
    logger.info(`User updated - ID: ${id}, Updated by request`);
    res.json({ msg: 'User updated successfully' });
  } catch (err) {
    logger.error(`Error updating user - ID: ${id}, Error: ${err.message}`);
    res.status(500).json({ msg: err.message });
  }
};

// DELETE user
exports.deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM users WHERE user_id = ?', [id]);
    logger.info(`User deleted - ID: ${id}`);
    res.json({ msg: 'User deleted successfully' });
  } catch (err) {
    logger.error(`Error deleting user - ID: ${id}, Error: ${err.message}`);
    res.status(500).json({ msg: err.message });
  }
};

// TOGGLE user status
exports.toggleUserStatus = async (req, res) => {
  const { id } = req.params;
  const { is_enabled } = req.body;

  logger.info(`Toggle user status - User ID: ${id}, is_enabled: ${is_enabled}`);

  if (typeof is_enabled !== 'number' || ![0, 1].includes(is_enabled)) {
    logger.warn(`Invalid toggle value - User ID: ${id}, is_enabled: ${is_enabled}`);
    return res.status(400).json({ msg: 'Invalid value for is_enabled (must be 0 or 1)' });
  }

  try {
    // Get user role first
    const [[user]] = await db.query(
      'SELECT role FROM users WHERE user_id = ?',
      [id]
    );

    if (!user) {
      logger.warn(`Toggle failed - User not found: ID ${id}`);
      return res.status(404).json({ msg: 'User not found' });
    }

    // Update user status
    await db.query(
      'UPDATE users SET is_enabled = ? WHERE user_id = ?',
      [is_enabled, id]
    );

    // ✅ If user is an agent, cascade to platforms
    if (user.role === 'agent') {
      const platformStatus = is_enabled === 1 ? 'active' : 'inactive';

      await db.query(
        'UPDATE platforms SET status = ? WHERE agent_id = ?',
        [platformStatus, id]
      );

      logger.info(
        `Agent ${id} ${is_enabled ? 'enabled' : 'disabled'} → Platforms set to ${platformStatus}`
      );
    }

    logger.info(`User ${id} has been ${is_enabled ? 'enabled' : 'disabled'}`);

    res.json({
      msg: `User has been ${is_enabled ? 'enabled' : 'disabled'} successfully.`,
    });
  } catch (err) {
    logger.error(`Error toggling user status - ID: ${id}, Error: ${err.message}`);
    res.status(500).json({ msg: err.message });
  }
};


// GET all writers for an agent
exports.getWritersByAgent = async (req, res) => {
  const { agentId } = req.params;
  try {
    const [writers] = await db.query("SELECT * FROM users WHERE role = ? AND agent_id = ?", ['writer', agentId]);
    logger.info(`Fetched writers for agent - Agent ID: ${agentId}, Count: ${writers.length}`);
    res.json(writers);
  } catch (err) {
    logger.error(`Error fetching writers by agent - Agent ID: ${agentId}, Error: ${err.message}`);
    res.status(500).json({ msg: 'Internal server error' });
  }
};

// CHANGE PASSWORD (OPTION 1 - NO JWT)
exports.changePassword = async (req, res) => {
  const { user_id, current_password, new_password } = req.body;

  if (!user_id || !current_password || !new_password) {
    return res.status(400).json({
      msg: 'user_id, current_password and new_password are required'
    });
  }

  if (current_password === new_password) {
    return res.status(400).json({
      msg: 'New password must be different from current password'
    });
  }

  try {
    // Fetch user's current password
    const [[user]] = await db.query(
      'SELECT password FROM users WHERE user_id = ?',
      [user_id]
    );

    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(current_password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // Update password
    await db.query(
      'UPDATE users SET password = ? WHERE user_id = ?',
      [hashedPassword, user_id]
    );

    res.json({ msg: 'Password changed successfully' });

  } catch (err) {
    console.error('Change password error:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
};


// RESET PASSWORD (ADMIN CANNOT RESET OTHER ADMINS)
exports.resetPassword = async (req, res) => {
  const { admin_user_id, target_user_id, new_password } = req.body;

  if (!admin_user_id || !target_user_id || !new_password) {
    return res.status(400).json({
      msg: 'admin_user_id, target_user_id, and new_password are required'
    });
  }

  try {
    // Fetch the admin's role
    const [[admin]] = await db.query(
      'SELECT role FROM users WHERE user_id = ?',
      [admin_user_id]
    );

    if (!admin) {
      return res.status(404).json({ msg: 'Admin user not found' });
    }

    // Only admins can reset passwords for others
    if (admin.role !== 'admin') {
      return res.status(403).json({ msg: 'Only admin users can reset passwords for other users' });
    }

    // Fetch target user
    const [[targetUser]] = await db.query(
      'SELECT user_id, role FROM users WHERE user_id = ?',
      [target_user_id]
    );

    if (!targetUser) {
      return res.status(404).json({ msg: 'Target user not found' });
    }

    // Admins cannot reset other admins
    if (targetUser.role === 'admin') {
      return res.status(403).json({ msg: 'Admins cannot reset passwords for other admins' });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // Update target user's password
    await db.query(
      'UPDATE users SET password = ? WHERE user_id = ?',
      [hashedPassword, target_user_id]
    );

    res.json({ msg: `Password reset successfully for user ${target_user_id}` });

  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
};



