// routes/play.js
const express = require('express');
const router = express.Router();
const playController = require('../controllers/playController');

router.get('/number-pool', playController.getNumberPool); // GET 1-90 pool
router.post('/create', playController.createPlay);        // POST create a play
router.get('/', playController.getAllPlays);              // GET all plays
router.post('/combination/preview', playController.previewCombination);




module.exports = router;


