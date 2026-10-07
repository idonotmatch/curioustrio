# Adlo Launch Release Gates

This is the release checklist for broader distribution. A release is ready only when every blocking gate is checked against the same production build.

## Automated Gates

- [ ] API full suite passes: `npm --prefix api test`
- [ ] API launch suite passes: `npm --prefix api run test:launch`
- [ ] Production API dependency audit has no high or critical findings: `npm --prefix api audit --omit=dev --audit-level=high`
- [ ] Mobile regression suite passes: `npm --prefix mobile test`
- [ ] iOS production export succeeds
- [ ] Render `/ready` reports the intended release commit and database readiness
- [ ] GitHub Actions API Stability and Mobile Release Checks are green on the release commit

## Production Configuration

Render must contain:

- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` for complete in-app account deletion; never expose this value to Expo or a client
- [ ] `SENTRY_DSN`
- [ ] `CRON_ALERT_WEBHOOK_URL`
- [ ] Existing AI, Gmail, MapKit, database, encryption, hashing, auth, and cron variables pass startup validation

The EAS `production` environment must contain:

- [ ] `EXPO_PUBLIC_SENTRY_DSN`
- [ ] `SENTRY_ORG`
- [ ] `SENTRY_PROJECT`
- [ ] `SENTRY_AUTH_TOKEN` with sensitive visibility for source-map upload
- [ ] Existing API, Supabase, and Google client variables

GitHub Actions must contain:

- [ ] `CRON_SECRET`, matching Render
- [ ] Gmail Sync, Insight Push, and Data Retention scheduled workflows are enabled
- [ ] A failed scheduled workflow reaches an actively monitored notification channel

## Production Job Proof

- [ ] Manually dispatch Gmail Sync and confirm `ok: true`
- [ ] Manually dispatch Insight Push and confirm `ok: true`
- [ ] Manually dispatch Data Retention and confirm a successful response
- [ ] Force one safe test failure and confirm the webhook/Sentry alert arrives without financial or email content
- [ ] Confirm Gmail's last successful run remains under one hour old for a connected test account

## Real-Device Acceptance

Run on the final TestFlight build with a fresh account and an established account.

- [ ] Email/password, Apple, and Google sign-in reach the correct first screen
- [ ] Password recovery returns to the app and completes
- [ ] Manual entry saves, edits, and deletes without requiring a second tap or hard close
- [ ] Receipt camera and photo-library imports parse, review, and save
- [ ] Gmail connects, imports, shows failures, retries, and disconnects
- [ ] Approve, reject, skipped-import recovery, and bulk-review behavior stay consistent across Summary, Activity, Queue, and Detail
- [ ] Duplicate review, merge, and merge undo preserve the intended fields
- [ ] Private expenses never appear to another household member
- [ ] Shared edits refresh on a second active device without manual refresh
- [ ] Maps search and saved-place rendering work on cellular and Wi-Fi
- [ ] Insight cards open the correct evidence and action destination
- [ ] Notification taps open the intended expense or insight
- [ ] Offline, timeout, rate-limit, expired Gmail authorization, and server-error states recover without data loss
- [ ] Delete account removes app data and prevents the deleted Supabase identity from signing in again

## App Store and Trust

- [ ] Legal operator/entity and support contact are final
- [ ] Home, privacy, terms, and support URLs are public and match the App Store listing
- [ ] App Privacy answers match actual email, financial, diagnostics, location, and identifier handling
- [ ] App Review notes explain Gmail, receipt scanning, location, household visibility, and account deletion
- [ ] Reviewer credentials and a reviewable data path are available
- [ ] Permission descriptions and screenshots match the submitted build
- [ ] The final native build is submitted only after all gates above pass

## Non-Blocking Until After Launch

- External price-source expansion
- Trend intelligence expansion
- Category model redesign
- Web dashboard and bank/card integrations
- Broader UI polish beyond the core review, detail, insight, and recovery flows
