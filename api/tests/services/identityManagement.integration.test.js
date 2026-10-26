const db = require('../../src/db');
const Expense = require('../../src/models/expense');
const MatchDecision = require('../../src/models/matchDecision');
const { resolveExpenseIdentities } = require('../../src/services/entityResolutionService');
const {
  addAlias,
  getExpenseIdentityContext,
  markPlaceMoved,
  mergeIdentities,
  separateExpenseIdentity,
  updateIdentity,
} = require('../../src/services/identityManagementService');

describe('identity management integration', () => {
  let householdId;
  let user;
  let householdMember;
  let first;
  let second;
  let firstContext;

  beforeAll(async () => {
    householdId = (await db.query("INSERT INTO households (name) VALUES ('Identity controls test') RETURNING id")).rows[0].id;
    user = (await db.query(
      `INSERT INTO users (provider_uid, name, email, household_id)
       VALUES ('identity-controls-test', 'Identity Tester', 'identity-controls@test.invalid', $1)
       RETURNING *`,
      [householdId]
    )).rows[0];
    first = await Expense.create({
      userId: user.id,
      householdId,
      merchant: 'Amazon.com',
      amount: 24.5,
      date: '2026-10-20',
      source: 'manual',
      status: 'confirmed',
      paymentMethod: 'credit',
      cardLast4: '4242',
      cardLabel: 'Visa receipt label',
      placeName: 'Amazon Pickup',
      address: '100 First St',
      mapkitStableId: '40.1000,-73.1000',
      locationProviderId: 'apple-place-one',
      locationSource: 'mapkit',
    });
    await resolveExpenseIdentities({ expense: first, userId: user.id, householdId });
    firstContext = await getExpenseIdentityContext({ user, expenseId: first.id });
  });

  afterAll(async () => {
    if (user?.id) {
      await db.query('DELETE FROM expenses WHERE user_id = $1', [user.id]);
      if (householdMember?.id) await db.query('DELETE FROM users WHERE id = $1', [householdMember.id]);
      await db.query('DELETE FROM users WHERE id = $1', [user.id]);
    }
    if (householdId) await db.query('DELETE FROM households WHERE id = $1', [householdId]);
    await db.pool.end();
  });

  it('learns a merchant alias and reuses stable merchant, card, and place identities', async () => {
    await addAlias({
      user,
      domain: 'merchant',
      entityId: firstContext.merchant_identity.id,
      alias: 'AMZN Mktp',
    });
    second = await Expense.create({
      userId: user.id,
      householdId,
      merchant: 'AMZN Mktp',
      amount: 19.25,
      date: '2026-10-21',
      source: 'email',
      status: 'confirmed',
      paymentMethod: 'credit',
      cardLast4: '4242',
      cardLabel: 'Visa',
      placeName: 'Amazon Pickup Counter',
      address: '100 First Street',
      mapkitStableId: '40.1000,-73.1000',
      locationProviderId: 'apple-place-one',
      locationSource: 'mapkit',
    });
    await resolveExpenseIdentities({ expense: second, userId: user.id, householdId });
    const context = await getExpenseIdentityContext({ user, expenseId: second.id });
    expect(context.merchant_identity.id).toBe(firstContext.merchant_identity.id);
    expect(context.payment_identity.id).toBe(firstContext.payment_identity.id);
    expect(context.place_identity.id).toBe(firstContext.place_identity.id);
  });

  it('does not expose another household member personal card or place identity metadata', async () => {
    householdMember = (await db.query(
      `INSERT INTO users (provider_uid, name, email, household_id)
       VALUES ('identity-controls-household-member', 'Household Member', 'identity-member@test.invalid', $1)
       RETURNING *`,
      [householdId]
    )).rows[0];
    const context = await getExpenseIdentityContext({ user: householdMember, expenseId: first.id });
    expect(context.merchant_identity.id).toBe(firstContext.merchant_identity.id);
    expect(context.payment_identity).toBeNull();
    expect(context.place_identity).toBeNull();
    expect(context.payment_aliases).toEqual([]);
    expect(context.place_aliases).toEqual([]);
    await db.query('DELETE FROM users WHERE id = $1', [householdMember.id]);
    householdMember = null;
  });

  it('renames a stable payment entity without rewriting raw historical expense values', async () => {
    await updateIdentity({
      user,
      domain: 'payment',
      entityId: firstContext.payment_identity.id,
      patch: { display_label: 'Travel Visa', card_last4: '4242', issuer: 'Chase', network: 'Visa' },
    });
    const raw = (await db.query('SELECT card_label FROM expenses WHERE id = $1', [first.id])).rows[0];
    const context = await getExpenseIdentityContext({ user, expenseId: first.id });
    expect(raw.card_label).toBe('Visa receipt label');
    expect(context.payment_identity).toMatchObject({ display_label: 'Travel Visa', issuer: 'Chase', network: 'Visa' });
  });

  it('does not guess when a label-only card observation matches multiple instruments', async () => {
    const otherCard = await Expense.create({
      userId: user.id,
      householdId,
      merchant: 'Card test merchant',
      amount: 7,
      date: '2026-10-21',
      source: 'manual',
      status: 'confirmed',
      paymentMethod: 'credit',
      cardLast4: '1111',
      cardLabel: 'Visa',
    });
    await resolveExpenseIdentities({ expense: otherCard, userId: user.id, householdId });
    const otherContext = await getExpenseIdentityContext({ user, expenseId: otherCard.id });

    const labelOnly = await Expense.create({
      userId: user.id,
      householdId,
      merchant: 'Label-only card test',
      amount: 8,
      date: '2026-10-21',
      source: 'email',
      status: 'confirmed',
      paymentMethod: 'credit',
      cardLabel: 'Visa',
    });
    await resolveExpenseIdentities({ expense: labelOnly, userId: user.id, householdId });
    const labelOnlyContext = await getExpenseIdentityContext({ user, expenseId: labelOnly.id });

    expect(labelOnlyContext.payment_identity.id).not.toBe(firstContext.payment_identity.id);
    expect(labelOnlyContext.payment_identity.id).not.toBe(otherContext.payment_identity.id);
    expect(labelOnlyContext.payment_identity.card_last4).toBeNull();
  });

  it('merges aliases, expenses, evidence, and overrides onto one identity', async () => {
    const variant = await Expense.create({
      userId: user.id,
      householdId,
      merchant: 'Amazon Marketplace LLC',
      amount: 9.75,
      date: '2026-10-21',
      source: 'manual',
      status: 'confirmed',
    });
    await resolveExpenseIdentities({ expense: variant, userId: user.id, householdId });
    const before = await getExpenseIdentityContext({ user, expenseId: variant.id });
    expect(before.merchant_identity.id).not.toBe(firstContext.merchant_identity.id);
    await mergeIdentities({
      user,
      domain: 'merchant',
      sourceEntityId: before.merchant_identity.id,
      targetEntityId: firstContext.merchant_identity.id,
    });
    const after = await getExpenseIdentityContext({ user, expenseId: variant.id });
    expect(after.merchant_identity.id).toBe(firstContext.merchant_identity.id);
    expect(after.merchant_aliases.map((entry) => entry.alias_name)).toContain('Amazon Marketplace LLC');
  });

  it('keeps a user-separated merchant identity stable across later resolution', async () => {
    const result = await separateExpenseIdentity({ user, expenseId: second.id, domain: 'merchant' });
    await resolveExpenseIdentities({ expense: await Expense.findById(second.id), userId: user.id, householdId });
    const context = await getExpenseIdentityContext({ user, expenseId: second.id });
    expect(context.merchant_identity.id).toBe(result.entity_id);
    expect(context.merchant_identity.id).not.toBe(firstContext.merchant_identity.id);
  });

  it('persists a negative transaction decision for future duplicate checks', async () => {
    await MatchDecision.recordExpensePair({
      userId: user.id,
      householdId,
      decision: 'different',
      expenseIdA: first.id,
      expenseIdB: second.id,
    });
    await expect(MatchDecision.isExpensePairDifferent({ userId: user.id, expenseIdA: second.id, expenseIdB: first.id })).resolves.toBe(true);
  });

  it('models a moved place without rewriting its historical expenses', async () => {
    const replacement = await Expense.create({
      userId: user.id,
      householdId,
      merchant: 'Amazon.com',
      amount: 11,
      date: '2026-10-22',
      source: 'manual',
      status: 'confirmed',
      placeName: 'Amazon Pickup New',
      address: '200 Second St',
      mapkitStableId: '40.2000,-73.2000',
      locationProviderId: 'apple-place-two',
      locationSource: 'mapkit',
    });
    await resolveExpenseIdentities({ expense: replacement, userId: user.id, householdId });
    const replacementContext = await getExpenseIdentityContext({ user, expenseId: replacement.id });
    await markPlaceMoved({
      user,
      sourceEntityId: firstContext.place_identity.id,
      targetEntityId: replacementContext.place_identity.id,
    });
    await markPlaceMoved({
      user,
      sourceEntityId: firstContext.place_identity.id,
      targetEntityId: replacementContext.place_identity.id,
    });
    const oldPlace = (await db.query('SELECT status, superseded_by_id FROM place_entities WHERE id = $1', [firstContext.place_identity.id])).rows[0];
    const originalExpense = (await db.query('SELECT place_entity_id FROM expenses WHERE id = $1', [first.id])).rows[0];
    const learnedMoves = (await db.query(
      `SELECT COUNT(*)::int AS count FROM match_decisions
       WHERE user_id = $1 AND domain = 'place' AND observed_key = $2`,
      [user.id, `place-move:${firstContext.place_identity.id}:${replacementContext.place_identity.id}`]
    )).rows[0];
    expect(oldPlace).toMatchObject({ status: 'moved', superseded_by_id: replacementContext.place_identity.id });
    expect(originalExpense.place_entity_id).toBe(firstContext.place_identity.id);
    expect(learnedMoves.count).toBe(1);
  });
});
