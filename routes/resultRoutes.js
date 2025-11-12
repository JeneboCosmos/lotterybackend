const express = require('express');
const router = express.Router();
const pool = require('../config/db');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        pr.play_id,
        pr.user_id,
        u.username AS user_name,
        pr.game_id,
        g.game_name AS game_name,
        pr.combination_id,
        c.combination_name AS combination_name,
        pr.lines,
        pr.selected_numbers,
        pr.stake,
        pr.price,
        pr.play_date,
        pr.created_at
      FROM play pr
      JOIN users u ON pr.user_id = u.user_id
      JOIN games g ON pr.game_id = g.game_id
      JOIN combination_types c ON pr.combination_id = c.combination_id
      ORDER BY pr.created_at DESC
    `);

    const formattedRows = rows.map(row => ({
      ...row,
      play_date: row.play_date
        ? new Date(row.play_date).toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short'
          })
        : null,
      created_at: row.created_at
        ? new Date(row.created_at).toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short'
          })
        : null
    }));

    res.json(formattedRows);
  } catch (err) {
    console.error('Error fetching plays:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
