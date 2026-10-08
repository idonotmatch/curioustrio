const db = require('../db');
const { normalizeItemMetadata } = require('../services/itemNormalizer');
const { canonicalMerchantKey } = require('../services/merchantIdentity');

async function findByUpc(upc) {
  if (!upc) return null;
  const result = await db.query(
    `SELECT * FROM products WHERE upc = $1 LIMIT 1`,
    [upc]
  );
  return result.rows[0] || null;
}

async function findBySkuAndMerchant(sku, merchant) {
  if (!sku || !merchant) return null;
  const merchantKey = canonicalMerchantKey(merchant);
  if (!merchantKey) return null;
  const result = await db.query(
    `SELECT * FROM products
     WHERE sku = $1
       AND REGEXP_REPLACE(LOWER(COALESCE(merchant, '')), '[^a-z0-9]+', '', 'g') = $2
     LIMIT 1`,
    [sku, merchantKey]
  );
  return result.rows[0] || null;
}

async function findByNormalizedDetails({ name, merchant, brand, productSize, packSize, unit, allowCrossMerchant = false }) {
  if (!name) return null;
  const normalized = normalizeItemMetadata({
    description: name,
    brand,
    product_size: productSize,
    pack_size: packSize,
    unit,
  });
  const merchantKey = canonicalMerchantKey(merchant);
  const result = await db.query(
    `SELECT *
     FROM products
     WHERE comparable_key = $1
       AND ($2::text = '' OR REGEXP_REPLACE(LOWER(COALESCE(merchant, '')), '[^a-z0-9]+', '', 'g') = $2 OR $3::boolean = TRUE)
     ORDER BY
       CASE WHEN $2::text <> '' AND REGEXP_REPLACE(LOWER(COALESCE(merchant, '')), '[^a-z0-9]+', '', 'g') = $2 THEN 0 ELSE 1 END,
       created_at ASC
     LIMIT 1`,
    [normalized.comparable_key, merchantKey, allowCrossMerchant]
  );
  return result.rows[0] || null;
}

async function findNameCandidates({ merchant, normalizedBrand, searchToken, limit = 12 }) {
  const merchantText = `${merchant || ''}`.trim();
  const merchantKey = canonicalMerchantKey(merchantText);
  const brandText = `${normalizedBrand || ''}`.trim();
  const tokenText = `${searchToken || ''}`.trim();
  if ((!merchantText && !brandText) || !tokenText) return [];
  const result = await db.query(
    `SELECT *
     FROM products
     WHERE normalized_name IS NOT NULL
       AND (
         ($1::text <> '' AND REGEXP_REPLACE(LOWER(COALESCE(merchant, '')), '[^a-z0-9]+', '', 'g') = $1)
         OR ($2::text <> '' AND normalized_brand = $2)
       )
       AND normalized_name ILIKE ('%' || $3 || '%')
     ORDER BY
       CASE WHEN $1::text <> '' AND REGEXP_REPLACE(LOWER(COALESCE(merchant, '')), '[^a-z0-9]+', '', 'g') = $1 THEN 0 ELSE 1 END,
       updated_at DESC,
       created_at ASC
     LIMIT $4`,
    [merchantKey, brandText, tokenText, Math.max(1, Math.min(Number(limit) || 12, 25))]
  );
  return result.rows;
}

async function create({ name, brand, upc, sku, merchant, productSize, packSize, unit }) {
  const normalized = normalizeItemMetadata({
    description: name,
    brand,
    product_size: productSize,
    pack_size: packSize,
    unit,
  });
  const result = await db.query(
    `INSERT INTO products (
       name, brand, upc, sku, merchant, product_size, pack_size, unit,
       normalized_name, normalized_brand, normalized_size_value, normalized_size_unit, normalized_pack_size,
       normalized_quantity, normalized_total_size_value, normalized_total_size_unit, comparable_key
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING *`,
    [name, brand || null, upc || null, sku || null, merchant || null,
     productSize || null, packSize || null, unit || null,
     normalized.normalized_name, normalized.normalized_brand, normalized.normalized_size_value,
     normalized.normalized_size_unit, normalized.normalized_pack_size, normalized.normalized_quantity,
     normalized.normalized_total_size_value, normalized.normalized_total_size_unit, normalized.comparable_key]
  );
  return result.rows[0];
}

async function update(id, { name, brand, upc, sku, merchant, productSize, packSize, unit }) {
  const normalized = normalizeItemMetadata({
    description: name,
    brand,
    product_size: productSize,
    pack_size: packSize,
    unit,
  });
  const result = await db.query(
    `UPDATE products
     SET name = COALESCE($2, name),
         brand = COALESCE($3, brand),
         upc = COALESCE($4, upc),
         sku = COALESCE($5, sku),
         merchant = COALESCE($6, merchant),
         product_size = COALESCE($7, product_size),
         pack_size = COALESCE($8, pack_size),
         unit = COALESCE($9, unit),
         normalized_name = COALESCE($10, normalized_name),
         normalized_brand = COALESCE($11, normalized_brand),
         normalized_size_value = COALESCE($12, normalized_size_value),
         normalized_size_unit = COALESCE($13, normalized_size_unit),
         normalized_pack_size = COALESCE($14, normalized_pack_size),
         normalized_quantity = COALESCE($15, normalized_quantity),
         normalized_total_size_value = COALESCE($16, normalized_total_size_value),
         normalized_total_size_unit = COALESCE($17, normalized_total_size_unit),
         comparable_key = COALESCE($18, comparable_key),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, name || null, brand || null, upc || null, sku || null, merchant || null,
     productSize || null, packSize || null, unit || null,
     normalized.normalized_name, normalized.normalized_brand, normalized.normalized_size_value,
     normalized.normalized_size_unit, normalized.normalized_pack_size, normalized.normalized_quantity,
     normalized.normalized_total_size_value, normalized.normalized_total_size_unit, normalized.comparable_key]
  );
  return result.rows[0] || null;
}

module.exports = { findByUpc, findBySkuAndMerchant, findByNormalizedDetails, findNameCandidates, create, update };
