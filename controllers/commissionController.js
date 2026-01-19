const db = require('../config/db');

/* =========================================================
   ADMIN SETS COMMISSION OR BONUS RULE (INDEPENDENT)
========================================================= */
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
    // 🔒 Delete ONLY same commission type
    await connection.execute(
      `DELETE FROM commissions WHERE commissionType = ?`,
      [commissionType]
    );

    await connection.execute(
      `INSERT INTO commissions 
      (commissionType, amount, bonus_amount, threshold, is_active)
      VALUES (?, ?, ?, ?, 1)`,
      [
        commissionType,
        amount || 0,
        bonus_amount || 0,
        threshold || 0
      ]
    );

    res.json({
      success: true,
      message: `${commissionType} rule saved successfully`,
      data: { commissionType, amount, bonus_amount, threshold }
    });

  } catch (error) {
    console.error("Error setting commission:", error);
    res.status(500).json({
      success: false,
      message: "Error setting commission",
      error: error.message
    });
  } finally {
    connection.release();
  }
};


/* =========================================================
   APPLY COMMISSION TO ALL PENDING PLAYS (NO BONUS)
========================================================= */
const applyAllPendingCommissions = async (req, res) => {
  const adminId = req.body.admin_id || null;
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [rules] = await connection.execute(
      `SELECT * FROM commissions
       WHERE commissionType IN ('flat','percentage')
       AND is_active = 1`
    );

    if (!rules.length) {
      throw new Error("No active commission rules found");
    }

    const [sales] = await connection.execute(
      `SELECT p.play_id, p.price, p.user_id, u.username
       FROM play p
       JOIN users u ON u.user_id = p.user_id
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
        if (rule.commissionType === 'flat') {
          commissionAmount += rule.amount;
        } else if (rule.commissionType === 'percentage') {
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
         SET commission_applied = 1,
             commission_amount = ?
         WHERE play_id = ?`,
        [commissionAmount, sale.play_id]
      );

      results.push({
        writer: sale.username,
        play_id: sale.play_id,
        gross: sale.price,
        commission: commissionAmount
      });
    }

    await connection.execute(
      `INSERT INTO commission_logs
      (log_type, total_commission, total_writers, applied_by)
      VALUES ('commission', ?, ?, ?)`,
      [totalCommission, results.length, adminId]
    );

    await connection.commit();

    res.json({
      success: true,
      message: "All commissions applied successfully",
      totalCommission,
      applied: results.length,
      details: results
    });

  } catch (error) {
    await connection.rollback();
    console.error("Error applying commissions:", error);
    res.status(500).json({
      success: false,
      message: "Error applying commissions",
      error: error.message
    });
  } finally {
    connection.release();
  }
};


/* =========================================================
   APPLY COMMISSION ON TRANSACTION (AGENT → WRITER)
========================================================= */
const applyCommissionOnTransaction = async (transactionId) => {
  const connection = await db.getConnection();

  try {
    const [[tx]] = await connection.execute(
      `SELECT t.id, t.sender_id, t.receiver_id,
              s.role AS sender_role,
              r.role AS receiver_role
       FROM transactions t
       JOIN users s ON s.user_id = t.sender_id
       JOIN users r ON r.user_id = t.receiver_id
       WHERE t.id = ?`,
      [transactionId]
    );

    if (!tx || tx.sender_role !== 'agent' || tx.receiver_role !== 'writer') {
      return;
    }

    // Commission already applied via play table
  } catch (error) {
    console.error("Error in applyCommissionOnTransaction:", error);
  } finally {
    connection.release();
  }
};


/* =========================================================
   VIEW COMMISSION LOGS
========================================================= */
const getCommissionLogs = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const [logs] = await connection.execute(
      `SELECT cl.*, u.username AS applied_by_name
       FROM commission_logs cl
       LEFT JOIN users u ON u.user_id = cl.applied_by
       ORDER BY cl.applied_at DESC`
    );

    res.json({
      success: true,
      message: "Commission logs fetched successfully",
      logs
    });
  } catch (error) {
    console.error("Error fetching logs:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching logs",
      error: error.message
    });
  } finally {
    connection.release();
  }
};


/* =========================================================
   APPLY YEAR-END BONUS (INDEPENDENT)
========================================================= */
const calculateYearEndBonus = async (req, res) => {
  const year = new Date().getFullYear();
  const adminId = req.body.admin_id || null;
  const connection = await db.getConnection();

  try {
    const [[rule]] = await connection.execute(
      `SELECT * FROM commissions
       WHERE commissionType = 'bonus'
       AND is_active = 1`
    );

    if (!rule) {
      return res.status(400).json({ message: "No active bonus rule found" });
    }

    const [writers] = await connection.execute(
      `SELECT u.user_id, u.username, SUM(p.price) AS total_sales
       FROM users u
       JOIN play p ON p.user_id = u.user_id
       WHERE u.role = 'writer'
       AND YEAR(p.created_at) = ?
       GROUP BY u.user_id`,
      [year]
    );

    let totalBonus = 0;
    const bonuses = [];

    for (const writer of writers) {
      if (writer.total_sales >= rule.threshold) {
        await connection.execute(
          `INSERT INTO writer_commissions
          (user_id, commission_type, commission_amount, status, created_at)
          VALUES (?, 'bonus', ?, 'completed', NOW())`,
          [writer.user_id, rule.bonus_amount]
        );

        totalBonus += rule.bonus_amount;
        bonuses.push({
          writer: writer.username,
          bonus: rule.bonus_amount
        });
      }
    }

    await connection.execute(
      `INSERT INTO commission_logs
      (log_type, total_commission, total_writers, applied_by)
      VALUES ('bonus', ?, ?, ?)`,
      [totalBonus, bonuses.length, adminId]
    );

    res.json({
      success: true,
      year,
      totalBonus,
      bonuses
    });

  } catch (error) {
    console.error("Error applying bonus:", error);
    res.status(500).json({
      success: false,
      message: "Error applying bonus",
      error: error.message
    });
  } finally {
    connection.release();
  }
};


/* =========================================================
   FINANCIAL SUMMARY
========================================================= */
const getFinancialSummary = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { startDate, endDate } = req.query;
    let condition = "";
    let params = [];

    if (startDate && endDate) {
      condition = "AND created_at BETWEEN ? AND ?";
      params = [startDate, endDate];
    }

    const [[gross]] = await connection.execute(
      `SELECT COALESCE(SUM(price),0) AS gross
       FROM play WHERE 1=1 ${condition}`,
      params
    );

    const [[commission]] = await connection.execute(
      `SELECT COALESCE(SUM(commission_amount),0) AS totalCommission
       FROM writer_commissions
       WHERE commission_type = 'commission' ${condition}`,
      params
    );

    const [[bonus]] = await connection.execute(
      `SELECT COALESCE(SUM(commission_amount),0) AS totalBonus
       FROM writer_commissions
       WHERE commission_type = 'bonus' ${condition}`,
      params
    );

    res.json({
      success: true,
      summary: {
        gross: gross.gross,
        totalCommission: commission.totalCommission,
        totalBonus: bonus.totalBonus,
        net: gross.gross - commission.totalCommission
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
};


/* =========================================================
   AGENT PLATFORM SUMMARY
========================================================= */
const getAgentPlatformSummary = async (req, res) => {
  const { agent_id, platform_id } = req.query;

  if (!agent_id || !platform_id) {
    return res.status(400).json({ message: "agent_id and platform_id required" });
  }

  const connection = await db.getConnection();

  try {
    const [writers] = await connection.execute(
      `SELECT user_id FROM users
       WHERE agent_id = ? AND platform_id = ? AND role = 'writer'`,
      [agent_id, platform_id]
    );

    if (!writers.length) {
      return res.json({ gross: 0, totalCommission: 0, net: 0 });
    }

    const ids = writers.map(w => w.user_id);
    const placeholders = ids.map(() => '?').join(',');

    const [[gross]] = await connection.execute(
      `SELECT COALESCE(SUM(price),0) AS gross
       FROM play WHERE user_id IN (${placeholders})`,
      ids
    );

    const [[commission]] = await connection.execute(
      `SELECT COALESCE(SUM(commission_amount),0) AS totalCommission
       FROM play
       WHERE commission_applied = 1 AND user_id IN (${placeholders})`,
      ids
    );

    res.json({
      gross: gross.gross,
      totalCommission: commission.totalCommission,
      net: gross.gross - commission.totalCommission
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
};


/* =========================================================
   GET CURRENT ACTIVE COMMISSION RULE
========================================================= */
const getCurrentCommission = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const [[rule]] = await connection.execute(
      `SELECT * FROM commissions WHERE is_active = 1 LIMIT 1`
    );

    if (!rule) {
      return res.status(404).json({ message: "No active rule found" });
    }

    res.json({
      success: true,
      commission: rule
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
};


/* =========================================================
   EXPORTS
========================================================= */
module.exports = {
  setCommission,
  applyAllPendingCommissions,
  applyCommissionOnTransaction,
  calculateYearEndBonus,
  getCommissionLogs,
  getFinancialSummary,
  getAgentPlatformSummary,
  getCurrentCommission
};
