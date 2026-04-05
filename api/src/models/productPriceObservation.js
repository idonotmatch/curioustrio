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
         observed_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
      const offset = index * 12;
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
        row.observed_at
      );
      return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11},$${offset + 12})`;
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
         observed_at
       )
       VALUES ${placeholders.join(', ')}
       ON CONFLICT DO NOTHING
       RETURNING *`,
      values
    );
    return result.rows;
  }

  static async findRecentByIdentity({ productId = null, comparableKey = null, since = null, limit = 10 } = {}) {
    if (!productId && !comparableKey) return [];
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
    if (since) {
      values.push(since);
      clauses.push(`observed_at >= $${values.length}`);
    }
    values.push(limit);

    const result = await db.query(
      `SELECT *
       FROM product_price_observations
       WHERE (${productId && comparableKey ? clauses.slice(0, 2).join(' OR ') : clauses[0]})
       ${since ? `AND ${clauses[clauses.length - 1]}` : ''}
       ORDER BY observed_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows;
  }

  static async findBestRecentByIdentity({ productId = null, comparableKey = null, since = null } = {}) {
    const rows = await this.findRecentByIdentity({ productId, comparableKey, since, limit: 25 });
    if (!rows.length) return null;

    return rows.reduce((best, current) => {
      const bestPrice = Number(best.observed_unit_price || best.observed_price);
      const currentPrice = Number(current.observed_unit_price || current.observed_price);
      return currentPrice < bestPrice ? current : best;
    });
  }
}

module.exports = ProductPriceObservation;
