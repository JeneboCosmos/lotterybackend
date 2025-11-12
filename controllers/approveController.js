const db = require('../config/db');
const jwt = require('jsonwebtoken');

exports.approveGame = async (req, res) => {
  try {
    // 🔐 Extract token and verify it
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'Authorization token required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    const admin_id = decoded.user_id; // 👈 use decoded token payload

    const { game_id } = req.params;

    // 🔎 Get the game info
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
      return res.status(403).json({ message: 'Submitting admin cannot approve their own game' });
    }

    // ✅ Approve the game
    await db.execute(
      'UPDATE games SET is_approved = TRUE, approved_by = ?, updated_at = CURRENT_TIMESTAMP WHERE game_id = ?',
      [admin_id, game_id]
    );

    res.status(200).json({ message: 'Game approved successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Error approving game', error: err.message });
  }
};
