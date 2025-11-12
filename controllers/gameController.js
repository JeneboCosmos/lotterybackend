const db = require('../config/db');

module.exports = {
  // ✅ Create a new game and return gameId
  createGame: async (req, res) => {
    try {
      const {
        user_id,
        game_name,
        draw_date,
        number_range,
        opening_date,
        closing_date,
        min_stake,
        max_stake,
        is_recurring,
        recurrence_days
      } = req.body;

      const query = `
        INSERT INTO games (
          user_id,
          game_name,
          draw_date,
          number_range,
          opening_date,
          closing_date,
          min_stake,
          max_stake,
          is_recurring,
          recurrence_days
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const [result] = await db.execute(query, [
        user_id,
        game_name,
        draw_date,
        number_range,
        opening_date,
        closing_date,
        min_stake,
        max_stake,
        is_recurring,
        recurrence_days
      ]);

      // ✅ Return the generated game_id
      res.status(201).json({
        message: 'Game created successfully',
        gameId: result.insertId
      });
    } catch (err) {
      res.status(500).json({ message: 'Error creating game', error: err.message });
    }
  },

  // ✅ Fetch all games
  getAllGames: async (req, res) => {
    try {
      const [results] = await db.execute('SELECT * FROM games');
      res.json(results);
    } catch (err) {
      res.status(500).json({ message: 'Error fetching games', error: err.message });
    }
  },

  // ✅ Fetch game by ID
  getGameById: async (req, res) => {
    try {
      const { game_id } = req.params;
      const [result] = await db.execute('SELECT * FROM games WHERE game_id = ?', [game_id]);

      if (result.length === 0) {
        return res.status(404).json({ message: 'Game not found' });
      }

      res.json(result[0]);
    } catch (err) {
      res.status(500).json({ message: 'Error fetching game', error: err.message });
    }
  },

  // ✅ Update game
  updateGame: async (req, res) => {
    try {
      const { game_id } = req.params;
      const {
        game_name,
        draw_date,
        opening_date,
        closing_date,
        number_range,
        min_stake,
        max_stake,
        is_recurring,
        recurrence_days
      } = req.body;

      const query = `
        UPDATE games SET
          game_name = ?,
          draw_date = ?,
          opening_date = ?,
          closing_date = ?,
          number_range = ?,
          min_stake = ?,
          max_stake = ?,
          is_recurring= ?,
          recurrence_days= ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE game_id = ?
      `;

      const [result] = await db.execute(query, [
        game_name,
        draw_date,
        opening_date,
        closing_date,
        number_range,
        min_stake,
        max_stake,
        is_recurring,
        recurrence_days,
        game_id
      ]);

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Game not found' });
      }

      res.json({ message: 'Game updated successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Error updating game', error: err.message });
    }
  },

  // ✅ Get today's recurring games
  getTodayGames: async (req, res) => {
    try {
      const today = new Date();
      const dayName = today.toLocaleString('en-US', { weekday: 'long' }); // "Monday", etc.
      const todayDate = today.toISOString().split('T')[0]; // "YYYY-MM-DD"

      const query = `
        SELECT * FROM games
        WHERE is_recurring = TRUE
          AND FIND_IN_SET(?, recurrence_days)
          AND DATE(opening_date) = ?
      `;

      const [results] = await db.execute(query, [dayName, todayDate]);

      if (results.length === 0) {
        return res.status(200).json({ message: "No games scheduled today", games: [] });
      }

      res.status(200).json({ games: results });
    } catch (err) {
      res.status(500).json({ message: 'Error fetching today’s games', error: err.message });
    }
  },

  // ✅ Delete game
  deleteGame: async (req, res) => {
    try {
      const { game_id } = req.params;
      const [result] = await db.execute('DELETE FROM games WHERE game_id = ?', [game_id]);

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Game not found' });
      }

      res.json({ message: 'Game deleted successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Error deleting game', error: err.message });
    }
  },

  // ✅ Approve game (by a different admin)
  approveGame: async (req, res) => {
    try {
      const { game_id } = req.params;
      const { admin_id } = req.body;

      // Get who submitted the game
      const [[game]] = await db.execute(
        'SELECT user_id, is_approved FROM games WHERE game_id = ?',
        [game_id]
      );

      if (!game) {
        return res.status(404).json({ message: 'Game not found' });
      }

      if (game.is_approved) {
        return res.status(400).json({ message: 'Game already approved' });
      }

      if (game.user_id === admin_id) {
        return res.status(403).json({ message: 'Submitting admin cannot approve the game' });
      }

      // Approve the game
      await db.execute(
        'UPDATE games SET is_approved = TRUE, approved_by = ?, updated_at = CURRENT_TIMESTAMP WHERE game_id = ?',
        [admin_id, game_id]
      );

      res.status(200).json({ message: 'Game approved successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Error approving game', error: err.message });
    }
  },

};
