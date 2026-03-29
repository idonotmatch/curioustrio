const express = require('express');
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const { pool } = require('../db');
const User = require('../models/user');
const Household = require('../models/household');
const HouseholdInvite = require('../models/householdInvite');

const router = express.Router();

router.post('/', authenticate, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const user = await User.findByProviderUid(req.userId);
    if (user.household_id) {
      return res.status(409).json({ error: 'Already in a household' });
    }

    const household = await Household.create({ name });
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
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
    const user = await User.findByProviderUid(req.userId);
    if (!user?.household_id) return res.status(404).json({ error: 'Not in a household' });
    const household = await Household.updateName(user.household_id, name.trim());
    return res.status(200).json(household);
  } catch (err) {
    next(err);
  }
});

router.post('/invites', authenticate, async (req, res, next) => {
  try {
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
      invitedEmail: email,
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

    if (invite.invited_email && user.email &&
        invite.invited_email.toLowerCase() !== user.email.toLowerCase()) {
      return res.status(403).json({ error: 'This invite was sent to a different email address' });
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
    const requester = await User.findByProviderUid(req.userId);
    if (!requester?.household_id) {
      return res.status(403).json({ error: 'Not in a household' });
    }
    // Prevent self-removal via this endpoint (use /me/leave instead)
    if (req.params.userId === requester.id) {
      return res.status(400).json({ error: 'Use POST /households/me/leave to leave' });
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
