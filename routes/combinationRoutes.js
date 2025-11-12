const express = require('express');
const router = express.Router();
const db = require('../config/db'); // This must be a mysql2 promise pool

// CREATE
router.post('/', async (req, res) => {
  try {
    const { combination_name, description } = req.body;
    const [result] = await db.query(
      'INSERT INTO combination_types (combination_name, description) VALUES (?, ?)',
      [combination_name, description]
    );
    res.status(201).json({ id: result.insertId, combination_name, description });
  } catch (err) {
    console.error('Error inserting combination:', err);
    res.status(500).json({ error: 'Failed to insert combination' });
  }
});

// READ ALL
router.get('/', async (req, res) => {
  try {
    const [results] = await db.query('SELECT * FROM combination_types');
    res.json(results);
  } catch (err) {
    console.error('Error fetching combinations:', err);
    res.status(500).json({ error: 'Failed to fetch combinations' });
  }
});

// READ ONE
router.get('/:id', async (req, res) => {
  try {
    const [result] = await db.query('SELECT * FROM combination_types WHERE combination_id = ?', [req.params.id]);
    if (result.length === 0) {
      return res.status(404).json({ message: 'Combination not found' });
    }
    res.json(result[0]);
  } catch (err) {
    console.error('Error fetching combination:', err);
    res.status(500).json({ error: 'Failed to fetch combination' });
  }
});

// UPDATE
router.put('/:id', async (req, res) => {
  try {
    const { combination_name, description } = req.body;
    await db.query(
      'UPDATE combination_types SET combination_name = ?, description = ? WHERE combination_id = ?',
      [combination_name, description, req.params.id]
    );
    res.json({ message: 'Updated successfully' });
  } catch (err) {
    console.error('Error updating combination:', err);
    res.status(500).json({ error: 'Failed to update combination' });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM combination_types WHERE combination_id = ?', [req.params.id]);
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('Error deleting combination:', err);
    res.status(500).json({ error: 'Failed to delete combination' });
  }
});

module.exports = router;
