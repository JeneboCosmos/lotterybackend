const db = require('../config/db');

// ============================
// Admin sets commission rule
// ============================
const setCommission = async (req, res) => {
  const { commissionType, amount, bonus_amount, threshold } = req.body;

  if (!commissionType) {
    return res.status(400).json({ message: "commissionType is required" });
  }

  if ((commissionType === "flat" || commissionType === "percentage") && (amount === undefined || amount === null)) {
    return res.status(400).json({ message: "Amount is required for flat or percentage commission" });
  }

  if (commissionType === "bonus" && (bonus_amount === undefined || threshold === undefined)) {
    return res.status(400).json({ message: "bonus_amount and threshold are required for bonus commission" });
  }

  try {
    const connection = await db.getConnection();

    // Only delete existing rule of the same type
    await connection.execute(`DELETE FROM commissions WHERE commissionType = ?`, [commissionType]);

    // Insert commission/bonus rule
    await connection.execute(
      `INSERT INTO commissions (commissionType, amount, bonus_amount, threshold, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [commissionType, amount || 0, bonus_amount || 0, threshold || 0]
    );

    connection.release();
    res.json({
      message: "Commission/Bonus rule set successfully",
      commissionType,
      amount: amount || 0,
      bonus_amount: bonus_amount || 0,
      threshold: threshold || 0
    });
  } catch (error) {
    console.error("Error setting commission:", error);
    res.status(500).json({ message: "Error setting commission", error: error.message });
  }
};

// ============================
// Apply all pending commissions (commissions only)
// ============================
const applyAllPendingCommissions = async (req, res) => {
  const adminId = req.body.admin_id || null;
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Only commission rules (flat or percentage)
    const [rules] = await connection.execute(
      `SELECT * FROM commissions WHERE commissionType IN ('flat','percentage') AND is_active = 1`
    );

    if (!rules.length) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: "No active commission rule found" });
    }

    // Get all pending plays
    const [sales] = await connection.execute(
      `SELECT p.play_id, p.price, p.user_id, u.username
       FROM play p
       JOIN users u ON p.user_id = u.user_id
       WHERE p.commission_applied = 0`
    );

    if (!sales.length) {
      await connection.rollback();
      connection.release();
      return res.json({ message: "No pending commissions found" });
    }

    let totalCommission = 0;
    const results = [];

    for (const sale of sales) {
      let commissionAmount = 0;

      for (const rule of rules) {
        if (rule.commissionType === "flat") commissionAmount += rule.amount;
        else if (rule.commissionType === "percentage") commissionAmount += (sale.price * rule.amount) / 100;
      }

      totalCommission += commissionAmount;

      await connection.execute(
        `INSERT INTO writer_commissions
         (user_id, play_id, commission_type, commission_amount, status, created_at)
         VALUES (?, ?, 'commission', ?, 'pending', ?)`,
        [sale.user_id, sale.play_id, commissionAmount, new Date()]
      );

      await connection.execute(
        `UPDATE play SET commission_applied = 1, commission_amount = ? WHERE play_id = ?`,
        [commissionAmount, sale.play_id]
      );

      results.push({
        writer: sale.username,
        gross: sale.price,
        commission: commissionAmount,
      });
    }

    // Log commission only
    await connection.execute(
      `INSERT INTO commission_logs (log_type, total_commission, total_writers, applied_by)
       VALUES ('commission', ?, ?, ?)`,
      [totalCommission, results.length, adminId]
    );

    await connection.commit();
    connection.release();

    res.json({
      message: "All pending commissions stored successfully.",
      applied: results.length,
      totalCommission,
      details: results,
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error("Error storing pending commissions:", error);
    res.status(500).json({ message: "Error storing pending commissions", error: error.message });
  }
};

// ============================
// Apply commission on transaction
// ============================
const applyCommissionOnTransaction = async (transactionId) => {
  const connection = await db.getConnection();
  try {
    const [[tx]] = await connection.execute(
      `SELECT t.id, t.sender_id, t.receiver_id, t.amount,
              s.role AS sender_role, r.role AS receiver_role
       FROM transactions t
       JOIN users s ON t.sender_id = s.user_id
       JOIN users r ON t.receiver_id = r.user_id
       WHERE t.id = ?`,
      [transactionId]
    );

    if (!tx || tx.sender_role !== 'agent' || tx.receiver_role !== 'writer') {
      console.log(`No commission applied — transaction ${transactionId} not agent→writer`);
      connection.release();
      return;
    }

    console.log(`Agent sent credit to writer. Writer’s balance already includes commission.`);
  } catch (error) {
    console.error("Error applying commission on transaction:", error);
  } finally {
    connection.release();
  }
};

// ============================
// View commission logs
// ============================
const getCommissionLogs = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const [logs] = await connection.execute(`
      SELECT cl.*, u.username AS applied_by_name
      FROM commission_logs cl
      LEFT JOIN users u ON cl.applied_by = u.user_id
      ORDER BY cl.applied_at DESC
    `);

    res.json({ success: true, message: "Commission logs fetched successfully", logs });
  } catch (error) {
    console.error("Error fetching commission logs:", error);
    res.status(500).json({ success: false, message: "Error fetching commission logs", error: error.message });
  } finally {
    connection.release();
  }
};

// ============================
// Apply year-end bonus (bonus only)
// ============================
const calculateYearEndBonus = async (req, res) => {
  const year = new Date().getFullYear();
  const adminId = req.body?.admin_id || null; // ensure admin_id exists
  const connection = await db.getConnection();

  try {
    const [[rule]] = await connection.execute(
      `SELECT * FROM commissions WHERE commissionType = 'bonus' AND is_active = 1 LIMIT 1`
    );

    if (!rule) {
      connection.release();
      return res.status(400).json({ message: "No active bonus rule set" });
    }

    const [sales] = await connection.execute(
      `SELECT w.user_id, w.username, COALESCE(SUM(p.price), 0) AS total_sales
       FROM users w
       JOIN play p ON w.user_id = p.user_id
       WHERE w.role = 'writer' AND YEAR(p.created_at) = ?
       GROUP BY w.user_id, w.username`,
      [year]
    );

    const bonuses = [];
    let totalBonus = 0;

    for (const sale of sales) {
      if (sale.total_sales >= rule.threshold) {
        await connection.execute(
          `UPDATE users SET balance = balance + ? WHERE user_id = ?`,
          [rule.bonus_amount, sale.user_id]
        );

        bonuses.push({
          writer: sale.username,
          total_sales: sale.total_sales,
          bonus: rule.bonus_amount
        });

        totalBonus += rule.bonus_amount;
      }
    }

    // Log year-end bonus separately
    if (totalBonus > 0) {
      await connection.execute(
        `INSERT INTO commission_logs (log_type, total_commission, total_writers, applied_by)
         VALUES ('bonus', ?, ?, ?)`,
        [totalBonus, bonuses.length, adminId]
      );
    }

    connection.release();
    res.json({ message: `Year-end bonuses applied for ${year}`, totalBonus, bonuses });

  } catch (error) {
    connection.release();
    console.error("Error applying year-end bonus:", error);
    res.status(500).json({ message: "Error applying year-end bonus", error: error.message });
  }
};

// ============================
// Export functions
// ============================
module.exports = {
  setCommission,
  applyAllPendingCommissions,
  applyCommissionOnTransaction,
  calculateYearEndBonus,
  getCommissionLogs,
};
