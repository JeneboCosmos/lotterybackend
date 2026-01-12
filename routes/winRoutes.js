// routes/results.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { processDraw } = require('../controllers/winController');

// GET all winning results
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        pr.is_win,
        pr.prize_amount,
        

        -- All play table fields
        p.*,

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

    res.status(200).json({
      success: true,
      data: rows
    });

  } catch (error) {
    console.error('Error fetching winning results:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch winning results',
      error: error.sqlMessage || error.message
    });
  }
});

// POST: process draw
router.post('/process', processDraw); // POST /api/results/process

module.exports = router;
