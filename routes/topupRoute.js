const express = require("express");
const router = express.Router();
const db = require("../config/db");
const { v4: uuidv4 } = require("uuid"); // ✅ import UUID generator

// ✅ POST /api/admin/add-funds
router.post("/add-funds", async (req, res) => {
  const { user_id, amount } = req.body;

  // ✅ Validation
  if (!user_id || !amount || amount <= 0) {
    return res.status(400).json({ message: "user_id and valid amount are required" });
  }

  let connection;
  try {
    connection = await db.getConnection();

    // ✅ Find admin
    const [admin] = await connection.query(
      "SELECT * FROM users WHERE user_id = ? AND role = 'admin'",
      [user_id]
    );

    if (!admin.length) {
      return res.status(404).json({ message: "Admin not found" });
    }

    const newBalance = (admin[0].balance || 0) + parseFloat(amount);

    // ✅ Update admin balance
    await connection.query(
      "UPDATE users SET balance = ? WHERE user_id = ?",
      [newBalance, user_id]
    );

    // ✅ Generate unique transaction reference
    const transactionRef = uuidv4(); // e.g., "b43a2f6b-25da-497e-9b34-b2f3aab4f200"

    // ✅ Log transaction (include transaction_ref)
    await connection.query(
      "INSERT INTO transactions (from_user_id, to_user_id, amount, transaction_ref) VALUES (?, ?, ?, ?)",
      [user_id, user_id, amount, transactionRef]
    );

    res.json({
      message: "Funds added successfully",
      newBalance,
      transactionRef,
    });
  } catch (err) {
    console.error("Error adding funds:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release(); // ✅ ensure connection is released
  }
});

// routes/agentWriters.js

// GET /api/agent-writers-details?agent_id=xxx&platform_id=yyy
router.get("/agent-writers", async (req, res) => {
  const { agent_id, platform_id } = req.query;

  if (!agent_id || !platform_id) {
    return res.status(400).json({ message: "agent_id and platform_id are required" });
  }

  try {
    // Fetch writers with full details
    const [writers] = await db.query(
      `SELECT 
         user_id,
         username AS name,
         email,
         phone,
         physical_address,
         digital_address,
         postal_address,
         guarantor_name,
         guarantor_phone,
         next_of_kin_name,
         next_of_kin_phone,
         balance,
         is_verified,
         created_at,
         updated_at
       FROM users
       WHERE agent_id = ?
         AND platform_id = ?
         AND role = 'writer'
       ORDER BY username ASC`,
      [agent_id, platform_id]
    );

    if (!writers.length) {
      return res.status(404).json({ message: "No writers found for this agent on this platform" });
    }

    res.json({
      agent_id,
      platform_id,
      total_writers: writers.length,
      writers,
    });
  } catch (error) {
    console.error("❌ Error fetching writers details:", error.message);
    res.status(500).json({ message: "Server error fetching writers details" });
  }
});



module.exports = router;
