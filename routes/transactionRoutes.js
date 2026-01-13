const express = require("express");
const router = express.Router();
const db = require("../config/db");
const { v4: uuidv4 } = require("uuid");

//
//  Admin → Agent transfer (shared dashboard balance)
//
const transferAdminToPlatform = async (req, res) => {
  const { platform_reference, amount, admin_user_id } = req.body;

  if (!platform_reference || !amount || !admin_user_id) {
    return res.status(400).json({
      message: "platform_reference, amount, and admin_user_id are required",
    });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    //  Find the target platform and its agent
    const [[platform]] = await conn.query(
      `
      SELECT 
        p.platform_id, 
        p.platform_reference, 
        p.balance, 
        u.user_id AS agent_id, 
        u.username AS agent_name
      FROM platforms p
      JOIN users u ON p.agent_id = u.user_id
      WHERE p.platform_reference = ? 
      LIMIT 1
      `,
      [platform_reference]
    );

    if (!platform)
      throw new Error("Platform not found for the given reference");

    //  Get the shared dashboard balance
    const [[dashboard]] = await conn.query(`SELECT * FROM dashboard_balance LIMIT 1`);
    if (!dashboard) throw new Error("Dashboard balance record not found");

    if (Number(dashboard.balance) < Number(amount))
      throw new Error("Insufficient dashboard balance");

    //  Deduct from dashboard balance
    await conn.query(`UPDATE dashboard_balance SET balance = balance - ?`, [amount]);

    //  Credit the selected platform’s balance
    await conn.query(
      `UPDATE platforms SET balance = balance + ? WHERE platform_id = ?`,
      [amount, platform.platform_id]
    );

    //  Record the transaction properly
    // NOTE: we now store to_platform_id instead of to_user_id
    const transaction_ref = `tx-${uuidv4().slice(0, 8)}`;

    await conn.query(
      `
      INSERT INTO transactions 
        (transaction_ref, from_user_id, to_platform_id, type, amount, status, timestamp)
      VALUES 
        (?, ?, ?, 'Credit', ?, 'completed', NOW())
      `,
      [transaction_ref, admin_user_id, platform.platform_id, amount]
    );

    //  Fetch updated dashboard balance
    const [[updatedDashboard]] = await conn.query(
      `SELECT balance FROM dashboard_balance LIMIT 1`
    );

    await conn.commit();

    res.json({
      message: " Credit successfully sent ",
      data: {
        transaction_ref,
        admin_id: admin_user_id,
        admin_action: "Dashboard → Platform Credit",
        platform_reference: platform.platform_reference,
        platform_id: platform.platform_id,
        agent_name: platform.agent_name,
        amount,
        new_dashboard_balance: updatedDashboard.balance,
      },
    });
  } catch (error) {
    await conn.rollback();
    console.error("Dashboard → Platform Transfer Error:", error.message);
    res.status(500).json({ message: error.message });
  } finally {
    conn.release();
  }
};

//
//  Dashboard balance fetch
//
router.get("/dashboard-balance", async (req, res) => {
  try {
    const [[dashboard]] = await db.query(`SELECT balance FROM dashboard_balance LIMIT 1`);
    if (!dashboard) return res.status(404).json({ message: "Dashboard balance not found" });
    res.json({ balance: dashboard.balance });
  } catch (err) {
    console.error("Error fetching dashboard balance:", err);
    res.status(500).json({ message: "Failed to fetch dashboard balance" });
  }
});

//
//  Agent → Writer transfer (unchanged)
//




// ✅ Transfer from Agent → Writer and credit pending commissions
const transferAgentToWriter = async (req, res) => {
  const { role_id, platform_id, amount } = req.body;

  // Basic validation
  if (!role_id || !platform_id || !amount) {
    return res.status(400).json({
      message: "Writer role_id, platform_id, and amount are required",
    });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1️⃣ Fetch platform info
    const [[platform]] = await conn.query(
      `SELECT platform_id, agent_id, balance 
       FROM platforms 
       WHERE platform_id = ? 
       LIMIT 1`,
      [platform_id]
    );
    if (!platform) throw new Error("Invalid platform ID");
    if (platform.balance < amount) throw new Error("Insufficient platform balance");

    const agentId = platform.agent_id;

    // 2️⃣ Get agent info
    const [[agent]] = await conn.query(
      `SELECT user_id, username 
       FROM users 
       WHERE user_id = ? AND role = 'agent' 
       LIMIT 1`,
      [agentId]
    );
    if (!agent) throw new Error("Agent not found");

    // 3️⃣ Get writer info
    const [[writer]] = await conn.query(
      `SELECT user_id, username, balance 
       FROM users 
       WHERE role_id = ? AND role = 'writer' AND platform_id = ? 
       LIMIT 1`,
      [role_id, platform_id]
    );
    if (!writer) throw new Error("Writer not found on this platform");

    // 4️⃣ Deduct base amount from platform balance
    await conn.query(
      `UPDATE platforms SET balance = balance - ? WHERE platform_id = ?`,
      [amount, platform_id]
    );

    // 5️⃣ Fetch pending commissions for this writer
    const [pendingCommissions] = await conn.query(
      `SELECT COALESCE(SUM(commission_amount), 0) AS total_pending 
       FROM writer_commissions 
       WHERE user_id = ? AND status = 'pending'`,
      [writer.user_id]
    );
    const pendingTotal = parseFloat(pendingCommissions[0]?.total_pending || 0);

    // 6️⃣ Total amount to credit = base amount + pending commissions
    const totalCredit = parseFloat(amount) + pendingTotal;

    // 7️⃣ Credit writer's balance
    await conn.query(
      `UPDATE users SET balance = balance + ? WHERE user_id = ?`,
      [totalCredit, writer.user_id]
    );

    // 8️⃣ Update all pending commissions → credited
    if (pendingTotal > 0) {
      await conn.query(
        `UPDATE writer_commissions 
         SET status = 'credited', credited_at = NOW() 
         WHERE user_id = ? AND status = 'pending'`,
        [writer.user_id]
      );
    }

    // 9️⃣ Log transaction
    const transaction_ref = `tx-${uuidv4().slice(0, 8)}`;
    await conn.query(
      `INSERT INTO transactions 
        (transaction_ref, from_user_id, to_user_id, type, amount, status, timestamp, platform_id)
       VALUES (?, ?, ?, 'Credit', ?, 'completed', NOW(), ?)`,
      [transaction_ref, agent.user_id, writer.user_id, amount, platform_id]
    );

    await conn.commit();

    res.json({
      message: "Credit sent from Agent to Writer successfully.",
      data: {
        transaction_ref,
        agent: agent.username,
        writer: writer.username,
        platform_id,
        baseAmount: parseFloat(amount),
        pendingCommission: pendingTotal,
        totalCredited: totalCredit,
      },
    });
  } catch (error) {
    await conn.rollback();
    console.error("❌ Agent→Writer transfer error:", error.message);
    res.status(500).json({ message: error.message });
  } finally {
    conn.release();
  }
};




const payWriterFromDashboard = async (req, res) => {
  const { writer_role_id, amount, admin_user_id } = req.body;

  if (!writer_role_id || !amount || !admin_user_id) {
    return res.status(400).json({
      message: "writer_role_id, amount, and admin_user_id are required",
    });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    //  Find writer by role_id
    const [[writer]] = await conn.query(
      `SELECT user_id, username, role, role_id, balance 
       FROM users 
       WHERE role_id = ? AND role = 'writer' 
       LIMIT 1`,
      [writer_role_id]
    );

    if (!writer) throw new Error("Writer not found for the given role_id");

    //  Check dashboard balance
    const [[dashboard]] = await conn.query(`SELECT * FROM dashboard_balance LIMIT 1`);
    if (!dashboard) throw new Error("Dashboard balance record not found");

    if (Number(dashboard.balance) < Number(amount))
      throw new Error("Insufficient dashboard balance");

    //  Deduct from dashboard
    await conn.query(`UPDATE dashboard_balance SET balance = balance - ?`, [amount]);

    //  Credit writer
    await conn.query(`UPDATE users SET balance = balance + ? WHERE user_id = ?`, [
      amount,
      writer.user_id,
    ]);

    //  Record transaction
    const transaction_ref = `tx-writer-${uuidv4().slice(0, 8)}`;
    await conn.query(
      `INSERT INTO transactions (transaction_ref, from_user_id, to_user_id, type, amount, status, timestamp)
       VALUES (?, ?, ?, 'Writer Payment', ?, 'completed', NOW())`,
      [transaction_ref, admin_user_id, writer.user_id, amount]
    );

    //  Fetch updated dashboard balance
    const [[updatedDashboard]] = await conn.query(`SELECT balance FROM dashboard_balance LIMIT 1`);

    await conn.commit();

    res.json({
      message: " Writer successfully paid from Dashboard balance",
      data: {
        transaction_ref,
        admin_id: admin_user_id,
        writer_name: writer.username,
        writer_role_id: writer.role_id,
        amount,
        new_dashboard_balance: updatedDashboard.balance,
      },
    });
  } catch (error) {
    await conn.rollback();
    console.error("Dashboard→Writer error:", error.message);
    res.status(500).json({ message: error.message });
  } finally {
    conn.release();
  }
};


const getWriterPaymentHistory = async (req, res) => {
  try {
    const [history] = await db.query(`
      SELECT 
        t.transaction_ref,
        t.amount,
        t.timestamp,
        t.status,
        admin.username AS admin_name,
        writer.username AS writer_name,
        writer.role_id AS writer_role_id
      FROM transactions t
      JOIN users admin ON t.from_user_id = admin.user_id
      JOIN users writer ON t.to_user_id = writer.user_id
      WHERE t.type = 'Writer Payment'
      ORDER BY t.timestamp DESC
    `);

    res.json(history);
  } catch (err) {
    console.error("Error fetching writer payment history:", err.message);
    res.status(500).json({ message: "Server error fetching writer payment history" });
  }
};

// controllers/paymentController.js
const getTotalWriterPayout = async (req, res) => {
  try {
    const [result] = await db.query(`
      SELECT SUM(t.amount) AS total_payout
      FROM transactions t
      WHERE t.type = 'Writer Payment' AND t.status = 'completed'
    `);

    // result[0].total_payout will be the sum
    res.json({ total_payout: result[0].total_payout || 0 });
  } catch (err) {
    console.error("❌ Error fetching total writer payout:", err.message);
    res.status(500).json({ message: "Server error fetching total writer payout" });
  }
};

module.exports = { getTotalWriterPayout };


module.exports = { getWriterPaymentHistory };


//
// ✅ Route registration
//
router.post("/admin-to-agent", transferAdminToPlatform);
router.post("/agent-to-writer", transferAgentToWriter);
router.post("/agent-to-writer", transferAgentToWriter);
router.get("/total-writers-payout", getTotalWriterPayout);

router.post("/pay-writer", payWriterFromDashboard);
router.get("/writer-payments", getWriterPaymentHistory);

router.get("/dashboard-balance", async (req, res) => {
  try {
    const [[dashboard]] = await db.query(`SELECT balance FROM dashboard_balance LIMIT 1`);
    res.json({ balance: dashboard?.balance || 0 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch dashboard balance" });
  }
});

// GET /api/admin-transactions
router.get("/transactions", async (req, res) => {
  try {
    const [transactions] = await db.query(`
      SELECT 
        t.id AS transaction_id,
        t.transaction_ref,
        t.type,
        t.amount,
        t.status,
        t.timestamp,

        -- Admin who sent the credit
        u_from.username AS from_name,

        -- Platform that received it
        p.platform_reference AS to_platform_reference,

        -- Agent responsible for that platform
        u_agent.username AS agent_name

      FROM transactions t
      JOIN users u_from 
        ON t.from_user_id = u_from.user_id        -- Admin
      JOIN platforms p 
        ON t.to_platform_id = p.platform_id       -- Platform
      JOIN users u_agent 
        ON p.agent_id = u_agent.user_id           -- Platform’s agent

      WHERE u_from.role = 'admin'
      ORDER BY t.timestamp DESC
    `);

    res.json(transactions);
  } catch (err) {
    console.error("❌ Error fetching admin transactions:", err);
    res.status(500).json({ message: "Server error" });
  }
});


//
// ✅ Get transaction history by user ID
//
router.get("/history/:user_id", async (req, res) => {
  const { user_id } = req.params;
  const { platform_id } = req.query;

  try {
    // Validate input
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    if (!platform_id) {
      return res.status(400).json({ message: "Platform ID is required" });
    }

    // Fetch all transactions for this user under this platform
    const [transactions] = await db.query(
      `
      SELECT 
        t.transaction_ref,
        t.type,
        t.amount,
        t.status,
        t.timestamp,
        COALESCE(u_from.username, 'Dashboard') AS from_name,
        COALESCE(u_to.username, 'Platform') AS to_name
      FROM transactions t
      LEFT JOIN users u_from ON t.from_user_id = u_from.user_id
      LEFT JOIN users u_to ON t.to_user_id = u_to.user_id
      WHERE (t.from_user_id = ? OR t.to_user_id = ?)
        AND (u_from.platform_id = ? OR u_to.platform_id = ?)
      ORDER BY t.timestamp DESC
      `,
      [user_id, user_id, platform_id, platform_id]
    );

    if (!transactions.length) {
      return res.status(404).json({
        message: "No transaction history found for this user on this platform",
      });
    }

    res.json({
      message: "✅ Transaction history fetched successfully",
      transactions,
    });
  } catch (error) {
    console.error("❌ Error fetching transaction history:", error.message);
    res.status(500).json({ message: "Server error fetching transaction history" });
  }
});


router.post("/pay-writers-batch", async (req, res) => {
  const { payments, admin_user_id } = req.body;

  if (!payments || !Array.isArray(payments) || payments.length === 0 || !admin_user_id) {
    return res.status(400).json({ message: "payments array and admin_user_id are required" });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Fetch dashboard balance
    const [[dashboard]] = await conn.query(`SELECT balance FROM dashboard_balance LIMIT 1`);
    if (!dashboard) throw new Error("Dashboard balance record not found");

    const results = [];
    let totalAmount = 0;

    for (const p of payments) {
      const { writer_role_id } = p;
      if (!writer_role_id) continue;

      // Find writer
      const [[writer]] = await conn.query(
        `SELECT user_id, username, balance FROM users WHERE role_id = ? AND role='writer' LIMIT 1`,
        [writer_role_id]
      );
      if (!writer) continue;

      // Fetch all unpaid winning play_results for this writer
      const [unpaidWins] = await conn.query(
        `SELECT result_id, play_id, ticket_number, prize_amount
         FROM play_result
         WHERE user_id = ? AND is_win = 1 AND payout_paid = 0`,
        [writer.user_id]
      );

      if (!unpaidWins.length) continue; // No wins to pay

      // Calculate total for this writer
      const writerTotal = unpaidWins.reduce((sum, r) => sum + Number(r.prize_amount), 0);
      totalAmount += writerTotal;

      // Check if dashboard has enough balance
      if (dashboard.balance < totalAmount) throw new Error("Insufficient dashboard balance");

      // Credit writer
      await conn.query(`UPDATE users SET balance = balance + ? WHERE user_id = ?`, [
        writerTotal,
        writer.user_id,
      ]);

      // Log transaction
      const transaction_ref = `tx-writer-${uuidv4().slice(0, 8)}`;
      const referenceNote = JSON.stringify({
        payment_type: "ticket_winnings",
        results: unpaidWins.map(r => ({
          result_id: r.result_id,
          play_id: r.play_id,
          ticket_number: r.ticket_number,
          prize_amount: r.prize_amount,
        })),
      });

      await conn.query(
        `INSERT INTO transactions
         (transaction_ref, from_user_id, to_user_id, type, amount, status, timestamp, reference_note)
         VALUES (?, ?, ?, 'Writer payment', ?, 'completed', NOW(), ?)`,
        [transaction_ref, admin_user_id, writer.user_id, writerTotal, referenceNote]
      );

      // Mark all these play_results as paid
      const resultIds = unpaidWins.map(r => r.result_id);
      await conn.query(
        `UPDATE play_result
         SET payout_paid = 1, payout_paid_at = NOW(), payout_transaction_ref = ?
         WHERE result_id IN (?)`,
        [transaction_ref, resultIds]
      );

      results.push({
        writer_role_id,
        writer_name: writer.username,
        total_paid: writerTotal,
        transaction_ref,
        tickets_paid: unpaidWins.map(r => r.ticket_number),
      });
    }

    // Deduct total from dashboard
    if (totalAmount > 0) {
      await conn.query(`UPDATE dashboard_balance SET balance = balance - ?`, [totalAmount]);
    }

    // Fetch updated dashboard balance
    const [[updatedDashboard]] = await conn.query(`SELECT balance FROM dashboard_balance LIMIT 1`);

    await conn.commit();

    res.json({
      message: "Batch payments completed successfully",
      total_paid: totalAmount,
      new_dashboard_balance: updatedDashboard.balance,
      payments: results,
    });
  } catch (error) {
    await conn.rollback();
    console.error("❌ Batch dashboard→writer error:", error.message);
    res.status(500).json({ message: error.message });
  } finally {
    conn.release();
  }
});
router.get("/unpaid-wins/:writer_role_id", async (req, res) => {
  const { writer_role_id } = req.params;

  if (!writer_role_id) {
    return res.status(400).json({ message: "Writer role_id is required" });
  }

  try {
    const [tickets] = await db.query(
      `SELECT result_id, ticket_number, prize_amount
       FROM play_result
       WHERE writer_role_id = ? AND payout_paid = 0`,
      [writer_role_id]
    );

    // Calculate total unpaid amount
    const total_amount = tickets.reduce((sum, t) => sum + parseFloat(t.prize_amount), 0);

    res.json({
      tickets,
      total_amount,
    });
  } catch (err) {
    console.error("Error fetching unpaid tickets:", err.message);
    res.status(500).json({ message: "Server error fetching unpaid tickets" });
  }
});




module.exports = router;
