const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const combinations = require('../utils/combinations');

/* ===== CREATE DRAW & DETERMINE WINNERS ===== */
router.post('/', async (req, res) => {
  const { game_id, draw_numbers, draw_date } = req.body;

  if (!game_id || !draw_numbers || draw_numbers.length !== 5 || !draw_date) {
    return res.status(400).json({ error: 'Invalid input data' });
  }

  const connection = await pool.getConnection();

  try {
    // Start transaction for draw + winner processing
    await connection.beginTransaction();

    // Insert draw record
    const [drawResult] = await connection.execute(
      'INSERT INTO draw (game_id, draw_numbers, draw_date) VALUES (?, ?, ?)',
      [game_id, JSON.stringify(draw_numbers), draw_date]
    );

    const draw_id = drawResult.insertId;

    // ✅ Insert notification OUTSIDE the transaction so it always saves
    

    // Get plays for that game and date
    const [plays] = await connection.execute(
      'SELECT * FROM play WHERE play_date = ? AND game_id = ?',
      [draw_date, game_id]
    );

    const winners = [];

    for (const play of plays) {
      const selected = JSON.parse(play.selected_numbers);
      const comboId = play.combination_id;
      let isWinner = false;
      let matchedNumbers = [];

      switch (comboId) {
        case 1:
          isWinner = selected[0] === draw_numbers[0];
          matchedNumbers = isWinner ? [selected[0]] : [];
          break;
        case 2:
        case 3:
        case 4:
        case 5:
          isWinner = selected.every(num => draw_numbers.includes(num));
          matchedNumbers = isWinner ? selected : [];
          break;
        case 6:
          const perm2 = combinations(selected, 2);
          isWinner = perm2.some(pair => pair.every(n => draw_numbers.includes(n)));
          matchedNumbers = isWinner
            ? perm2.find(pair => pair.every(n => draw_numbers.includes(n)))
            : [];
          break;
        case 7:
          const perm3 = combinations(selected, 3);
          isWinner = perm3.some(triple => triple.every(n => draw_numbers.includes(n)));
          matchedNumbers = isWinner
            ? perm3.find(triple => triple.every(n => draw_numbers.includes(n)))
            : [];
          break;
        case 8:
          isWinner = draw_numbers.includes(selected[0]);
          matchedNumbers = isWinner ? [selected[0]] : [];
          break;
        default:
          break;
      }

      if (isWinner) {
        const amountWon = play.stake * 10;
        await connection.execute(
          'INSERT INTO play_results (play_id, user_id, game_id, draw_id, combination_id, matched_numbers, amount_won) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            play.id,
            play.user_id,
            play.game_id,
            draw_id,
            play.combination_id,
            JSON.stringify(matchedNumbers),
            amountWon,
          ]
        );
        winners.push(play.id);
      }
    }

    // Commit transaction
    await connection.commit();

    res.status(200).json({
      message: 'Draw completed and winners determined',
      draw_id,
      winners,
    });
  } catch (err) {
    await connection.rollback();
    console.error('❌ Error during draw process:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    connection.release();
  }
});

/* ===== GET ALL DRAWS ===== */
router.get('/', async (req, res) => {
  try {
    const [results] = await pool.query('SELECT * FROM draw ORDER BY id DESC');
    res.json(results);
  } catch (err) {
    console.error('Error fetching draws:', err);
    res.status(500).json({ error: 'Database query error' });
  }
});

/* ===== GET DRAW BY ID ===== */
router.get('/:id', async (req, res) => {
  const drawId = req.params.id;
  try {
    const [results] = await pool.query('SELECT * FROM draw WHERE id = ?', [drawId]);
    if (results.length === 0)
      return res.status(404).json({ message: 'Draw not found' });
    res.json(results[0]);
  } catch (err) {
    console.error('Error fetching draw by ID:', err);
    res.status(500).json({ error: 'Database query error' });
  }
});

/* ===== GET UNREAD NOTIFICATIONS ===== */


/* ===== MARK NOTIFICATIONS AS READ ===== */


module.exports = router;
