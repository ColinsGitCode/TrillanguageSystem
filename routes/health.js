'use strict';

const express = require('express');
const {
  HealthCheckService,
  E2E_TEST_MODE,
} = require('./_shared');

const router = express.Router();

router.get('/api/health', async (req, res) => {
    try {
        const status = await HealthCheckService.checkAll();
        if (status && typeof status === 'object') {
          status.e2e_test_mode = E2E_TEST_MODE;
        }
        res.json(status);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
