// routes/results.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { processDraw } = require('../controllers/winController');

router.get('/', async (req, res) => { 
  try {
    const [rows] = await pool.query(`
      SELECT 
        pr.*,

        -- ✅ Convert payout_paid to readable status
        CASE 
          WHEN pr.payout_paid = 0 THEN 'Unpaid'
          WHEN pr.payout_paid = 1 THEN 'Paid'
          ELSE 'Unknown'
        END AS payout_status,

        u.user_id AS user_id,
        u.role_id AS role_id,
        u.username AS user_name,
        g.game_id AS game_id,
        g.game_name AS game_name,
        c.combination_id AS combination_id,
        c.combination_name AS combination_name
      FROM play_result pr
      JOIN users u ON pr.user_id = u.user_id
      JOIN games g ON pr.game_id = g.game_id
      JOIN combination_types c ON pr.combination_id = c.combination_id
      WHERE pr.is_win = 1
    `);

    res.json(rows);
  } catch (err) {
    console.error('Error fetching winning results:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/process', processDraw);  // POST /api/draw/process

module.exports = router;
