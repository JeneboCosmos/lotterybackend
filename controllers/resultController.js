const db = require('../config/db');

// Create a result
exports.createResult = (req, res) => {
  const {  game, date, winning_numbers, imageURL, } = req.body;
  const sql = 'INSERT INTO results ( game, date, winning_numbers, imageURL) VALUES (?, ?, ?, ?)';
  db.query(sql, [game, date, winning_numbers, imageURL], (err, result) => {
    if (err) return res.status(500).json({ message: err.message });
    res.status(201).json({ message: 'Result created successfully', id: result.insertId });
  });
};

// Get all results
exports.getResults = (req, res) => {
  db.query('SELECT * FROM results ORDER BY date DESC', (err, results) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json(results);
  });
};

// Get result by ID
exports.getResultById = (req, res) => {
  const sql = 'SELECT * FROM results WHERE id = ?';
  db.query(sql, [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ message: err.message });
    if (results.length === 0) return res.status(404).json({ message: 'Result not found' });
    res.json(results[0]);
  });
};

// Update result
exports.updateResult = (req, res) => {
  const { game, date, winning_numbers, imageURL } = req.body;
  const sql = 'UPDATE results SET L  game = ?, date = ?, winning_numbers = ? WHERE id = ?, imageURL = ?';
  db.query(sql, [ game, date, winning_numbers, imageURL, req.params.id], (err) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json({ message: 'Result updated successfully' });
  });
};

// Delete result
exports.deleteResult = (req, res) => {
  const sql = 'DELETE FROM results WHERE id = ?';
  db.query(sql, [req.params.id], (err) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json({ message: 'Result deleted successfully' });
  });
};
