const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { v4: uuidv4 } = require('uuid'); // UUID generator

// === Agent requests money from Admin ===
router.post('/request-money', async (req, res) => {
  const { agentId, amount } = req.body;  // no adminId here on request creation

  try {
    if (amount <= 0) throw new Error('Invalid amount');
    await db.query(
      'INSERT INTO money_requests (requester_id, amount, status) VALUES (?, ?, ?)',
      [agentId, amount, 'pending']
    );
    res.json({ success: true, message: 'Money request submitted' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// === Writer requests money from Agent ===
router.post('/writer-request', async (req, res) => {
  const { writerId, agentId, amount } = req.body;

  try {
    if (amount <= 0) throw new Error('Invalid amount');
    await db.query(
      'INSERT INTO money_requests (requester_id, amount, status) VALUES (?, ?, ?)',
      [writerId, amount, 'pending']
    );
    res.json({ success: true, message: 'Money request sent to Agent' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// === View all pending requests for an approver (Admin or Agent) ===
router.get('/pending-requests/:approverId', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const [requests] = await conn.query(
      'SELECT mr.*, u.username AS requester_name FROM money_requests mr JOIN users u ON mr.requester_id = u.user_id WHERE mr.status = "pending"'
    );

    res.json(requests); // Always returns an array (even if empty or single)
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error fetching requests' });
  } finally {
    conn.release();
  }
});

// === Approve request and transfer money (Admin or Agent) ===
router.post('/approve-request/:requestId', async (req, res) => {
  const { requestId } = req.params;
  const { approverId } = req.body;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Log for debugging
    console.log(`Approving request ID: ${requestId} by user ID: ${approverId}`);

    const [[request]] = await conn.query(
      'SELECT * FROM money_requests WHERE id = ? AND status = "pending"',
      [requestId]
    );
    if (!request) throw new Error('Request not found or already processed');

    const { amount, requester_id } = request;

    // Fetch approver balance
    const [[approverBalance]] = await conn.query(
      'SELECT balance FROM users WHERE user_id = ?',
      [approverId]
    );
    if (!approverBalance) throw new Error('Approver not found');
    if (approverBalance.balance < amount) throw new Error('Insufficient balance');

    // Update balances
    await conn.query('UPDATE users SET balance = balance - ? WHERE user_id = ?', [amount, approverId]);
    await conn.query('UPDATE users SET balance = balance + ? WHERE user_id = ?', [amount, requester_id]);

    // Generate UUID for transaction ID
    const transactionId = uuidv4();

    // Insert into transactions table
    await conn.query(
      'INSERT INTO transactions (transaction_id, from_user_id, to_user_id, amount, type, status) VALUES (?, ?, ?, ?, ?, ?)',
      [transactionId, approverId, requester_id, amount, 'user_to_user', 'completed']
    );

    // Update request status
    await conn.query(
      'UPDATE money_requests SET status = "approved", approved_by = ?, processed_at = NOW() WHERE id = ?',
      [approverId, requestId]
    );

    await conn.commit();
    res.json({ success: true, message: 'Request approved and money transferred' });

  } catch (err) {
    await conn.rollback();
    console.error('Approval Error:', err.message);
    res.status(400).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
});


router.post('/reject-request/:requestId', async (req, res) => {
  const { requestId } = req.params;
  const { approverId } = req.body;

  try {
    // Optional: validate approver exists
    const [[approver]] = await db.query('SELECT * FROM users WHERE user_id = ?', [approverId]);
    if (!approver) throw new Error('Approver not found');

    const [result] = await db.query(
      'UPDATE money_requests SET status = "rejected", approved_by = ?, processed_at = NOW() WHERE id = ? AND status = "pending"',
      [approverId, requestId]
    );

    if (result.affectedRows === 0) {
      throw new Error('Request not found or already processed');
    }

    res.json({ success: true, message: 'Request rejected successfully' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});



module.exports = router;


