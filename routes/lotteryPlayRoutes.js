// routes/lotteryPlaysRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');

// CREATE
router.post('/', (req, res) => {
  const {
    user_id,
    game_id,
    draw_id,
    combination_id,
    selected_numbers,
    stake,
    price,
    lines,
    play_date,
  } = req.body;

  const sql = `
    INSERT INTO lottery_plays 
    columns (user_id, game_id, draw_id, combination_id, selected_numbers, stake, price, lines, play_date) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [user_id, game_id, draw_id, combination_id, selected_numbers, stake, price, lines, play_date],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ message: 'Play created', play_id: result.insertId });
    }
  );
});

// READ ALL
router.get('/', (req, res) => {
  db.query('SELECT * FROM lottery_plays', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// READ ONE
router.get('/:id', (req, res) => {
  db.query('SELECT * FROM lottery_plays WHERE play_id = ?', [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    if (rows.length === 0) return res.status(404).json({ message: 'Play not found' });
    res.json(rows[0]);
  });
});

// UPDATE
router.put('/:id', (req, res) => {
  const {
    user_id,
    game_id,
    draw_id,
    combination_id,
    selected_numbers,
    stake,
    price,
    lines,
    play_date,
  } = req.body;

  const sql = `
    UPDATE lottery_plays SET 
      user_id = ?, game_id = ?, draw_id = ?, combination_id = ?, 
      selected_numbers = ?, stake = ?, price = ?, lines = ?, play_date = ? 
    WHERE play_id = ?
  `;

  db.query(
    sql,
    [user_id, game_id, draw_id, combination_id, selected_numbers, stake, price, lines, play_date, req.params.id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.affectedRows === 0) return res.status(404).json({ message: 'Play not found' });
      res.json({ message: 'Play updated' });
    }
  );
});

// DELETE
router.delete('/:id', (req, res) => {
  db.query('DELETE FROM lottery_plays WHERE play_id = ?', [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Play not found' });
    res.json({ message: 'Play deleted' });
  });
});

module.exports = router;


