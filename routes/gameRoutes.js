// routes/gameRoutes.js
const db = require('../config/db');
const express = require('express');
const router = express.Router();

// Import controller
const gameController = require('../controllers/gameController');

// Define the routes
router.post('/', gameController.createGame); // Create a game
router.get('/', gameController.getAllGames); // Get all games
router.get('/:game_id', gameController.getGameById); // Get a game by ID
router.get('/today', gameController.getTodayGames); 
router.put('/:game_id', gameController.updateGame); // Update a game
router.delete('/:game_id', gameController.deleteGame); // Delete a game


module.exports = router;


