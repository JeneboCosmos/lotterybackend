// middleware/auth.js
const jwt = require('jsonwebtoken');
require('dotenv').config(); // ✅ THIS WAS MISSING

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ msg: 'Access denied. No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { user_id, role, username }
    next();
  } catch (err) {
    console.error('JWT ERROR:', err.message); // temporary debug
    return res.status(401).json({ msg: 'Invalid token' });
  }
};
