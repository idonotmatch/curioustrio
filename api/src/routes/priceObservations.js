const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const ProductPriceObservation = require('../models/productPriceObservation');

router.use(authenticate);

async function getUser(req) {
  return User.findByProviderUid(req.userId);
}

function validateObservation(input = {}) {
  const row = ProductPriceObservation.normalize(input);
  if (!row.merchant) return 'merchant is required';
  if (!row.source_type) return 'source_type is required';
  if (!row.observed_at) return 'observed_at is required';
  if (row.observed_price == null || Number(row.observed_price) <= 0) return 'observed_price must be a positive number';
  if (!row.product_id && !row.comparable_key) return 'product_id or comparable_key is required';
  return null;
}

router.post('/', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const batch = Array.isArray(req.body?.observations)
      ? req.body.observations
      : req.body
        ? [req.body]
        : [];

    if (!batch.length) {
      return res.status(400).json({ error: 'observation or observations array is required' });
    }

    for (const observation of batch) {
      const error = validateObservation(observation);
      if (error) return res.status(400).json({ error });
    }

    const created = batch.length === 1
      ? await ProductPriceObservation.create(batch[0])
      : await ProductPriceObservation.createBatch(batch);

    if (batch.length === 1) {
      return res.status(created ? 201 : 200).json({ observation: created, deduped: !created });
    }

    return res.status(201).json({ observations: created, received: batch.length, inserted: created.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
