const db = require('../config/db');

/* ============================
   Admin sets commission / bonus rule
============================ */
const setCommission = async (req, res) => {
  const { commissionType, amount, bonus_amount, threshold } = req.body;

  if (!commissionType) {
    return res.status(400).json({ message: "commissionType is required" });
  }

  if (
    (commissionType === "flat" || commissionType === "percentage") &&
    (amount === undefined || amount === null)
  ) {
    return res.status(400).json({
      message: "Amount is required for flat or percentage commission"
    });
  }

  if (
    commissionType === "bonus" &&
    (bonus_amount === undefined || threshold === undefined)
  ) {
    return res.status(400).json({
      message: "bonus_amount and threshold are required for bonus commission"
    });
  }

  const connection = await db.getConnection();
  try {
    // Only delete rule of same type
    await connection.execute(
      `DELETE FROM commissions WHERE commissionType = ?`,
      [commissionType]
    );

    await connection.execute(
      `INSERT INTO commissions (commissionType, amount, bonus_amount, threshold)
       VALUES (?, ?, ?, ?)`,
      [
        commissionType,
        amount || 0,
        bonus_amount || 0,
        threshold || 0
      ]
    );

    res.json({
      message: "Commission / Bonus rule set successfully",
      commissionType,
      amount: amount || 0,
      bonus_amount: bonus_amount || 0,
      threshold: threshold || 0
    });
  } catch (error) {
    console.error("Error setting commission:", error);
    res.status(500).json({ message: "Error setting commission", error: error.message });
  } finally {
    connection.release();
  }
};

/* ============================
   Apply all pending commissions
============================ */
const applyAllPendingCommissions = async (req, res) => {
  const adminId = req.body?.admin_id || null;
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Commission rules only (flat / percentage)
    const [rules] = await connection.execute(
      `SELECT * FROM commissions WHERE commissionType IN ('flat','percentage')`
    );

    if (!rules.length) {
      await connection.rollback();
      return res.status(400).json({ message: "No commission rule found" });
    }

    const [sales] = await connection.execute(
      `SELECT p.play_id, p.price, p.user_id, u.username
       FROM play p
       JOIN users u ON p.user_id = u.user_id
       WHERE p.commission_applied = 0`
    );

    if (!sales.length) {
      await connection.rollback();
      return res.json({ message: "No pending commissions found" });
    }

    let totalCommission = 0;
    const results = [];

    for (const sale of sales) {
      let commissionAmount = 0;

      for (const rule of rules) {
        if (rule.commissionType === "flat") {
          commissionAmount += rule.amount;
        } else if (rule.commissionType === "percentage") {
          commissionAmount += (sale.price * rule.amount) / 100;
        }
      }

      totalCommission += commissionAmount;

      await connection.execute(
        `INSERT INTO writer_commissions
         (user_id, play_id, commission_type, commission_amount, status, created_at)
         VALUES (?, ?, 'commission', ?, 'pending', NOW())`,
        [sale.user_id, sale.play_id, commissionAmount]
      );

      await connection.execute(
        `UPDATE play
         SET commission_applied = 1, commission_amount = ?
         WHERE play_id = ?`,
        [commissionAmount, sale.play_id]
      );

      results.push({
        writer: sale.username,
        gross: sale.price,
        commission: commissionAmount
      });
    }

    // Log COMMISSION
    await connection.execute(
      `INSERT INTO commission_logs
       (log_type, total_commission, total_writers, applied_by)
       VALUES ('commission', ?, ?, ?)`,
      [totalCommission, results.length, adminId]
    );

    await connection.commit();

    res.json({
      message: "All pending commissions applied successfully",
      applied: results.length,
      totalCommission,
      details: results
    });

  } catch (error) {
    await connection.rollback();
    console.error("Error storing pending commissions:", error);
    res.status(500).json({
      message: "Error storing pending commissions",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

/* ============================
   Apply commission on transaction
============================ */
const applyCommissionOnTransaction = async (transactionId) => {
  const connection = await db.getConnection();
  try {
    const [[tx]] = await connection.execute(
      `SELECT t.id, t.sender_id, t.receiver_id,
              s.role AS sender_role, r.role AS receiver_role
       FROM transactions t
       JOIN users s ON t.sender_id = s.user_id
       JOIN users r ON t.receiver_id = r.user_id
       WHERE t.id = ?`,
      [transactionId]
    );

    if (!tx || tx.sender_role !== 'agent' || tx.receiver_role !== 'writer') {
      return;
    }

    console.log("Agent → Writer transaction. Commission handled elsewhere.");
  } catch (error) {
    console.error("Error applying commission on transaction:", error);
  } finally {
    connection.release();
  }
};

/* ============================
   Commission logs
============================ */
const getCommissionLogs = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const [logs] = await connection.execute(
      `SELECT cl.*, u.username AS applied_by_name
       FROM commission_logs cl
       LEFT JOIN users u ON cl.applied_by = u.user_id
       ORDER BY cl.applied_at DESC`
    );

    res.json({ success: true, logs });
  } catch (error) {
    console.error("Error fetching commission logs:", error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
};

/* ============================
   Year-end bonus
============================ */
const calculateYearEndBonus = async (req, res) => {
  const year = new Date().getFullYear();
  const adminId = req.body?.admin_id || null;
  const connection = await db.getConnection();

  try {
    const [[rule]] = await connection.execute(
      `SELECT * FROM commissions WHERE commissionType = 'bonus' LIMIT 1`
    );

    if (!rule) {
      return res.status(400).json({ message: "No bonus rule set" });
    }

    const [sales] = await connection.execute(
      `SELECT w.user_id, w.username, COALESCE(SUM(p.price),0) AS total_sales
       FROM users w
       JOIN play p ON w.user_id = p.user_id
       WHERE w.role = 'writer' AND YEAR(p.created_at) = ?
       GROUP BY w.user_id, w.username`,
      [year]
    );

    let totalBonus = 0;
    const bonuses = [];

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

    if (totalBonus > 0) {
      await connection.execute(
        `INSERT INTO commission_logs
         (log_type, total_commission, total_writers, applied_by)
         VALUES ('bonus', ?, ?, ?)`,
        [totalBonus, bonuses.length, adminId]
      );
    }

    res.json({
      message: `Year-end bonus applied for ${year}`,
      totalBonus,
      bonuses
    });

  } catch (error) {
    console.error("Error applying year-end bonus:", error);
    res.status(500).json({ message: "Error applying year-end bonus", error: error.message });
  } finally {
    connection.release();
  }
};

/* ============================
   Financial summary
============================ */
const getFinancialSummary = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const [[gross]] = await connection.execute(
      `SELECT COALESCE(SUM(price),0) AS gross FROM play`
    );

    const [[commission]] = await connection.execute(
      `SELECT COALESCE(SUM(commission_amount),0) AS total FROM writer_commissions WHERE commission_type='commission'`
    );

    const [[bonus]] = await connection.execute(
      `SELECT COALESCE(SUM(commission_amount),0) AS total FROM writer_commissions WHERE commission_type='bonus'`
    );

    res.json({
      success: true,
      summary: {
        gross: gross.gross,
        totalCommission: commission.total,
        totalBonus: bonus.total,
        net: gross.gross - commission.total
      }
    });
  } catch (error) {
    console.error("Error getting financial summary:", error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
};

/* ============================
   Get active commission
============================ */
const getCurrentCommission = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const [[rule]] = await connection.execute(
      `SELECT * FROM commissions ORDER BY id DESC LIMIT 1`
    );

    if (!rule) {
      return res.status(404).json({ message: "No commission rule found" });
    }

    res.json({ success: true, commission: rule });
  } catch (error) {
    console.error("Error fetching commission:", error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
};

/* ============================
   EXPORTS
============================ */
module.exports = {
  setCommission,
  applyAllPendingCommissions,
  applyCommissionOnTransaction,
  calculateYearEndBonus,
  getCommissionLogs,
  getFinancialSummary,
  getCurrentCommission
};
