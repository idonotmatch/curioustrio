const express = require('express');
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const { pool } = require('../db');
const User = require('../models/user');
const Household = require('../models/household');
const HouseholdInvite = require('../models/householdInvite');
const { hashEmail } = require('../services/emailHmac');

const router = express.Router();

function rejectAnonymous(req, res) {
  if (req.isAnonymous) {
    res.status(403).json({ error: 'Create an account to join a household' });
    return true;
  }
  return false;
}

router.post('/', authenticate, async (req, res, next) => {
  try {
    if (rejectAnonymous(req, res)) return;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const user = await User.findByProviderUid(req.userId);
    if (user.household_id) {
      return res.status(409).json({ error: 'Already in a household' });
    }

    const household = await Household.create({ name, createdBy: user.id });
    await User.setHouseholdId(user.id, household.id);

    return res.status(201).json(household);
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user.household_id) {
      return res.status(404).json({ error: 'Not in a household' });
    }

    const household = await Household.findById(user.household_id);
    const members = await Household.findMembers(user.household_id);

    return res.status(200).json({ household, members });
  } catch (err) {
    next(err);
  }
});

router.patch('/me', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user?.household_id) return res.status(404).json({ error: 'Not in a household' });
    const { name, budget_start_day } = req.body;
    if (budget_start_day !== undefined) {
      const day = parseInt(budget_start_day, 10);
      if (isNaN(day) || day < 1 || day > 28) {
        return res.status(400).json({ error: 'budget_start_day must be between 1 and 28' });
      }
      const household = await Household.updateSettings(user.household_id, { budgetStartDay: day });
      return res.status(200).json(household);
    }
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
    const household = await Household.updateName(user.household_id, name.trim());
    return res.status(200).json(household);
  } catch (err) {
    next(err);
  }
});

router.post('/invites', authenticate, async (req, res, next) => {
  try {
    if (rejectAnonymous(req, res)) return;
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    const user = await User.findByProviderUid(req.userId);
    if (!user.household_id) {
      return res.status(403).json({ error: 'Must be in a household to invite' });
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await HouseholdInvite.create({
      householdId: user.household_id,
      invitedEmail: hashEmail(email),
      invitedBy: user.id,
      token,
      expiresAt,
    });

    return res.status(201).json({ token, expires_at: expiresAt });
  } catch (err) {
    next(err);
  }
});

router.post('/invites/:token/accept', authenticate, async (req, res, next) => {
  try {
    if (rejectAnonymous(req, res)) return;
    const invite = await HouseholdInvite.findByToken(req.params.token);
    if (!invite) return res.status(404).json({ error: 'Invite not found' });

    if (invite.status !== 'pending') {
      return res.status(410).json({ error: 'Invite already used or expired' });
    }

    if (new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Invite expired' });
    }

    const user = await User.findByProviderUid(req.userId);
    if (user.household_id) {
      return res.status(409).json({ error: 'Already in a household' });
    }

    // If the invite was targeted at a specific email, the joining user must have
    // a matching email. A user with no email (e.g. Apple Sign In without sharing
    // their email) cannot accept a targeted invite — otherwise any anonymous or
    // no-email account could claim any invite link.
    if (invite.invited_email_hash) {
      if (!user.email || invite.invited_email_hash !== hashEmail(user.email)) {
        return res.status(403).json({ error: 'This invite was sent to a different email address' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE users SET household_id = $1 WHERE id = $2',
        [invite.household_id, user.id]
      );
      await client.query(
        "UPDATE household_invites SET status = $1 WHERE token = $2 AND status = 'pending'",
        ['accepted', req.params.token]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return res.status(200).json({ household_id: invite.household_id });
  } catch (err) {
    next(err);
  }
});

// Leave current household (self-service)
router.post('/me/leave', authenticate, async (req, res, next) => {
  try {
    if (rejectAnonymous(req, res)) return;
    const user = await User.findByProviderUid(req.userId);
    if (!user?.household_id) {
      return res.status(400).json({ error: 'Not in a household' });
    }
    await User.setHouseholdId(user.id, null);
    return res.status(200).json({ household_id: null });
  } catch (err) {
    next(err);
  }
});

// Remove a member from the household (any member can remove others)
router.delete('/me/members/:userId', authenticate, async (req, res, next) => {
  try {
    if (rejectAnonymous(req, res)) return;
    const requester = await User.findByProviderUid(req.userId);
    if (!requester?.household_id) {
      return res.status(403).json({ error: 'Not in a household' });
    }
    // Prevent self-removal via this endpoint (use /me/leave instead)
    if (req.params.userId === requester.id) {
      return res.status(400).json({ error: 'Use POST /households/me/leave to leave' });
    }
    // Only the household creator can remove members
    const household = await Household.findById(requester.household_id);
    if (!household || household.created_by !== requester.id) {
      return res.status(403).json({ error: 'Only the household owner can remove members' });
    }

    // Verify target user is actually in the same household
    const target = await User.findById(req.params.userId);
    if (!target || target.household_id !== requester.household_id) {
      return res.status(404).json({ error: 'Member not found in your household' });
    }
    await User.setHouseholdId(target.id, null);
    return res.status(200).json({ household_id: null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
