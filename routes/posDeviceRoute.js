const express = require('express');
const router = express.Router();
const posDeviceController = require('../controllers/posDeviceController');

// 🟩 CRUD ROUTES
router.post('/', posDeviceController.createPosDevice);
router.get('/', posDeviceController.getAllPosDevices);

router.put('/:id', posDeviceController.updatePosDevice);
router.delete('/:id', posDeviceController.deletePosDevice);
router.get('/pos-of-agent', posDeviceController.getPosDevices);
router.post('/assign-pos-to-writer', posDeviceController.assignPosToWriter);

module.exports = router;
