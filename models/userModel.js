const db = require('../config/db');

const User = {
  getAll: (callback) => {
    db.query('SELECT * FROM user', callback);
  },
  create: (userData, callback) => {
    const sql = 'INSERT INTO user (role, username, password, balance) VALUES (?, ?, ?, ?)';
    db.query(sql, [userData.role, userData.username, userData.password, userData.balance], callback);
  },
};

module.exports = User;
