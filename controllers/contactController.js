const db = require('../config/db');

// CREATE
exports.createContact = (req, res) => {
  const { name, subject, email, phone, message } = req.body;
  const sql = 'INSERT INTO contacts (name, subject, email, phone, message) VALUES (?, ?, ?, ?, ?)';
  db.query(sql, [name, subject, email, phone, message], (err, result) => {
    if (err) return res.status(500).json({ error: 'Failed to create contact' });
    res.status(201).json({ message: 'Contact created successfully', id: result.insertId });
  });
};

// READ ALL
exports.getAllContacts = (req, res) => {
  const sql = 'SELECT * FROM contacts ORDER BY created_at DESC';
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch contacts' });
    res.json(results);
  });
};

// READ ONE
exports.getContactById = (req, res) => {
  const sql = 'SELECT * FROM contacts WHERE id = ?';
  db.query(sql, [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch contact' });
    if (result.length === 0) return res.status(404).json({ error: 'Contact not found' });
    res.json(result[0]);
  });
};

// UPDATE
exports.updateContact = (req, res) => {
  const { name, subject, email, phone, message } = req.body;
  const sql = 'UPDATE contacts SET name = ?, subject = ?, email = ?, phone = ?, message = ? WHERE id = ?';
  db.query(sql, [name, subject, email, phone, message, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to update contact' });
    res.json({ message: 'Contact updated successfully' });
  });
};

// DELETE
exports.deleteContact = (req, res) => {
  const sql = 'DELETE FROM contacts WHERE id = ?';
  db.query(sql, [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to delete contact' });
    res.json({ message: 'Contact deleted successfully' });
  });
};
