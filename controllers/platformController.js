const express = require('express');
const router = express.Router();
const db = require('../config/db'); // your mysql2/promise connection

// Create a new platform
router.post('/', async (req, res) => {
  const { platform_reference, agent_id, status = 'active' } = req.body;

  if (!platform_reference || !agent_id) {
    return res.status(400).json({ msg: 'platform_reference and agent_id are required' });
  }

  try {
    const sql = `
      INSERT INTO platforms (platform_reference, agent_id, status)
      VALUES (?, ?, ?)
    `;
    const [result] = await db.query(sql, [platform_reference, agent_id, status]);

    res.status(201).json({
      msg: 'Platform created successfully',
      platform_id: result.insertId,
      platform_reference,
      agent_id,
      status
    });
  } catch (err) {
    console.error('Error creating platform:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ msg: 'Platform reference already exists' });
    }
    res.status(500).json({ msg: 'Internal server error' });
  }
});

// Get all platforms
router.get('/', async (req, res) => {
  try {
    const [platforms] = await db.query('SELECT * FROM platforms');
    res.json(platforms);
  } catch (err) {
    console.error('Error fetching platforms:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
});

// Get platform by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query('SELECT * FROM platforms WHERE platform_id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ msg: 'Platform not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching platform:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
});

// Update platform by ID
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { platform_reference, agent_id, status } = req.body;

  try {
    // Check if platform exists
    const [rows] = await db.query('SELECT * FROM platforms WHERE platform_id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ msg: 'Platform not found' });

    // Update
    const sql = `
      UPDATE platforms SET
        platform_reference = COALESCE(?, platform_reference),
        agent_id = COALESCE(?, agent_id),
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE platform_id = ?
    `;
    await db.query(sql, [platform_reference, agent_id, status, id]);

    res.json({ msg: 'Platform updated successfully' });
  } catch (err) {
    console.error('Error updating platform:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ msg: 'Platform reference already exists' });
    }
    res.status(500).json({ msg: 'Internal server error' });
  }
});

// Delete platform by ID
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await db.query('DELETE FROM platforms WHERE platform_id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ msg: 'Platform not found' });

    res.json({ msg: 'Platform deleted successfully' });
  } catch (err) {
    console.error('Error deleting platform:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
});

module.exports = router;
