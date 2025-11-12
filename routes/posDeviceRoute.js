const express = require('express');
const router = express.Router();
const posDeviceController = require('../controllers/posDeviceController');

// 🟩 CRUD ROUTES
router.post('/', posDeviceController.createPosDevice);
router.get('/', posDeviceController.getAllPosDevices);
router.get('/:id', posDeviceController.getPosDeviceById);
router.put('/:id', posDeviceController.updatePosDevice);
router.delete('/:id', posDeviceController.deletePosDevice);

module.exports = router;
