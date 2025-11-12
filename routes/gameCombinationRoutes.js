const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.post('/', async (req, res) => {
  const { game_id, combination_ids } = req.body;

  if (!game_id || !Array.isArray(combination_ids) || combination_ids.length === 0) {
    return res.status(400).json({ error: 'game_id and a non-empty combination_ids array are required' });
  }

  try {
    const values = combination_ids.map((id) => [game_id, id]);

    await db.query(
      'INSERT INTO game_combination (game_id, combination_id) VALUES ?',
      [values]
    );

    res.send('Game linked to combinations successfully.');
  } catch (error) {
    console.error('Error linking combinations to game:', error);
    res.status(500).json({ error: 'Failed to link combinations to game.' });
  }
});

// Unlink a combination from a game
router.delete('/', async (req, res) => {
  const { game_id, combination_id } = req.body;
  await db.execute(
    'DELETE FROM game_combination WHERE game_id = ? AND combination_id = ?',
    [game_id, combination_id]
  );
  res.send('Link removed');
});

// Get combinations for a specific game
// Get combinations for a specific game
router.get('/by-game/:id', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT ct.* FROM combination_types ct
      JOIN game_combination gc ON ct.combination_id = gc.combination_id
      WHERE gc.game_id = ?
    `, [req.params.id]);

    res.json(rows); // rows is the iterable array of combinations
  } catch (error) {
    console.error('Error fetching combinations by game:', error.message);
    res.status(500).json({ message: 'Server error fetching combinations' });
  }
});


module.exports = router;
