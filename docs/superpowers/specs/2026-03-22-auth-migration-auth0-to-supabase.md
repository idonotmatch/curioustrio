# Auth Migration: Auth0 → Supabase Auth

**Date:** 2026-03-22
**Status:** Approved for implementation

---

## Overview

Replace Auth0 with Supabase Auth across the Adlo mobile app and API. The goal is a native-feeling "Sign in with Google" and "Sign in with Apple" experience on iOS, using the Supabase project that already hosts the app's Postgres database.

---

## Background

- The Adlo Postgres database already lives on Supabase (`db.qybozqtugexupxqavtjj.supabase.co`)
- Auth0 fails in development builds due to callback URL misconfiguration, and is overpowered for a personal household app
- Google OAuth credentials already exist in the project
- The App Store requires Apple Sign-In whenever a third-party social login is offered

---

## Goals

1. Native iOS "Sign in with Google" account picker sheet
2. Native iOS "Sign in with Apple" sheet (Face ID)
3. Remove Auth0 dependency entirely from mobile and API
4. No disruption to existing user data or expense records
5. Session management handled by Supabase (tokens, refresh)

---

## Architecture

### Auth Flow (After)

```
User taps "Sign in with Google"
  → GoogleSignin.configure({ webClientId, iosClientId })
  → GoogleSignin.signIn() → { idToken }
  → supabase.auth.signInWithIdToken({ provider: 'google', token: idToken })
  → Supabase session issued (access_token + refresh_token)

User taps "Sign in with Apple"
  → AppleAuthentication.signInAsync({ requestedScopes: [FULL_NAME, EMAIL] })
  → { identityToken, email? }
  → supabase.auth.signInWithIdToken({ provider: 'apple', token: identityToken })
  → Supabase session issued

Both flows then:
  → _layout.js receives SIGNED_IN event via onAuthStateChange
  → calls POST /users/sync with name + email (if available) in body
  → API verifies JWT, upserts user record
  → redirects to /(tabs)/summary or /onboarding
```

This is the native `signInWithIdToken()` flow throughout. No browser redirects or OAuth web flows are involved.

### Token Usage in API Calls

`services/api.js` must obtain the Supabase `access_token` for each request. It should call `supabase.auth.getSession()` directly rather than reading from `SecureStore`. The existing `SecureStore`-based token fetch in `services/api.js` must be replaced.

---

## Components

### Mobile (`mobile/`)

**`package.json`**
- Remove: `react-native-auth0`
- Add: `@supabase/supabase-js`, `@react-native-google-signin/google-signin`, `expo-apple-authentication`

**`app.json`**
- Keep `"scheme": "adlo"` — this is the app deep-link scheme and must remain
- Do NOT remove any existing scheme entries; Auth0 added no scheme entries in the current config
- Add `"ios": { "usesAppleSignIn": true }` — adds the Sign In with Apple entitlement
- Add `"expo-apple-authentication"` to the `plugins` array — required for native module linking in EAS builds
- Add reversed iOS Google client ID to `ios.infoPlist.CFBundleURLTypes`:

```json
{
  "ios": {
    "usesAppleSignIn": true,
    "infoPlist": {
      "CFBundleURLTypes": [
        { "CFBundleURLSchemes": ["com.googleusercontent.apps.XXXXXX"] }
      ]
    }
  },
  "plugins": [
    "expo-router",
    "expo-apple-authentication"
  ]
}
```

Where `com.googleusercontent.apps.XXXXXX` is the **reversed iOS client ID** from Google Cloud Console.

**`lib/supabase.js`** (new file)

```js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);
```

**`lib/auth.js`** (new file)

```js
// signInWithGoogle()
//   GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, iosClientId: IOS_CLIENT_ID })
//   Note: webClientId = Web OAuth 2.0 client ID (not the iOS client ID)
//         iosClientId = iOS OAuth 2.0 client ID (separate credential in Google Cloud Console)
//   GoogleSignin.signIn() → idToken
//   supabase.auth.signInWithIdToken({ provider: 'google', token: idToken })
//   Returns session

// signInWithApple()
//   AppleAuthentication.signInAsync({ requestedScopes: [FULL_NAME, EMAIL] })
//   Returns { identityToken, email? }
//   Note: Apple only returns email on the very first sign-in per user/app pair
//   supabase.auth.signInWithIdToken({ provider: 'apple', token: identityToken })
//   Returns session (session.user.email may be null on subsequent sign-ins)

// signOut()
//   supabase.auth.signOut()
//   GoogleSignin.revokeAccess() + GoogleSignin.signOut() (if Google was used)
```

**`services/api.js`**
- Remove the `SecureStore`-based token fetch
- Replace with: `const { data: { session } } = await supabase.auth.getSession()` before each request
- Use `session?.access_token` as the bearer token

**`app/_layout.js`**
- Remove `Auth0Provider` wrapper and `useAuth0()` hook
- Add `supabase.auth.onAuthStateChange((event, session) => { ... })` in a `useEffect`
- On `SIGNED_IN` event with a valid session: run `checkHousehold()` sync logic
- On `SIGNED_OUT` event or null session: `router.replace('/login')`
- On failed refresh (Supabase emits `TOKEN_REFRESHED` failure or `SIGNED_OUT`): redirect to `/login`

**`app/login.js`**
- Replace `authorize()` call with `signInWithGoogle()` and `signInWithApple()` from `lib/auth.js`
- Two buttons: "Sign in with Google" and "Sign in with Apple"

**`eas.json`**
- Remove: `EXPO_PUBLIC_AUTH0_DOMAIN`, `EXPO_PUBLIC_AUTH0_CLIENT_ID`, `EXPO_PUBLIC_AUTH0_AUDIENCE`
- Add: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`

---

### API (`api/`)

**`src/middleware/auth.js`**

```js
const jwt = require('jsonwebtoken');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.slice(7);
  try {
    // SUPABASE_JWT_SECRET: raw HS256 secret from Supabase Dashboard → Settings → API → JWT Secret
    // Not the anon key, not the service role key.
    const decoded = jwt.verify(token, process.env.SUPABASE_JWT_SECRET, { algorithms: ['HS256'] });
    req.userId = decoded.sub; // Supabase user UUID
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
```

**`src/models/user.js`**
- Rename `auth0_id` column references → `provider_uid` in all queries
- Rename `findByAuth0Id(auth0Id)` → `findByProviderUid(uid)`
- Add `findByEmail(email)` method for the email-match upsert strategy

**`src/routes/users.js`** — all references to `req.auth0Id` and `User.findByAuth0Id()` updated

**`POST /users/sync` handler** — updated upsert strategy:

```
1. Read req.userId (Supabase UUID from JWT)
2. Read name, email from req.body
3. If email provided:
   a. findByEmail(email) → if found, update provider_uid = req.userId
   b. If not found, findByProviderUid(req.userId) → if found, update name/email
   c. If neither found, create new user
4. If email not provided (Apple re-auth case):
   a. findByProviderUid(req.userId) → if found, return existing user
   b. If not found, create new user (household association will be absent; user re-joins)
```

**`GET /users/me`** — update `req.auth0Id` → `req.userId`, `findByAuth0Id` → `findByProviderUid`

**All other route files** — replace `req.auth0Id` → `req.userId` and `User.findByAuth0Id()` → `User.findByProviderUid()`:
- `src/routes/households.js`
- `src/routes/expenses.js`
- `src/routes/budgets.js`
- `src/routes/push.js`
- `src/routes/gmail.js`
- `src/routes/categories.js`
- `src/routes/recurring.js`

**`.env`**
- Remove: `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`
- Add: `SUPABASE_JWT_SECRET`

---

### Database

```sql
ALTER TABLE users RENAME COLUMN auth0_id TO provider_uid;
```

One migration file. No data backfill required — existing values become `provider_uid` values and are overwritten on first sign-in via the email-match upsert.

---

## Supabase Dashboard Setup (Manual, Pre-Code)

Perform in this order before writing any code:

1. **Enable Authentication** — Project → Authentication → Enable
2. **Google provider** — Add existing `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`
3. **Apple provider** — Configure with Apple Developer Team ID, Service ID, Key ID, and private key
4. **Redirect URLs** — Add `adlo://` and `exp://` as precautionary entries (not required for native `signInWithIdToken()` flow but useful for future web flows)
5. **Copy credentials for use in local `.env` and `eas.json`**:
   - `SUPABASE_URL` — project URL
   - `SUPABASE_ANON_KEY` — public key, safe for mobile bundle
   - `SUPABASE_JWT_SECRET` — **private**, API only. Found at Settings → API → JWT Secret

---

## Data Migration

**Strategy: email-match upsert on `/users/sync`**

- Mobile sends `session.user.email` in the sync request body after sign-in
- API matches by email → updates `provider_uid` to new Supabase UUID → household preserved
- Apple caveat: Apple only returns email on the **first sign-in** per user/app pair. On subsequent sign-ins, `session.user.email` may be null. The `/users/sync` handler must handle the null-email case by falling back to a `provider_uid` lookup (see handler spec above).

---

## Environment Variables

### API `.env`
```
# Remove
AUTH0_DOMAIN=...
AUTH0_AUDIENCE=...

# Add
SUPABASE_JWT_SECRET=<from Supabase Dashboard → Settings → API → JWT Secret>
```

### Mobile `eas.json` production env
```json
"env": {
  "EXPO_PUBLIC_SUPABASE_URL": "https://qybozqtugexupxqavtjj.supabase.co",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY": "<anon key>"
}
```

### Mobile `.env.local`
```
EXPO_PUBLIC_SUPABASE_URL=https://qybozqtugexupxqavtjj.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

---

## Error Handling

| Scenario | Handling |
|---|---|
| Google sign-in cancelled | Catch `statusCodes.SIGN_IN_CANCELLED`, no error shown |
| Google sign-in failed | Show "Sign in failed, please try again" |
| Apple sign-in cancelled | Catch `ERR_CANCELED`, no error shown |
| Network error during token exchange | Show "Connection error, please try again" |
| Expired session | Supabase auto-refreshes; on `SIGNED_OUT` event after failed refresh, redirect to `/login` |
| Invalid/expired token on API | 401; mobile calls `signOut()` and redirects to `/login` |
| Apple sync with null email, no provider_uid match | Create new user; household must be re-joined (edge case for new Apple users only) |

---

## Testing Checklist

- [ ] Fresh install: login screen appears, Google sign-in completes, redirects to Summary
- [ ] Fresh install: Apple sign-in completes, redirects to Summary
- [ ] Existing user re-signs in via Google: email match preserves household association
- [ ] Session persists across app close/reopen
- [ ] Sign out clears session and returns to login screen
- [ ] API rejects requests with missing/invalid token (401)
- [ ] API accepts valid Supabase JWT
- [ ] `/users/sync` creates new user when no email match and no provider_uid match
- [ ] `/users/sync` updates `provider_uid` when email match found
- [ ] `/users/sync` returns existing user when only provider_uid matches (Apple re-auth)

---

## Out of Scope

- Guest / unauthenticated app experience (separate feature, parked)
- Email + password sign-in
- Push notification token re-registration (re-registers automatically on next sign-in)
