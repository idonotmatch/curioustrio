const db = require('../db');

function normalizeObservation(input = {}) {
  return {
    product_id: input.productId || input.product_id || null,
    comparable_key: input.comparableKey || input.comparable_key || null,
    merchant: `${input.merchant || ''}`.trim(),
    observed_price: input.observedPrice ?? input.observed_price ?? null,
    observed_unit_price: input.observedUnitPrice ?? input.observed_unit_price ?? null,
    normalized_total_size_value: input.normalizedTotalSizeValue ?? input.normalized_total_size_value ?? null,
    normalized_total_size_unit: input.normalizedTotalSizeUnit ?? input.normalized_total_size_unit ?? null,
    url: input.url ? `${input.url}`.trim() : null,
    source_type: `${input.sourceType || input.source_type || ''}`.trim(),
    source_key: input.sourceKey || input.source_key || null,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : null,
    observed_at: input.observedAt || input.observed_at || null,
    submitted_by_user_id: input.submittedByUserId || input.submitted_by_user_id || null,
    offer_watch_id: input.offerWatchId || input.offer_watch_id || null,
    source_trust: input.sourceTrust || input.source_trust || 'user_provided',
  };
}

class ProductPriceObservation {
  static normalize(input) {
    return normalizeObservation(input);
  }

  static async create(input) {
    const row = normalizeObservation(input);
    const result = await db.query(
      `INSERT INTO product_price_observations (
         product_id,
         comparable_key,
         merchant,
         observed_price,
         observed_unit_price,
         normalized_total_size_value,
         normalized_total_size_unit,
         url,
         source_type,
         source_key,
         metadata,
         observed_at,
         submitted_by_user_id,
         offer_watch_id,
         source_trust
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        row.product_id,
        row.comparable_key,
        row.merchant,
        row.observed_price,
        row.observed_unit_price,
        row.normalized_total_size_value,
        row.normalized_total_size_unit,
        row.url,
        row.source_type,
        row.source_key,
        row.metadata,
        row.observed_at,
        row.submitted_by_user_id,
        row.offer_watch_id,
        row.source_trust,
      ]
    );
    return result.rows[0] || null;
  }

  static async createBatch(inputs = []) {
    const clean = inputs
      .map(normalizeObservation)
      .filter((row) => row.merchant && row.source_type && row.observed_price && row.observed_at && (row.product_id || row.comparable_key));

    if (!clean.length) return [];

    const values = [];
    const placeholders = clean.map((row, index) => {
      const offset = index * 15;
      values.push(
        row.product_id,
        row.comparable_key,
        row.merchant,
        row.observed_price,
        row.observed_unit_price,
        row.normalized_total_size_value,
        row.normalized_total_size_unit,
        row.url,
        row.source_type,
        row.source_key,
        row.metadata,
        row.observed_at,
        row.submitted_by_user_id,
        row.offer_watch_id,
        row.source_trust
      );
      return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11},$${offset + 12},$${offset + 13},$${offset + 14},$${offset + 15})`;
    });

    const result = await db.query(
      `INSERT INTO product_price_observations (
         product_id,
         comparable_key,
         merchant,
         observed_price,
         observed_unit_price,
         normalized_total_size_value,
         normalized_total_size_unit,
         url,
         source_type,
         source_key,
         metadata,
         observed_at,
         submitted_by_user_id,
         offer_watch_id,
         source_trust
       )
       VALUES ${placeholders.join(', ')}
       ON CONFLICT DO NOTHING
       RETURNING *`,
      values
    );
    return result.rows;
  }

  static async findRecentByIdentity({ productId = null, comparableKey = null, offerWatchId = null, since = null, limit = 10, userId = null } = {}) {
    if (!productId && !comparableKey && !offerWatchId) return [];
    const clauses = [];
    const values = [];

    if (productId) {
      values.push(productId);
      clauses.push(`product_id = $${values.length}`);
    }
    if (comparableKey) {
      values.push(comparableKey);
      clauses.push(`comparable_key = $${values.length}`);
    }
    if (offerWatchId) {
      values.push(offerWatchId);
      clauses.push(`offer_watch_id = $${values.length}`);
    }
    if (since) {
      values.push(since);
      clauses.push(`observed_at >= $${values.length}`);
    }
    if (userId) {
      values.push(userId);
      clauses.push(`(source_trust = 'trusted_provider' OR submitted_by_user_id = $${values.length})`);
    } else {
      clauses.push(`source_trust = 'trusted_provider'`);
    }
    values.push(limit);

    const identityClauseCount = Number(Boolean(productId)) + Number(Boolean(comparableKey)) + Number(Boolean(offerWatchId));
    const identityClause = identityClauseCount > 1 ? clauses.slice(0, identityClauseCount).join(' OR ') : clauses[0];
    const filterClauses = clauses.slice(identityClauseCount);

    const result = await db.query(
      `SELECT *
       FROM product_price_observations
       WHERE (${identityClause})
       ${filterClauses.map((clause) => `AND ${clause}`).join('\n       ')}
       ORDER BY observed_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows;
  }

  static async findBestRecentByIdentity({ productId = null, comparableKey = null, offerWatchId = null, since = null, userId = null } = {}) {
    const rows = await this.findRecentByIdentity({ productId, comparableKey, offerWatchId, since, limit: 25, userId });
    if (!rows.length) return null;

    return rows.reduce((best, current) => {
      const bestPrice = Number(best.observed_unit_price || best.observed_price);
      const currentPrice = Number(current.observed_unit_price || current.observed_price);
      return currentPrice < bestPrice ? current : best;
    });
  }
}

module.exports = ProductPriceObservation;
