require('dotenv').config();
const mysql = require('mysql2/promise');

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

(async () => {
  try {
    const connection = await db.getConnection();
    console.log(' Connected to MySQL database');
    connection.release();
  } catch (err) {
    console.error('❌ Error connecting to MySQL:', err.message);
  }
})();

module.exports = db;
