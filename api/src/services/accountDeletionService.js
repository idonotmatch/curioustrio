const db = require('../db');

async function deleteAccountDataForUser(userId) {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `SELECT id, household_id
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [userId]
    );
    const user = userResult.rows[0] || null;
    if (!user) {
      await client.query('ROLLBACK');
      return null;
    }

    const householdId = user.household_id || null;
    const expenseIdsResult = await client.query(
      `SELECT id
       FROM expenses
       WHERE user_id = $1`,
      [userId]
    );
    const expenseIds = expenseIdsResult.rows.map((row) => row.id);

    await client.query(
      `UPDATE duplicate_flags
       SET resolved_by = NULL
       WHERE resolved_by = $1`,
      [userId]
    );
    await client.query(
      `DELETE FROM household_invites
       WHERE invited_by = $1`,
      [userId]
    );
    await client.query(
      `DELETE FROM push_tokens
       WHERE user_id = $1`,
      [userId]
    );
    await client.query(
      `DELETE FROM gmail_sender_preferences
       WHERE user_id = $1`,
      [userId]
    );
    await client.query(
      `DELETE FROM gmail_oauth_states
       WHERE user_id = $1`,
      [userId]
    );
    await client.query(
      `DELETE FROM oauth_tokens
       WHERE user_id = $1`,
      [userId]
    );

    if (expenseIds.length > 0) {
      await client.query(
        `UPDATE expenses
         SET linked_expense_id = NULL
         WHERE linked_expense_id = ANY($1::uuid[])`,
        [expenseIds]
      );
      await client.query(
        `UPDATE recurring_expenses
         SET last_matched_expense_id = NULL
         WHERE last_matched_expense_id = ANY($1::uuid[])`,
        [expenseIds]
      );
      await client.query(
        `UPDATE email_import_log
         SET expense_id = NULL
         WHERE expense_id = ANY($1::uuid[])`,
        [expenseIds]
      );
      await client.query(
        `DELETE FROM duplicate_flags
         WHERE expense_id_a = ANY($1::uuid[])
            OR expense_id_b = ANY($1::uuid[])`,
        [expenseIds]
      );
    }

    await client.query(
      `DELETE FROM email_import_log
       WHERE user_id = $1`,
      [userId]
    );
    await client.query(
      `DELETE FROM recurring_expenses
       WHERE user_id = $1`,
      [userId]
    );
    await client.query(
      `DELETE FROM expenses
       WHERE user_id = $1`,
      [userId]
    );
    await client.query(
      `DELETE FROM users
       WHERE id = $1`,
      [userId]
    );

    if (householdId) {
      const remainingMembersResult = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM users
         WHERE household_id = $1`,
        [householdId]
      );
      const remainingMembers = remainingMembersResult.rows[0]?.count || 0;

      if (remainingMembers === 0) {
        await client.query(
          `DELETE FROM household_invites
           WHERE household_id = $1`,
          [householdId]
        );
        await client.query(
          `DELETE FROM budget_settings
           WHERE household_id = $1`,
          [householdId]
        );
        await client.query(
          `DELETE FROM merchant_mappings
           WHERE household_id = $1`,
          [householdId]
        );
        await client.query(
          `DELETE FROM recurring_expenses
           WHERE household_id = $1`,
          [householdId]
        );
        await client.query(
          `DELETE FROM categories
           WHERE household_id = $1`,
          [householdId]
        );
        await client.query(
          `DELETE FROM households
           WHERE id = $1`,
          [householdId]
        );
      }
    }

    await client.query('COMMIT');
    return {
      deleted: true,
      user_id: userId,
      household_id: householdId,
      expense_count: expenseIds.length,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  deleteAccountDataForUser,
};
