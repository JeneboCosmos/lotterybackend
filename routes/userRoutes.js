const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const auth = require('../middleware/auth');

// Auth Routes
router.post('/register', userController.register); // Ensure this is a function in userController.js
router.post('/login', userController.login); // Ensure this is a function in userController.js

// CRUD Routes
router.get('/users/:id', userController.getUserById); 
router.get('/users', userController.getAllUsers); // Ensure this is a function in userController.js
router.put('/users/:id', userController.updateUser); // Ensure this is a function in userController.js
router.delete('/users/:id', userController.deleteUser); // Ensure this is a function in userController.js
router.put('/users/:id/toggle', userController.toggleUserStatus);
router.get('/agents/:agentId/writers', userController.getWritersByAgent);
router.post('/users/reset-password', userController.resetPassword);

router.put('/change-password', userController.changePassword);



module.exports = router;


