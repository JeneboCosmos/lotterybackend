// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Verify JWT Token
exports.verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ msg: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { user_id, username, role }
    next();
  } catch (err) {
    return res.status(403).json({ msg: 'Invalid token.' });
  }
};

// Check Role Middleware
exports.checkRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ msg: 'Access denied. Insufficient permissions.' });
    }
    next();
  };
};
