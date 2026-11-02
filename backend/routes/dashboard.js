const express = require('express');
const router = express.Router();
const dashboardCtrl = require('../controllers/dashboard.controller');

router.get('/stats', dashboardCtrl.getStats);

module.exports = router;
