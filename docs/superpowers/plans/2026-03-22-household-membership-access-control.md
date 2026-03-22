# Household Membership Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow household members to leave or be removed from a household, and enforce that removed users immediately lose access to household expenses.

**Architecture:** Membership is already stored as `household_id` on the `users` row — clearing it to `NULL` is sufficient to revoke access, because every household expense query gates on `user.household_id`. We add two new API endpoints (leave, remove-member) and surface leave/remove buttons in the mobile accounts screen. No schema migration required.

**Tech Stack:** Node.js/Express API, PostgreSQL (via `pg` pool), React Native (Expo Router)

---

## How Access Control Works Today

These are the checks that gate household data — clearing `user.household_id` makes ALL of them deny access automatically, no other changes needed:

- `GET /expenses/household` — returns personal expenses if `user.household_id` is null
- `GET /expenses/:id` — returns 404 if `!ownedByUser && !inHousehold`
- `DELETE /expenses/:id` — returns 404 if `!ownedByUser && !ownedByHousehold`
- `Household.findMembers(householdId)` — queries `WHERE household_id = $1`, removed user disappears automatically

A removed user's **own expenses** (created while in household) are still accessible via `GET /expenses` (queries by `user_id`) — this is correct, they created those.

---

## File Structure

| File | Change |
|------|--------|
| `api/src/routes/households.js` | Add `POST /me/leave` and `DELETE /me/members/:userId` |
| `api/src/models/user.js` | No change needed — `setHouseholdId(id, null)` already works |
| `mobile/app/accounts.js` | Add "Leave household" button + "Remove" button per member |

---

## Task 1: API — Leave and Remove-Member Endpoints

**Files:**
- Modify: `api/src/routes/households.js`

### Context

`api/src/routes/households.js` currently has:
- `POST /` — create household (blocks if already in one)
- `GET /me` — get household + members
- `PATCH /me` — rename household
- `POST /invites` — send invite
- `POST /invites/:token/accept` — join household

The `User.setHouseholdId(userId, householdId)` method in `api/src/models/user.js` accepts `null` as `householdId`, so it can be used as-is to clear membership.

There is no admin role concept — any member can remove others. This is intentional for the current scope.

### Steps

- [ ] **Step 1: Add `POST /me/leave` endpoint**

Add this route BEFORE `module.exports` in `api/src/routes/households.js`:

```js
// Leave current household (self-service)
router.post('/me/leave', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByAuth0Id(req.auth0Id);
    if (!user?.household_id) {
      return res.status(400).json({ error: 'Not in a household' });
    }
    await User.setHouseholdId(user.id, null);
    return res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Add `DELETE /me/members/:userId` endpoint**

Add this route directly after the leave route in `api/src/routes/households.js`:

```js
// Remove a member from the household (any member can remove others)
router.delete('/me/members/:userId', authenticate, async (req, res, next) => {
  try {
    const requester = await User.findByAuth0Id(req.auth0Id);
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
    return res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 3: Add `User.findById` to the user model**

The remove-member endpoint above uses `User.findById`. Add this to `api/src/models/user.js` (before `module.exports`):

```js
async function findById(id) {
  const result = await db.query(
    'SELECT id, auth0_id, name, email, household_id, created_at FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}
```

And add `findById` to the `module.exports`:
```js
module.exports = { findOrCreate, findByAuth0Id, findById, setHouseholdId };
```

- [ ] **Step 4: Manually test the leave endpoint**

Start the API server: `cd api && node src/index.js`

Test leave (replace TOKEN with a valid Auth0 JWT):
```bash
# Should return { ok: true } and clear household_id
curl -X POST http://localhost:3002/households/me/leave \
  -H "Authorization: Bearer TOKEN"

# Verify household_id is cleared
curl http://localhost:3002/households/me \
  -H "Authorization: Bearer TOKEN"
# Expected: 404 { "error": "Not in a household" }
```

- [ ] **Step 5: Manually test remove-member endpoint**

```bash
# Get current household members to find a userId
curl http://localhost:3002/households/me \
  -H "Authorization: Bearer TOKEN"

# Remove a member (replace USER_ID with actual UUID)
curl -X DELETE http://localhost:3002/households/me/members/USER_ID \
  -H "Authorization: Bearer TOKEN"
# Expected: { ok: true }

# Verify member no longer appears
curl http://localhost:3002/households/me \
  -H "Authorization: Bearer TOKEN"
# Expected: members array no longer contains removed user
```

Test error cases:
```bash
# Try removing self via this endpoint
curl -X DELETE http://localhost:3002/households/me/members/YOUR_OWN_USER_ID \
  -H "Authorization: Bearer TOKEN"
# Expected: 400 { "error": "Use POST /households/me/leave to leave" }

# Try removing a user from a different household (or nonexistent)
curl -X DELETE http://localhost:3002/households/me/members/00000000-0000-0000-0000-000000000000 \
  -H "Authorization: Bearer TOKEN"
# Expected: 404 { "error": "Member not found in your household" }

# Try removing a member when you are not in any household (use a token for a user with household_id = NULL)
curl -X DELETE http://localhost:3002/households/me/members/SOME_USER_ID \
  -H "Authorization: Bearer NON_MEMBER_TOKEN"
# Expected: 403 { "error": "Not in a household" }
```

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/households.js api/src/models/user.js
git commit -m "feat: add leave household and remove member endpoints"
```

---

## Task 2: Mobile — Leave Button and Remove Member UI

**Files:**
- Modify: `mobile/app/accounts.js`

### Context

`accounts.js` renders a members list at line 185:
```js
{(householdData.members || []).map(m => (
  <View key={m.id} style={styles.memberRow}>
    <Text style={styles.memberName}>{m.name || m.email}</Text>
    {m.email ? <Text style={styles.memberEmail}>{m.email}</Text> : null}
  </View>
))}
```

The `api` service is already imported. We need:
1. A "Remove" button next to each member that isn't the current user
2. A "Leave household" button below the members section
3. Both should call the new endpoints, then reload the household data

The current user's own `id` is not available directly in `accounts.js`. We need to fetch it. The `/users/sync` endpoint or a `GET /users/me` endpoint gives us the current user. Check if such an endpoint exists — if not, we can get the user ID from `GET /households/me` since members include `id`.

The current user's ID can be identified by comparing to the members list: the member whose email matches `useAuth0().user.email` is the current user. Alternatively, we can add a `currentUserId` state loaded separately.

The simplest approach: load `GET /users/me` on mount (if it exists) OR identify the current user from the Auth0 user object's email matched against the members list.

Looking at the mobile API service — check `mobile/services/api.js` for a `/users/me` endpoint. If none exists, use Auth0's `user.email` to match against `householdData.members`.

### Steps

- [ ] **Step 1: Add current user identification**

At the top of `AccountsScreen`, add `user: auth0User` to the existing `useAuth0` destructure:

```js
const { clearSession, user: auth0User } = useAuth0();
```

Then compute `currentUserId` from the members list — add this just before the `return` statement:

```js
const currentMember = (householdData?.members || []).find(
  m => m.email === auth0User?.email
);
const currentUserId = currentMember?.id;
```

**Note:** This email-match approach can fail if `auth0User` hasn't loaded yet or if the stored email diverged from Auth0. When `currentUserId` is `undefined`, the "Remove" button will appear next to all members including the current user. This is acceptable because the API blocks self-removal with a 400 — the user sees a friendly error message (handled in Step 2). A future improvement could use a dedicated `GET /users/me` endpoint instead.

- [ ] **Step 2: Add state variables and `removeMember`/`leaveHousehold` functions**

Add two state variables near the top of `AccountsScreen` alongside the other state declarations:

```js
const [removingMemberId, setRemovingMemberId] = useState(null);
const [leavingHousehold, setLeavingHousehold] = useState(false);
```

Add these functions alongside the existing `sendInvite` function:

```js
async function removeMember(memberId) {
  Alert.alert(
    'Remove member',
    'This person will lose access to household expenses.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (removingMemberId) return; // prevent double-tap
          setRemovingMemberId(memberId);
          try {
            await api.delete(`/households/me/members/${memberId}`);
            loadHousehold();
          } catch (e) {
            Alert.alert('Could not remove member', e.message || 'Please try again.');
          } finally {
            setRemovingMemberId(null);
          }
        },
      },
    ]
  );
}

async function leaveHousehold() {
  Alert.alert(
    'Leave household',
    'You will lose access to shared expenses. Your own expenses are not affected.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          if (leavingHousehold) return; // prevent double-tap
          setLeavingHousehold(true);
          try {
            await api.post('/households/me/leave', {});
            loadHousehold();
          } catch (e) {
            Alert.alert('Could not leave household', e.message || 'Please try again.');
          } finally {
            setLeavingHousehold(false);
          }
        },
      },
    ]
  );
}
```

- [ ] **Step 3: Update the members list to show Remove buttons**

Replace the existing members map (around line 185) with:

```js
{(householdData.members || []).map(m => (
  <View key={m.id} style={styles.memberRow}>
    <View style={styles.memberInfo}>
      <Text style={styles.memberName}>{m.name || m.email}</Text>
      {m.email ? <Text style={styles.memberEmail}>{m.email}</Text> : null}
    </View>
    {m.id !== currentUserId && (
      <TouchableOpacity
        onPress={() => removeMember(m.id)}
        disabled={removingMemberId === m.id}
        style={{ paddingVertical: 8, paddingHorizontal: 4 }}
      >
        {removingMemberId === m.id
          ? <ActivityIndicator size="small" color="#ef4444" />
          : <Text style={styles.removeText}>Remove</Text>}
      </TouchableOpacity>
    )}
  </View>
))}
```

- [ ] **Step 4: Add "Leave household" button below the invite section**

After the invite `inputRow` View (closing tag around line 211), add:

```js
<TouchableOpacity
  style={[styles.leaveBtn, leavingHousehold && { opacity: 0.5 }]}
  onPress={leaveHousehold}
  disabled={leavingHousehold}
>
  {leavingHousehold
    ? <ActivityIndicator color="#ef4444" size="small" />
    : <Text style={styles.leaveBtnText}>Leave household</Text>}
</TouchableOpacity>
```

- [ ] **Step 5: Add new styles**

Add to the `StyleSheet.create({...})` at the bottom of `accounts.js`:

```js
memberInfo: { flex: 1 },
removeText: { color: '#ef4444', fontSize: 14 },
leaveBtn: { marginTop: 24, paddingVertical: 12, alignItems: 'center' },
leaveBtnText: { color: '#ef4444', fontSize: 14 },
```

Also update the existing `memberRow` style to support the new layout (needs `alignItems: 'center'` for the remove button):
```js
memberRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#111' },
```

(This is likely already set, just verify it has `justifyContent: 'space-between'`.)

- [ ] **Step 6: Verify the full flow manually**

1. Open the app, go to Settings → Accounts
2. Confirm household members are listed
3. Confirm "Remove" button appears next to other members (not yourself)
4. Confirm "Leave household" button appears below the invite section
5. Tap "Remove" on a member → confirm alert appears → confirm removal → member disappears from list
6. As the removed user: verify `GET /expenses/household` now returns only their own expenses
7. Tap "Leave household" as yourself → confirm alert → household section resets to "not in a household" state

- [ ] **Step 7: Commit**

```bash
git add mobile/app/accounts.js
git commit -m "feat: add leave household and remove member UI"
```

---

## Verification Checklist

After both tasks are complete, verify these access control scenarios:

| Scenario | Expected behavior |
|----------|-------------------|
| Active member calls `GET /expenses/household` | Returns all non-private household expenses ✓ |
| Removed user calls `GET /expenses/household` | Returns only their own personal expenses (fallback) ✓ |
| Removed user calls `GET /expenses/:id` on someone else's expense | 404 ✓ |
| Removed user calls `DELETE /expenses/:id` on someone else's expense | 404 ✓ |
| Removed user's own expenses | Still accessible via `GET /expenses` ✓ |
| Removed user in active members list | No longer appears ✓ |
| Removed user can create new household | Yes (household_id is null again) ✓ |
