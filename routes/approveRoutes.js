const express = require('express');
const router = express.Router();
const approveController = require('../controllers/approveController');


// Route to approve a game — admin must be authenticated
router.patch('/games/:game_id/approve',  approveController.approveGame);

module.exports = router;
