const db = require('../db');

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
  const result = await db.query(
    `SELECT * FROM products WHERE sku = $1 AND merchant = $2 LIMIT 1`,
    [sku, merchant]
  );
  return result.rows[0] || null;
}

async function create({ name, brand, upc, sku, merchant, productSize, packSize, unit }) {
  const result = await db.query(
    `INSERT INTO products (name, brand, upc, sku, merchant, product_size, pack_size, unit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [name, brand || null, upc || null, sku || null, merchant || null,
     productSize || null, packSize || null, unit || null]
  );
  return result.rows[0];
}

async function update(id, { name, brand, upc, sku, merchant, productSize, packSize, unit }) {
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
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, name || null, brand || null, upc || null, sku || null, merchant || null,
     productSize || null, packSize || null, unit || null]
  );
  return result.rows[0] || null;
}

module.exports = { findByUpc, findBySkuAndMerchant, create, update };
