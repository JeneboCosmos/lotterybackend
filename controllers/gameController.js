const db = require('../config/db');
const logger = require('../logs/logger');

module.exports = {
  // ✅ Create a new game and return gameId
  createGame: async (req, res) => {
    try {
      const {
        user_id,
        game_name,
        draw_date,
        opening_date,
        closing_date,
        is_recurring,
        recurrence_days,
      } = req.body;

      logger.info("Create game attempt", { user_id, game_name });

      const query = `
        INSERT INTO games (
          user_id,
          game_name,
          draw_date,
          opening_date,
          closing_date,
          is_recurring,
          recurrence_days
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      const [result] = await db.execute(query, [
        user_id,
        game_name,
        draw_date,
        opening_date,
        closing_date,
        is_recurring,
        recurrence_days,
      ]);

      logger.info("Game created successfully", {
        game_id: result.insertId,
        game_name
      });

      res.status(201).json({
        message: 'Game created successfully',
        gameId: result.insertId
      });
    } catch (err) {
      logger.error("Error creating game", { error: err.message });
      res.status(500).json({ message: 'Error creating game', error: err.message });
    }
  },

  // ✅ Fetch all games
  getAllGames: async (req, res) => {
    try {
      logger.info("Fetch all games");
      const [results] = await db.execute('SELECT * FROM games');
      res.json(results);
    } catch (err) {
      logger.error("Error fetching all games", { error: err.message });
      res.status(500).json({ message: 'Error fetching games', error: err.message });
    }
  },

  // ✅ Fetch game by ID
  getGameById: async (req, res) => {
    try {
      const { game_id } = req.params;
      logger.info("Fetch game by ID", { game_id });

      const [result] = await db.execute('SELECT * FROM games WHERE game_id = ?', [game_id]);

      if (result.length === 0) {
        logger.warn("Game not found", { game_id });
        return res.status(404).json({ message: 'Game not found' });
      }

      res.json(result[0]);
    } catch (err) {
      logger.error("Error fetching game by ID", { error: err.message });
      res.status(500).json({ message: 'Error fetching game', error: err.message });
    }
  },

  // ✅ Update game
  updateGame: async (req, res) => {
    try {
      const { game_id } = req.params;

      logger.info("Update game attempt", { game_id });

      const {
        game_name,
        draw_date,
        opening_date,
        closing_date,
        is_recurring,
        recurrence_days
      } = req.body;

      const query = `
        UPDATE games SET
          game_name = ?,
          draw_date = ?,
          opening_date = ?,
          closing_date = ?,
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
        is_recurring,
        recurrence_days,
        game_id,
      ]);

      if (result.affectedRows === 0) {
        logger.warn("Game update failed — not found", { game_id });
        return res.status(404).json({ message: 'Game not found' });
      }

      logger.info("Game updated successfully", { game_id });
      res.json({ message: 'Game updated successfully' });
    } catch (err) {
      logger.error("Error updating game", { error: err.message });
      res.status(500).json({ message: 'Error updating game', error: err.message });
    }
  },

  // ✅ Get today's recurring games
  getTodayGames: async (req, res) => {
    try {
      logger.info("Fetch today's recurring games");

      const today = new Date();
      const dayName = today.toLocaleString('en-US', { weekday: 'long' });
      const todayDate = today.toISOString().split('T')[0];

      const query = `
        SELECT * FROM games
        WHERE is_recurring = TRUE
          AND FIND_IN_SET(?, recurrence_days)
          AND DATE(opening_date) = ?
      `;

      const [results] = await db.execute(query, [dayName, todayDate]);

      if (results.length === 0) {
        logger.info("No recurring games today");
        return res.status(200).json({ message: "No games scheduled today", games: [] });
      }

      res.status(200).json({ games: results });
    } catch (err) {
      logger.error("Error fetching today's games", { error: err.message });
      res.status(500).json({ message: 'Error fetching today’s games', error: err.message });
    }
  },

  // ✅ Delete game
  deleteGame: async (req, res) => {
    try {
      const { game_id } = req.params;
      logger.warn("Delete game attempt", { game_id });

      const [result] = await db.execute('DELETE FROM games WHERE game_id = ?', [game_id]);

      if (result.affectedRows === 0) {
        logger.warn("Game delete failed — not found", { game_id });
        return res.status(404).json({ message: 'Game not found' });
      }

      logger.warn("Game deleted successfully", { game_id });
      res.json({ message: 'Game deleted successfully' });
    } catch (err) {
      logger.error("Error deleting game", { error: err.message });
      res.status(500).json({ message: 'Error deleting game', error: err.message });
    }
  },

  // ✅ Approve game
  approveGame: async (req, res) => {
    try {
      const { game_id } = req.params;
      const { admin_id } = req.body;

      logger.info("Approve game attempt", { game_id, admin_id });

      const [[game]] = await db.execute(
        'SELECT user_id, is_approved FROM games WHERE game_id = ?',
        [game_id]
      );

      if (!game) {
        logger.warn("Approve failed — game not found", { game_id });
        return res.status(404).json({ message: 'Game not found' });
      }

      if (game.is_approved) {
        logger.warn("Approve failed — already approved", { game_id });
        return res.status(400).json({ message: 'Game already approved' });
      }

      if (game.user_id === admin_id) {
        logger.warn("Approve blocked — same admin", { game_id, admin_id });
        return res.status(403).json({ message: 'Submitting admin cannot approve the game' });
      }

      await db.execute(
        'UPDATE games SET is_approved = TRUE, approved_by = ?, updated_at = CURRENT_TIMESTAMP WHERE game_id = ?',
        [admin_id, game_id]
      );

      logger.info("Game approved successfully", { game_id, admin_id });
      res.status(200).json({ message: 'Game approved successfully' });
    } catch (err) {
      logger.error("Error approving game", { error: err.message });
      res.status(500).json({ message: 'Error approving game', error: err.message });
    }
  },
};
