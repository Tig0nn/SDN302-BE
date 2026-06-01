const express = require('express');
const { requireAuth } = require('../../middlewares/auth');
const paymentAccountRepository = require('./paymentAccountRepository');

const router = express.Router();

function sendOk(req, res, data) {
  res.json({
    data,
    meta: {
      requestId: req.requestId,
    },
    error: null,
  });
}

router.get('/', requireAuth, async function getPaymentAccounts(req, res, next) {
  try {
    const paymentAccounts = await paymentAccountRepository.listPaymentAccounts(
      req.user.id
    );

    sendOk(req, res, { paymentAccounts });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
