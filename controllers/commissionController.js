const db = require('../config/db');

// ============================
// Admin sets commission rule
// ============================
const setCommission = async (req, res) => {
  const { commissionType, amount, bonus_amount, threshold } = req.body;

  if (!commissionType) {
    return res.status(400).json({ message: "commissionType is required" });
  }

  // For flat or percentage (optional for legacy)
  if ((commissionType === "flat" || commissionType === "percentage") && (amount === undefined || amount === null)) {
    return res.status(400).json({ message: "Amount is required for flat or percentage commission" });
  }

  // For bonus
  if (commissionType === "bonus" && (bonus_amount === undefined || threshold === undefined)) {
    return res.status(400).json({ message: "bonus_amount and threshold are required for bonus commission" });
  }

  try {
    const connection = await db.getConnection();

    // Only delete existing rule of the same type
    await connection.execute(`DELETE FROM commissions WHERE commissionType = ?`, [commissionType]);

    // Insert commission rule
    await connection.execute(
      `INSERT INTO commissions (commissionType, amount, bonus_amount, threshold, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [
        commissionType,
        amount || 0,
        bonus_amount || 0,
        threshold || 0
      ]
    );

    connection.release();
    res.json({
      message: "Commission rule set successfully",
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
// Apply all pending commissions
// ============================
const applyAllPendingCommissions = async (req, res) => {
  const adminId = req.body.admin_id || null;
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Get active rules
    const [rules] = await connection.execute(`SELECT * FROM commissions WHERE is_active = 1`);
    if (!rules.length) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: "No active commission/bonus rules found" });
    }

    // Get pending sales
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

    const results = [];
    let totalCommission = 0;
    let totalBonus = 0;

    for (const sale of sales) {
      for (const rule of rules) {
        if (rule.commissionType === "flat" || rule.commissionType === "percentage") {
          let commissionAmount = rule.commissionType === "flat" ? rule.amount : (sale.price * rule.amount) / 100;

          await connection.execute(
            `INSERT INTO writer_commissions 
             (user_id, play_id, commission_type, commission_amount, status, created_at)
             VALUES (?, ?, 'commission', ?, 'pending', NOW())`,
            [sale.user_id, sale.play_id, commissionAmount]
          );

          totalCommission += commissionAmount;
        }

        if (rule.commissionType === "bonus" && rule.bonus_amount > 0) {
          await connection.execute(
            `INSERT INTO writer_commissions 
             (user_id, play_id, commission_type, commission_amount, status, created_at)
             VALUES (?, NULL, 'bonus', ?, 'pending', NOW())`,
            [sale.user_id, rule.bonus_amount]
          );

          totalBonus += rule.bonus_amount;
        }
      }

      await connection.execute(
        `UPDATE play SET commission_applied = 1 WHERE play_id = ?`,
        [sale.play_id]
      );

      results.push({
        writer: sale.username,
        gross: sale.price
      });
    }

    // Log commission & bonus
    await connection.execute(
      `INSERT INTO commission_logs (log_type, total_commission, total_writers, applied_by)
       VALUES (?, ?, ?, ?)`,
      ['commission', totalCommission, results.length, adminId]
    );

    await connection.execute(
      `INSERT INTO commission_logs (log_type, total_commission, total_writers, applied_by)
       VALUES (?, ?, ?, ?)`,
      ['bonus', totalBonus, results.length, adminId]
    );

    await connection.commit();
    connection.release();

    res.json({
      message: "All pending commissions and bonuses applied successfully",
      applied: results.length,
      totalCommission,
      totalBonus,
      details: results
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error("Error applying commissions:", error);
    res.status(500).json({ message: "Error applying commissions", error: error.message });
  }
};

// ============================
// Apply commission on single transaction
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
      connection.release();
      return;
    }

    console.log(`Commission already included in writer's balance for transaction ${transactionId}`);

  } catch (error) {
    console.error("Error applying commission on transaction:", error);
  } finally {
    connection.release();
  }
};

// ============================
// Calculate year-end bonus
// ============================
const calculateYearEndBonus = async (req, res) => {
  const year = new Date().getFullYear();
  const connection = await db.getConnection();

  try {
    const [[rule]] = await connection.execute(
      `SELECT * FROM commissions WHERE commissionType = 'bonus' AND is_active = 1 LIMIT 1`
    );

    if (!rule) {
      connection.release();
      return res.status(400).json({ message: "No active bonus rule set" });
    }

    const [writers] = await connection.execute(
      `SELECT w.user_id, w.username, COALESCE(SUM(p.price),0) AS total_sales
       FROM users w
       JOIN play p ON w.user_id = p.user_id
       WHERE w.role = 'writer' AND YEAR(p.created_at) = ?
       GROUP BY w.user_id, w.username`,
      [year]
    );

    const bonuses = [];
    let totalBonus = 0;

    for (const writer of writers) {
      if (writer.total_sales >= rule.threshold) {
        await connection.execute(
          `UPDATE users SET balance = balance + ? WHERE user_id = ?`,
          [rule.bonus_amount, writer.user_id]
        );

        bonuses.push({
          writer: writer.username,
          total_sales: writer.total_sales,
          bonus: rule.bonus_amount
        });

        totalBonus += rule.bonus_amount;
      }
    }

    // Log bonus
    if (totalBonus > 0) {
      await connection.execute(
        `INSERT INTO commission_logs (log_type, total_commission, total_writers, applied_by)
         VALUES ('bonus', ?, ?, ?)`,
        [totalBonus, bonuses.length, req.body.admin_id || null]
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
// Commission logs
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

    res.json({ success: true, message: "Commission logs fetched", logs });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Error fetching logs", error: error.message });
  } finally {
    connection.release();
  }
};

// ============================
// Financial summary
// ============================
const getFinancialSummary = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { startDate, endDate } = req.query;
    let dateCondition = "";
    let dateParams = [];

    if (startDate && endDate) {
      dateCondition = " AND created_at BETWEEN ? AND ?";
      dateParams = [startDate, endDate];
    }

    const [[grossResult]] = await connection.execute(
      `SELECT COALESCE(SUM(price),0) AS gross FROM play WHERE 1=1 ${dateCondition}`, dateParams
    );

    const [[commissionResult]] = await connection.execute(
      `SELECT COALESCE(SUM(commission_amount),0) AS total_commission 
       FROM writer_commissions WHERE commission_type='commission' ${dateCondition}`, dateParams
    );

    const [[bonusResult]] = await connection.execute(
      `SELECT COALESCE(SUM(commission_amount),0) AS total_bonus 
       FROM writer_commissions WHERE commission_type='bonus' ${dateCondition}`, dateParams
    );

    const gross = parseFloat(grossResult.gross || 0);
    const totalCommission = parseFloat(commissionResult.total_commission || 0);
    const totalBonus = parseFloat(bonusResult.total_bonus || 0);
    const net = gross - totalCommission;

    res.json({
      success: true,
      message: "Financial summary fetched",
      summary: { gross, totalCommission, totalBonus, net }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Error fetching summary", error: error.message });
  } finally {
    connection.release();
  }
};

// ============================
// Agent platform summary
// ============================
const getAgentPlatformSummary = async (req, res) => {
  const agent_id = req.query.agent_id?.trim();
  const platform_id = req.query.platform_id?.trim();

  if (!agent_id || !platform_id) {
    return res.status(400).json({ message: "agent_id and platform_id are required" });
  }

  const connection = await db.getConnection();

  try {
    const [writers] = await connection.execute(
      `SELECT user_id FROM users WHERE agent_id=? AND platform_id=? AND role='writer'`,
      [agent_id, platform_id]
    );

    if (!writers.length) {
      connection.release();
      return res.json({
        message: "No writers found",
        summary: { gross: 0, totalCommission: 0, net: 0, is_commission: false }
      });
    }

    const writerIds = writers.map(w => w.user_id);
    const placeholders = writerIds.map(() => '?').join(',');

    const [[grossResult]] = await connection.execute(
      `SELECT COALESCE(SUM(price),0) AS gross FROM play WHERE user_id IN (${placeholders})`,
      writerIds
    );

    const [[commissionResult]] = await connection.execute(
      `SELECT COALESCE(SUM(commission_amount),0) AS totalCommission 
       FROM writer_commissions 
       WHERE user_id IN (${placeholders}) AND commission_type='commission'`,
      writerIds
    );

    const gross = parseFloat(grossResult.gross || 0);
    const totalCommission = parseFloat(commissionResult.totalCommission || 0);
    const net = gross - totalCommission;
    const is_commission = totalCommission > 0;

    res.json({
      success: true,
      message: "Agent platform summary fetched",
      summary: { platform_id, total_writers: writers.length, gross, totalCommission, net, is_commission }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Error fetching agent platform summary", error: error.message });
  } finally {
    connection.release();
  }
};

// ============================
// Get current commission rule
// ============================
const getCurrentCommission = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const [[rule]] = await connection.execute(
      `SELECT * FROM commissions WHERE is_active=1 LIMIT 1`
    );

    if (!rule) {
      connection.release();
      return res.status(404).json({ message: "No active commission rule found" });
    }

    res.json({ success: true, message: "Current commission rule fetched", commission: rule });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Error fetching commission", error: error.message });
  } finally {
    connection.release();
  }
};

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
