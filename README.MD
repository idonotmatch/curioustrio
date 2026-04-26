Curious Trio is currently pre-launch. We're building a service aimed at changing the way people approach product research and discover online. #curioustrio

## Local dev

The mobile app talks to the API server. For local simulator work, start both:

```bash
npm run dev:api
npm run dev:mobile
```

Expected local defaults:
- API: `http://127.0.0.1:3002`
- Gmail OAuth callback: `http://localhost:3002/gmail/callback`

Useful setup notes:
- Copy [api/.env.example](/Users/dangnguyen/curious-trio/api/.env.example) to `api/.env` and fill in secrets.
- Copy [mobile/.env.example](/Users/dangnguyen/curious-trio/mobile/.env.example) to `mobile/.env` if you want to pin a local API URL.
- If `EXPO_PUBLIC_API_URL` is unset, the mobile client will try local `3001` and `3002`.

## Stability checks

For the highest-risk app flows, we now have two fast checks in the API:

```bash
cd api
npm run test:stability
npm run check:schema
```

What they cover:
- `test:stability`
  - Gmail review routing
  - NL parsing
  - insight builder core behavior
- `check:schema`
  - confirms required Gmail review / budget columns exist
  - warns when optional best-effort tables are missing

Recommended use:
- before deploy
- right after running new DB migrations
- anytime Gmail review, expense editing, or budget-impact behavior changes

Notes:
- `test:stability` runs without the full integration DB setup.
- `check:schema` needs a live database connection for the target environment.
- GitHub Actions now runs the focused API stability suite automatically on API pushes and PRs via [api-stability.yml](/Users/dangnguyen/curious-trio/.github/workflows/api-stability.yml).

## Integration tests

The DB-backed route/model suites now live in their own lane:

```bash
cd api
npm test
npm run test:routes
npm run test:models
```

- `npm test` is the fast unit/default lane.
- `test:routes` and `test:models` require a local Postgres test database at `postgres://test:test@localhost:5432/expense_tracker_test`.

To start and prepare that database:

```bash
cd api
npm run test:db:setup
```

What that does:
- starts a local Docker Postgres container from [api/docker-compose.test-db.yml](/Users/dangnguyen/curious-trio/api/docker-compose.test-db.yml)
- recreates `expense_tracker_test`
- applies every SQL migration in [api/src/db/migrations](/Users/dangnguyen/curious-trio/api/src/db/migrations)

Useful follow-ups:

```bash
cd api
npm run test:db:prepare
npm run test:integration
npm run test:db:stop
```
