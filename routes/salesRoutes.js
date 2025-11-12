const express = require('express');
const router = express.Router();
const salesController = require('../controllers/salesController');

router.get('/sales-summary', salesController.getSalesSummary);
router.get('/top-agents', salesController.getTopAgents);
router.get('/agent-platform-summary', salesController.getAgentPlatformSummary); // ✅ NEW

router.get('/top-writers-agent-platform', salesController.getTopWritersOfAgentPlatform);
router.get('/writers-of-agent', salesController.getAllWritersOfAgent);

module.exports = router;
