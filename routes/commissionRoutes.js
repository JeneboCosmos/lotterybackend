const express = require("express");
const router = express.Router();
const commissionController = require("../controllers/commissionController");

// Admin sets commission rule
router.post("/set", commissionController.setCommission);

// Apply all pending commissions
router.post("/apply", commissionController.applyAllPendingCommissions);

// Calculate year-end bonus
router.post("/bonus", commissionController.calculateYearEndBonus);

// Get commission logs
router.get("/logs", commissionController.getCommissionLogs);

// ✅ Get gross, commission, bonus, and net
router.get("/summary", commissionController.getFinancialSummary);
;

// NEW: Agent's Platform Summary (Gross & Net per platform)
router.get('/agent-platform-summarys', commissionController.getAgentPlatformSummary);

module.exports = router;
