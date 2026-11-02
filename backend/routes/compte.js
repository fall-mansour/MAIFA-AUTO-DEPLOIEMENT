const express = require('express');
const router = express.Router();
const compteCtrl = require('../controllers/compte.controller');

// POST http://localhost:3000/api/compte/register
router.post('/register', compteCtrl.getInscription);

module.exports = router;
