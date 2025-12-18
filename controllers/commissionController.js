const db = require('../config/db');

// Admin sets commission rule
const setCommission = async (req, res) => {
  const { commissionType, amount, bonus_amount, threshold } = req.body;

  // Validate commissionType
  if (!commissionType) {
    return res.status(400).json({ message: "commissionType is required" });
  }

  // For flat or percentage, amount is required
  if ((commissionType === "flat" || commissionType === "percentage") && (amount === undefined || amount === null)) {
    return res.status(400).json({ message: "Amount is required for flat or percentage commission" });
  }

  // For bonus, bonus_amount and threshold are required
  if (commissionType === "bonus" && (bonus_amount === undefined || threshold === undefined)) {
    return res.status(400).json({ message: "bonus_amount and threshold are required for bonus commission" });
  }

  try {
    const connection = await db.getConnection();

    // Ensure only one active rule (optional: you might want separate rows per type)
    await connection.execute(`DELETE FROM commissions`);

    // Insert commission rule
    await connection.execute(
      `INSERT INTO commissions (commissionType, amount, bonus_amount, threshold, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [
        commissionType,
        amount || 0,         // default 0 if not provided
        bonus_amount || 0,   // default 0 if not provided
        threshold || 0       // default 0 if not provided
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


// Admin applies commission to all pending sales (stored for later use)
const applyAllPendingCommissions = async (req, res) => {
  const adminId = req.body.admin_id || null;
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction(); // start transaction

    const [[rule]] = await connection.execute(
      `SELECT * FROM commissions WHERE is_active = 1 LIMIT 1`
    );

    if (!rule) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: "No active commission rule found" });
    }

    const [sales] = await connection.execute(
      `SELECT p.play_id, p.price, p.user_id, u.username
       FROM play p
       JOIN users u ON p.user_id = u.user_id
       WHERE p.commission_applied = 0`
    );

    if (sales.length === 0) {
      await connection.rollback();
      connection.release();
      return res.json({ message: "No pending commissions found" });
    }

    const results = [];
    let totalCommission = 0;

    for (const sale of sales) {
      let commissionAmount = 0;

      // Determine commission amount based on rule type
      if (rule.commissionType === "flat") {
        commissionAmount = rule.amount;
      } else if (rule.commissionType === "percentage") {
        commissionAmount = (sale.price * rule.amount) / 100;
      }

      totalCommission += commissionAmount;

      // Prepare rows for batch insert
      const commissionRows = [
        [sale.user_id, sale.play_id, rule.commissionType, commissionAmount, 'pending', new Date()]
      ];

      if (rule.bonus_amount && rule.bonus_amount > 0) {
        commissionRows.push([sale.user_id, null, 'bonus', rule.bonus_amount, 'pending', new Date()]);
        totalCommission += rule.bonus_amount;
      }

      // Insert both commission and bonus in a single query
      await connection.query(
        `INSERT INTO writer_commissions 
         (user_id, play_id, commission_type, commission_amount, status, created_at)
         VALUES ?`,
        [commissionRows]
      );

      // Mark play as commission applied
      await connection.execute(
        `UPDATE play SET commission_applied = 1, commission_amount = ? WHERE play_id = ?`,
        [commissionAmount, sale.play_id]
      );

      results.push({
        writer: sale.username,
        gross: sale.price,
        commission: commissionAmount,
        bonus: rule.bonus_amount || 0
      });
    }

    // Log the total commission
    await connection.execute(
      `INSERT INTO commission_logs (total_commission, total_writers, applied_by)
       VALUES (?, ?, ?)`,
      [totalCommission, results.length, adminId]
    );

    await connection.commit(); // commit transaction
    connection.release();

    res.json({
      message: "All pending commissions and bonuses stored successfully.",
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


// When admin sends credit to writer, include any commission
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
      console.log(` No commission applied — transaction ${transactionId} not agent→writer`);
      connection.release();
      return;
    }

    console.log(` Agent sent credit to writer. Writer’s balance already includes commission.`);
  } catch (error) {
    console.error("Error applying commission on transaction:", error);
  } finally {
    connection.release();
  }
};

// View commission logs
const getCommissionLogs = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const [logs] = await connection.execute(`
      SELECT 
        cl.*, 
        u.username AS applied_by_name
      FROM commission_logs cl
      LEFT JOIN users u ON cl.applied_by = u.user_id
      ORDER BY cl.applied_at DESC
    `);

    res.json({
      success: true,
      message: "Commission logs fetched successfully",
      logs,
    });
  } catch (error) {
    console.error("Error fetching commission logs:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching commission logs",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

//  Bonus remains the same
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

    const [sales] = await connection.execute(
      `SELECT w.user_id, w.username, COALESCE(SUM(p.price), 0) AS total_sales
       FROM users w
       JOIN play p ON w.user_id = p.user_id
       WHERE w.role = 'writer' AND YEAR(p.created_at) = ?
       GROUP BY w.user_id, w.username`,
      [year]
    );

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
          bonus: rule.bonus_amount,
        });

        console.log(` Bonus applied to ${sale.username}: ${rule.bonus_amount}`);
      }
    }

    res.json({ message: `Year-end bonuses applied for ${year}`, bonuses });
  } catch (error) {
    console.error("Error applying year-end bonus:", error);
    res.status(500).json({ message: "Error applying year-end bonus", error: error.message });
  } finally {
    connection.release();
  }
};


// NEW: Commission summary (Gross, Commission, Bonus, Net)
const getFinancialSummary = async (req, res) => {
  const connection = await db.getConnection();

  try {
    // 📅 Get date filters from query params
    const { startDate, endDate } = req.query;

    // 🧠 Build dynamic date condition
    let dateCondition = "";
    let dateParams = [];

    if (startDate && endDate) {
      dateCondition = " AND created_at BETWEEN ? AND ?";
      dateParams = [startDate, endDate];
    }

    // 1️⃣ Gross (total sales)
    const [[grossResult]] = await connection.execute(
      `
      SELECT COALESCE(SUM(price), 0) AS gross
      FROM play
      WHERE 1=1 ${dateCondition}
      `,
      dateParams
    );

    const gross = parseFloat(grossResult.gross || 0);

    // 2️⃣ Total Commission applied
    const [[commissionResult]] = await connection.execute(
      `
      SELECT COALESCE(SUM(commission_amount), 0) AS total_commission
      FROM play
      WHERE commission_applied = 1 ${dateCondition}
      `,
      dateParams
    );

    const totalCommission = parseFloat(
      commissionResult.total_commission || 0
    );

    // 3️⃣ Total Bonus
    const [[bonusResult]] = await connection.execute(
      `
      SELECT COALESCE(SUM(bonus_amount), 0) AS total_bonus
      FROM commissions
      WHERE commissionType = 'bonus' ${dateCondition}
      `,
      dateParams
    );

    const totalBonus = parseFloat(bonusResult.total_bonus || 0);

    // 4️⃣ Net = Gross - Commission (bonus excluded)
    const net = gross - totalCommission;

    res.json({
      success: true,
      message: "Financial summary calculated successfully",
      filters: { startDate, endDate },
      summary: {
        gross,
        totalCommission,
        totalBonus,
        net,
      },
    });
  } catch (error) {
    console.error("Error getting financial summary:", error);
    res.status(500).json({
      success: false,
      message: "Error getting financial summary",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};


// NEW: Agent's Platform Summary (Gross & Net per platform)
const getAgentPlatformSummary = async (req, res) => {
  const agent_id = req.query.agent_id?.trim();
  const platform_id = req.query.platform_id?.trim();

  if (!agent_id || !platform_id) {
    return res.status(400).json({ message: 'agent_id and platform_id are required' });
  }

  const connection = await db.getConnection();

  try {
    // 1️⃣ Get all writers under this agent for the given platform
    const [writers] = await connection.execute(
      `SELECT user_id FROM users WHERE agent_id = ? AND platform_id = ? AND role = 'writer'`,
      [agent_id, platform_id]
    );

    if (writers.length === 0) {
      connection.release();
      return res.json({
        message: 'No writers found for this agent on this platform',
        summary: { gross: 0, totalCommission: 0, net: 0, is_commission: false },
      });
    }

    const writerIds = writers.map(w => w.user_id);
    const placeholders = writerIds.map(() => '?').join(',');

    // 2️⃣ Calculate total gross
    const [[grossResult]] = await connection.execute(
      `SELECT COALESCE(SUM(price), 0) AS gross
       FROM play
       WHERE user_id IN (${placeholders})`,
      writerIds
    );
    const gross = parseFloat(grossResult.gross || 0);

    // 3️⃣ Calculate total commission
    const [[commissionResult]] = await connection.execute(
      `SELECT COALESCE(SUM(commission_amount), 0) AS totalCommission
       FROM play
       WHERE user_id IN (${placeholders}) AND commission_applied = 1`,
      writerIds
    );
    const totalCommission = parseFloat(commissionResult.totalCommission || 0);

    // 4️⃣ Check if any commission applied
    const is_commission = totalCommission > 0;

    // 5️⃣ Net
    const net = gross - totalCommission;

    res.json({
      success: true,
      message: "Agent platform summary fetched successfully",
      summary: {
        platform_id,
        total_writers: writers.length,
        gross,
        totalCommission,
        net,
        is_commission,
      },
    });

  } catch (error) {
    console.error("Error getting agent platform summary:", error);
    res.status(500).json({
      success: false,
      message: "Error getting agent platform summary",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};


// Get current active commission rule
const getCurrentCommission = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const [[rule]] = await connection.execute(
      `SELECT * FROM commissions WHERE is_active = 1 LIMIT 1`
    );

    if (!rule) {
      connection.release();
      return res.status(404).json({ message: "No active commission rule found" });
    }

    res.json({
      success: true,
      message: "Current commission rule fetched successfully",
      commission: rule,
    });
  } catch (error) {
    console.error("Error fetching current commission:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching current commission",
      error: error.message,
    });
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
  getCurrentCommission,
};
