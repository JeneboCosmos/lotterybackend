// routes/results.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { processDraw } = require('../controllers/winController');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        pr.is_win,
        pr.win_amount,
        pr.draw_date,

        -- Play fields
        p.lines,
        p.stake,
        p.barcode,
        p.pos_id,

        -- User
        u.user_id,
        u.role_id,
        u.username AS user_name,

        -- Game
        g.game_id,
        g.game_name,

        -- Combination
        c.combination_id,
        c.combination_name

      FROM play_result pr

      INNER JOIN play p
        ON pr.play_id = p.play_id

      INNER JOIN users u
        ON pr.user_id = u.user_id

      INNER JOIN games g
        ON pr.game_id = g.game_id

      INNER JOIN combination_types c
        ON pr.combination_id = c.combination_id

      WHERE pr.is_win = 1
      ORDER BY pr.draw_date DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error('Error fetching winning results:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/process', processDraw); // POST /api/draw/process

module.exports = router;
