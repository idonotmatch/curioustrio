const crypto = require('crypto');
const db = require('../db');
const Expense = require('../models/expense');
const MatchDecision = require('../models/matchDecision');
const { canViewExpense } = require('./expenseAccessPolicy');
const {
  normalizedKey,
  normalizedLast4,
  placeIdentityKey,
  resolveExpenseIdentities,
} = require('./entityResolutionService');
const { canonicalMerchantKey, cleanMerchantDisplayName } = require('./merchantIdentity');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function compact(value, max = 240) {
  const result = `${value || ''}`.replace(/\s+/g, ' ').trim();
  return result ? result.slice(0, max) : null;
}

async function getExpenseIdentityContext({ user, expenseId }) {
  const expense = await Expense.findById(expenseId);
  if (!expense || !canViewExpense(user, expense)) throw httpError(404, 'Expense not found');
  const result = await db.query(
    `SELECT
       row_to_json(merchant_identity_row) AS merchant_identity,
       row_to_json(payment_identity_row) AS payment_identity,
       row_to_json(place_identity_row) AS place_identity,
       COALESCE((SELECT json_agg(alias ORDER BY alias.occurrence_count DESC, alias.alias_name)
                 FROM merchant_aliases alias WHERE alias.merchant_entity_id = merchant_identity_row.id), '[]'::json) AS merchant_aliases,
       COALESCE((SELECT json_agg(alias ORDER BY alias.occurrence_count DESC, alias.alias_name)
                 FROM payment_instrument_aliases alias WHERE alias.payment_instrument_id = payment_identity_row.id), '[]'::json) AS payment_aliases,
       COALESCE((SELECT json_agg(alias ORDER BY alias.occurrence_count DESC, alias.alias_name)
                 FROM place_aliases alias WHERE alias.place_entity_id = place_identity_row.id), '[]'::json) AS place_aliases,
       COALESCE((SELECT json_agg(evidence ORDER BY evidence.domain)
                 FROM expense_match_evidence evidence WHERE evidence.expense_id = expense.id), '[]'::json) AS evidence,
       (SELECT COUNT(*)::int FROM expenses linked WHERE linked.merchant_entity_id = merchant_identity_row.id) AS merchant_expense_count,
       (SELECT COUNT(*)::int FROM expenses linked WHERE linked.payment_instrument_id = payment_identity_row.id) AS payment_expense_count,
       (SELECT COUNT(*)::int FROM expenses linked WHERE linked.place_entity_id = place_identity_row.id) AS place_expense_count
     FROM expenses expense
     LEFT JOIN merchant_entities merchant_identity_row ON merchant_identity_row.id = expense.merchant_entity_id
     LEFT JOIN payment_instruments payment_identity_row
       ON payment_identity_row.id = expense.payment_instrument_id
      AND payment_identity_row.user_id = $2
     LEFT JOIN place_entities place_identity_row
       ON place_identity_row.id = expense.place_entity_id
      AND place_identity_row.user_id = $2
     WHERE expense.id = $1`,
    [expenseId, user.id]
  );
  const context = result.rows[0] || {};
  const [merchantCandidates, paymentCandidates, placeCandidates] = await Promise.all([
    user.household_id ? db.query(
      `SELECT id, display_name, chain_key, branch_key,
              (SELECT COUNT(*)::int FROM expenses WHERE merchant_entity_id = merchant_entities.id) AS expense_count
       FROM merchant_entities
       WHERE household_id = $1 AND status = 'active' AND id IS DISTINCT FROM $2
       ORDER BY updated_at DESC LIMIT 20`,
      [user.household_id, expense.merchant_entity_id || null]
    ) : { rows: [] },
    db.query(
      `SELECT id, display_label, card_last4, payment_method, issuer, network,
              (SELECT COUNT(*)::int FROM expenses WHERE payment_instrument_id = payment_instruments.id) AS expense_count
       FROM payment_instruments
       WHERE user_id = $1 AND status = 'active' AND id IS DISTINCT FROM $2
       ORDER BY updated_at DESC LIMIT 20`,
      [user.id, expense.payment_instrument_id || null]
    ),
    db.query(
      `SELECT id, place_name, address, chain_key, branch_key,
              (SELECT COUNT(*)::int FROM expenses WHERE place_entity_id = place_entities.id) AS expense_count
       FROM place_entities
       WHERE user_id = $1 AND status = 'active' AND id IS DISTINCT FROM $2
       ORDER BY updated_at DESC LIMIT 20`,
      [user.id, expense.place_entity_id || null]
    ),
  ]);
  return {
    expense: {
      id: expense.id,
      merchant: expense.merchant,
      payment_method: expense.payment_method,
      card_label: expense.card_label,
      card_last4: expense.card_last4,
      place_name: expense.place_name,
      address: expense.address,
    },
    ...context,
    candidates: {
      merchant: merchantCandidates.rows,
      payment: paymentCandidates.rows,
      place: placeCandidates.rows,
    },
  };
}

async function requireIdentity({ user, domain, entityId, queryable = db }) {
  const config = {
    merchant: { table: 'merchant_entities', owner: 'household_id', ownerId: user.household_id },
    payment: { table: 'payment_instruments', owner: 'user_id', ownerId: user.id },
    place: { table: 'place_entities', owner: 'user_id', ownerId: user.id },
  }[domain];
  if (!config || !config.ownerId) throw httpError(404, 'Identity not found');
  const result = await queryable.query(
    `SELECT * FROM ${config.table} WHERE id = $1 AND ${config.owner} = $2 LIMIT 1`,
    [entityId, config.ownerId]
  );
  if (!result.rows[0]) throw httpError(404, 'Identity not found');
  return result.rows[0];
}

async function addAlias({ user, domain, entityId, alias, queryable = db }) {
  const entity = await requireIdentity({ user, domain, entityId, queryable });
  const aliasName = compact(alias, 160);
  if (!aliasName) throw httpError(400, 'Alias is required');
  if (domain === 'merchant') {
    const aliasKey = normalizedKey(aliasName, 240);
    const result = await queryable.query(
      `INSERT INTO merchant_aliases (
         household_id, merchant_entity_id, alias_key, alias_name, source, confidence
       ) VALUES ($1,$2,$3,$4,'user_confirmed',1)
       ON CONFLICT (household_id, alias_key) DO UPDATE SET
         merchant_entity_id = EXCLUDED.merchant_entity_id,
         alias_name = EXCLUDED.alias_name,
         source = 'user_confirmed', confidence = 1, updated_at = NOW()
       RETURNING *`,
      [user.household_id, entity.id, aliasKey, aliasName]
    );
    await MatchDecision.recordObservedRule({
      userId: user.id, householdId: user.household_id, domain, decision: 'same',
      observedKey: aliasKey, targetEntityId: entity.id, queryable,
    });
    return result.rows[0];
  }
  if (domain === 'place') {
    const aliasKey = normalizedKey(aliasName, 240);
    const result = await queryable.query(
      `INSERT INTO place_aliases (user_id, place_entity_id, alias_key, alias_name, source, confidence)
       VALUES ($1,$2,$3,$4,'user_confirmed',1)
       ON CONFLICT (user_id, alias_key) DO UPDATE SET
         place_entity_id = EXCLUDED.place_entity_id,
         alias_name = EXCLUDED.alias_name,
         source = 'user_confirmed', confidence = 1, updated_at = NOW()
       RETURNING *`,
      [user.id, entity.id, aliasKey, aliasName]
    );
    await MatchDecision.recordObservedRule({
      userId: user.id, householdId: user.household_id, domain, decision: 'same',
      observedKey: aliasKey, targetEntityId: entity.id, queryable,
    });
    return result.rows[0];
  }
  throw httpError(400, 'Payment aliases are managed with the payment instrument');
}

async function updateIdentity({ user, domain, entityId, patch = {} }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const entity = await requireIdentity({ user, domain, entityId, queryable: client });
    let result;
    if (domain === 'merchant') {
      const displayName = cleanMerchantDisplayName(patch.display_name ?? entity.display_name);
      if (!displayName) throw httpError(400, 'Merchant name is required');
      result = await client.query(
        `UPDATE merchant_entities SET
           display_name = $3,
           chain_key = $4,
           branch_key = $5,
           seller_context = $6,
           updated_at = NOW()
         WHERE id = $1 AND household_id = $2
         RETURNING *`,
        [entity.id, user.household_id, displayName, compact(patch.chain_key ?? entity.chain_key, 160), compact(patch.branch_key ?? entity.branch_key, 160), compact(patch.seller_context ?? entity.seller_context, 200)]
      );
      await addAlias({ user, domain, entityId, alias: displayName, queryable: client });
    } else if (domain === 'payment') {
      const last4 = normalizedLast4(patch.card_last4 ?? entity.card_last4);
      const label = compact(patch.display_label ?? entity.display_label, 120);
      if (!last4 && !label) throw httpError(400, 'Card label or last four digits required');
      result = await client.query(
        `UPDATE payment_instruments SET
           display_label = $3, card_last4 = $4, label_key = $5,
           issuer = $6, network = $7, confidence = 1,
           status = 'active', forgotten_at = NULL, updated_at = NOW()
         WHERE id = $1 AND user_id = $2 RETURNING *`,
        [entity.id, user.id, label, last4, normalizedKey(label, 140), compact(patch.issuer ?? entity.issuer, 80), compact(patch.network ?? entity.network, 40)]
      );
      const aliases = [
        last4 ? { key: `last4:${last4}`, name: label, last4 } : null,
        label ? { key: `label:${normalizedKey(label, 140)}`, name: label, last4: last4 || '' } : null,
      ].filter(Boolean);
      for (const alias of aliases) {
        await client.query(
          `INSERT INTO payment_instrument_aliases (
             user_id, payment_instrument_id, payment_method, alias_key, alias_name,
             card_last4, source, confidence
           ) VALUES ($1,$2,$3,$4,$5,$6,'user_confirmed',1)
           ON CONFLICT (user_id, payment_method, alias_key, card_last4) DO UPDATE SET
             payment_instrument_id = EXCLUDED.payment_instrument_id,
             alias_name = EXCLUDED.alias_name,
             source = 'user_confirmed', confidence = 1, updated_at = NOW()`,
          [user.id, entity.id, entity.payment_method, alias.key, alias.name, alias.last4]
        );
        await MatchDecision.recordObservedRule({
          userId: user.id, householdId: user.household_id, domain, decision: 'same',
          observedKey: `${entity.payment_method}:${alias.key}`, targetEntityId: entity.id, queryable: client,
        });
      }
    } else {
      result = await client.query(
        `UPDATE place_entities SET
           place_name = $3, address = $4, chain_key = $5, branch_key = $6,
           status = $7, updated_at = NOW()
         WHERE id = $1 AND user_id = $2 RETURNING *`,
        [entity.id, user.id, compact(patch.place_name ?? entity.place_name, 160), compact(patch.address ?? entity.address, 320), compact(patch.chain_key ?? entity.chain_key, 160), compact(patch.branch_key ?? entity.branch_key, 160), patch.status === undefined ? entity.status : (patch.status === 'moved' ? 'moved' : 'active')]
      );
      if (patch.alias) await addAlias({ user, domain, entityId, alias: patch.alias, queryable: client });
    }
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function mergeIdentities({ user, domain, sourceEntityId, targetEntityId }) {
  if (sourceEntityId === targetEntityId) throw httpError(400, 'Choose two different identities');
  const config = {
    merchant: { entity: 'merchant_entities', alias: 'merchant_aliases', expenseColumn: 'merchant_entity_id', owner: 'household_id', ownerId: user.household_id },
    payment: { entity: 'payment_instruments', alias: 'payment_instrument_aliases', expenseColumn: 'payment_instrument_id', owner: 'user_id', ownerId: user.id },
    place: { entity: 'place_entities', alias: 'place_aliases', expenseColumn: 'place_entity_id', owner: 'user_id', ownerId: user.id },
  }[domain];
  if (!config) throw httpError(400, 'Invalid identity domain');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await requireIdentity({ user, domain, entityId: sourceEntityId, queryable: client });
    await requireIdentity({ user, domain, entityId: targetEntityId, queryable: client });
    if (domain === 'payment') {
      await client.query(
        `DELETE FROM ${config.alias} source
         USING ${config.alias} target
         WHERE source.payment_instrument_id = $1 AND target.payment_instrument_id = $2
           AND source.user_id = target.user_id
           AND source.payment_method = target.payment_method
           AND source.alias_key = target.alias_key
           AND source.card_last4 = target.card_last4`,
        [sourceEntityId, targetEntityId]
      );
    }
    await client.query(
      `UPDATE ${config.alias} SET ${domain === 'merchant' ? 'merchant_entity_id' : domain === 'payment' ? 'payment_instrument_id' : 'place_entity_id'} = $2,
         source = 'user_confirmed', confidence = 1, updated_at = NOW()
       WHERE ${domain === 'merchant' ? 'merchant_entity_id' : domain === 'payment' ? 'payment_instrument_id' : 'place_entity_id'} = $1`,
      [sourceEntityId, targetEntityId]
    );
    await client.query(`UPDATE expenses SET ${config.expenseColumn} = $2 WHERE ${config.expenseColumn} = $1`, [sourceEntityId, targetEntityId]);
    await client.query(
      `UPDATE expense_identity_overrides
       SET entity_id = $2, decision = 'use_entity', updated_at = NOW()
       WHERE domain = $3 AND entity_id = $1`,
      [sourceEntityId, targetEntityId, domain]
    );
    await client.query(
      `UPDATE expense_match_evidence
       SET entity_id = $2, method = 'user_merged_identity', confidence = 1,
           resolver_version = 'identity-v2', updated_at = NOW()
       WHERE domain = $3 AND entity_id = $1`,
      [sourceEntityId, targetEntityId, domain]
    );
    await client.query(
      `UPDATE match_decisions SET target_entity_id = $2, updated_at = NOW()
       WHERE domain = $3 AND target_entity_id = $1`,
      [sourceEntityId, targetEntityId, domain]
    );
    const mergeColumn = domain === 'place' ? 'superseded_by_id' : 'merged_into_id';
    await client.query(
      `UPDATE ${config.entity} SET status = 'merged', ${mergeColumn} = $2, updated_at = NOW()
       WHERE id = $1 AND ${config.owner} = $3`,
      [sourceEntityId, targetEntityId, config.ownerId]
    );
    await MatchDecision.recordObservedRule({
      userId: user.id, householdId: user.household_id, domain, decision: 'same',
      observedKey: `entity-pair:${[sourceEntityId, targetEntityId].sort().join(':')}`,
      targetEntityId, evidence: { source_entity_id: sourceEntityId }, queryable: client,
    });
    await client.query('COMMIT');
    return { merged: true, source_entity_id: sourceEntityId, target_entity_id: targetEntityId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function separateExpenseIdentity({ user, expenseId, domain }) {
  if (!['merchant', 'payment', 'place'].includes(domain)) throw httpError(400, 'Invalid identity domain');
  const expense = await Expense.findById(expenseId);
  if (!expense || expense.user_id !== user.id) throw httpError(404, 'Expense not found');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    let entityId;
    const suffix = crypto.randomUUID().slice(0, 8);
    if (domain === 'merchant') {
      if (!expense.merchant || !user.household_id) throw httpError(400, 'This expense has no merchant to separate');
      const canonical = canonicalMerchantKey(expense.merchant) || 'merchant';
      const created = await client.query(
        `INSERT INTO merchant_entities (
           household_id, canonical_key, display_name, chain_key, branch_key
         ) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [user.household_id, `${canonical}:separate:${suffix}`, cleanMerchantDisplayName(expense.merchant), canonical, `expense:${expense.id}`]
      );
      entityId = created.rows[0].id;
    } else if (domain === 'payment') {
      if (!['credit', 'debit'].includes(expense.payment_method)) throw httpError(400, 'This expense has no card to separate');
      const created = await client.query(
        `INSERT INTO payment_instruments (
           user_id, payment_method, card_last4, display_label, label_key, confidence
         ) VALUES ($1,$2,$3,$4,$5,1) RETURNING id`,
        [user.id, expense.payment_method, null, expense.card_label || `Card ${expense.card_last4 || ''}`.trim(), `separate:${expense.id}:${suffix}`]
      );
      entityId = created.rows[0].id;
    } else {
      const identityKey = placeIdentityKey(expense);
      if (!identityKey) throw httpError(400, 'This expense has no place to separate');
      const created = await client.query(
        `INSERT INTO place_entities (
           user_id, identity_key, provider, provider_place_id, coordinate_key,
           place_name, address, name_key, chain_key, branch_key
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [user.id, `override:${expense.id}:${suffix}`, expense.location_source || null, expense.location_provider_id || null, expense.mapkit_stable_id || null, expense.place_name || null, expense.address || null, normalizedKey(expense.place_name, 180), normalizedKey(expense.merchant, 160), `expense:${expense.id}`]
      );
      entityId = created.rows[0].id;
    }
    await client.query(
      `INSERT INTO expense_identity_overrides (user_id, expense_id, domain, entity_id, decision)
       VALUES ($1,$2,$3,$4,'keep_separate')
       ON CONFLICT (expense_id, domain) DO UPDATE SET
         entity_id = EXCLUDED.entity_id, decision = 'keep_separate', updated_at = NOW()`,
      [user.id, expense.id, domain, entityId]
    );
    const column = `${domain === 'payment' ? 'payment_instrument' : `${domain}_entity`}_id`;
    await client.query(`UPDATE expenses SET ${column} = $2 WHERE id = $1 AND user_id = $3`, [expense.id, entityId, user.id]);
    await MatchDecision.recordObservedRule({
      userId: user.id, householdId: user.household_id, domain, decision: 'different',
      observedKey: `expense:${expense.id}`, targetEntityId: entityId,
      evidence: { previous_entity_id: expense[`${domain === 'payment' ? 'payment_instrument' : `${domain}_entity`}_id`] || null },
      queryable: client,
    });
    await resolveExpenseIdentities({ expense: { ...expense, id: expense.id }, userId: user.id, householdId: user.household_id, queryable: client });
    await client.query('COMMIT');
    return { separated: true, domain, entity_id: entityId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function markPlaceMoved({ user, sourceEntityId, targetEntityId }) {
  if (sourceEntityId === targetEntityId) throw httpError(400, 'Choose a different destination');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const source = await requireIdentity({ user, domain: 'place', entityId: sourceEntityId, queryable: client });
    const target = await requireIdentity({ user, domain: 'place', entityId: targetEntityId, queryable: client });
    const sharedChainKey = source.chain_key || target.chain_key || normalizedKey(source.place_name || target.place_name, 160);
    await client.query(
      `UPDATE place_entities
       SET status = 'moved', superseded_by_id = $2, chain_key = COALESCE(chain_key, $3), updated_at = NOW()
       WHERE id = $1 AND user_id = $4`,
      [source.id, target.id, sharedChainKey, user.id]
    );
    await client.query(
      `UPDATE place_entities SET chain_key = COALESCE(chain_key, $2), updated_at = NOW()
       WHERE id = $1 AND user_id = $3`,
      [target.id, sharedChainKey, user.id]
    );
    await MatchDecision.recordObservedRule({
      userId: user.id,
      householdId: user.household_id,
      domain: 'place',
      decision: 'different',
      observedKey: `place-move:${source.id}:${target.id}`,
      targetEntityId: target.id,
      source: 'user_marked_moved',
      evidence: { relationship: 'moved_to', source_entity_id: source.id, target_entity_id: target.id },
      queryable: client,
    });
    await client.query('COMMIT');
    return { moved: true, source_entity_id: source.id, target_entity_id: target.id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  addAlias,
  getExpenseIdentityContext,
  mergeIdentities,
  markPlaceMoved,
  separateExpenseIdentity,
  updateIdentity,
};
