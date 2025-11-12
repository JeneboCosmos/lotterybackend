// Assuming Express and MySQL2 setup
const express = require("express");
const router = express.Router();
const db = require("../config/db"); // adjust to your DB connection

// GET /api/platforms/:platformReference
router.get("/:platformReference", async (req, res) => {
  const { platformReference } = req.params;

  try {
    const [rows] = await db.execute(
      `SELECT 
          p.combination_id,
          ct.combination_name AS combination_name,
          COUNT(*) AS total_tickets,
          SUM(p.price) AS total_sales,
          SUM(p.stake) AS total_stake
       FROM play p
       LEFT JOIN combination_types ct ON p.combination_id = ct.combination_id
       WHERE p.platform_reference = ?
       GROUP BY p.combination_id, ct.combination_name
       ORDER BY p.combination_id ASC`,
      [platformReference]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: `No data found for platform: ${platformReference}` });
    }

    res.status(200).json(rows);
  } catch (err) {
    console.error("❌ Error fetching game histogram:", err);
    res.status(500).json({ message: "Server error fetching platform data" });
  }
});


module.exports = router;
