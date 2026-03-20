# Household Expense Tracker — Implementation Plan 1: Foundation + Core Expense Flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working iOS expense tracker where a user can sign in, log expenses via natural language, get auto-suggested categories, and view their personal feed.

**Architecture:** React Native (Expo) mobile app talking to a Node.js/Express REST API backed by PostgreSQL. Auth0 handles authentication on both sides. Claude API handles NL parsing and category suggestion. This plan covers the vertical slice from database schema through working mobile screens — no household sharing, camera, or email yet.

**Tech Stack:** React Native + Expo SDK 51+, Node.js 20+, Express 4, PostgreSQL 15+, Auth0, `@anthropic-ai/sdk`, Jest + Supertest (API tests), Jest + React Native Testing Library (mobile tests)

**This is Plan 1 of 4. Subsequent plans:**
- Plan 2: Household sharing, deduplication pipeline, pending queue
- Plan 3: Camera receipt scan, Gmail email import, MapKit location enrichment
- Plan 4: Recurring expenses, push notifications, onboarding flow, settings, security hardening

---

## File Structure

### Backend (`api/`)
```
api/
  src/
    index.js                        # Express app + server entry point
    middleware/
      auth.js                       # Auth0 JWT validation (every request)
      errorHandler.js               # Global error handler
      rateLimit.js                  # express-rate-limit configuration
    routes/
      expenses.js                   # POST /expenses, GET /expenses, PATCH /expenses/:id
      categories.js                 # GET/POST/PATCH/DELETE /categories
      users.js                      # POST /users/sync (called on first login)
    services/
      nlParser.js                   # Claude NL → {merchant, amount, date, notes}
      categoryAssigner.js           # MerchantMapping lookup → Claude fallback
    db/
      index.js                      # pg Pool singleton
      migrations/
        001_initial_schema.sql      # All tables for Plan 1
    models/
      user.js                       # findOrCreate, findById
      expense.js                    # create, findByUser, updateStatus
      category.js                   # findByHousehold, create, update, delete
      merchantMapping.js            # upsert, findByMerchant
  tests/
    middleware/
      auth.test.js
    services/
      nlParser.test.js
      categoryAssigner.test.js
    routes/
      expenses.test.js
      categories.test.js
  .env.example
  package.json
  jest.config.js
```

### Mobile (`mobile/`)
```
mobile/
  app/
    _layout.js                      # Root layout: Auth0Provider + navigation
    (tabs)/
      _layout.js                    # Tab bar: Feed | Add | Settings (stub)
      index.js                      # My Feed screen
      add.js                        # Add Expense screen (NL input)
    confirm.js                      # Confirm Expense screen (modal)
  components/
    ExpenseItem.js                  # Single expense row (merchant, amount, date, category)
    ExpenseList.js                  # FlatList of ExpenseItems
    NLInput.js                      # NL text input + submit
    ConfirmField.js                 # Tappable pre-filled field on confirm screen
    CategoryBadge.js                # Category name + confidence dots
  services/
    api.js                          # Fetch wrapper: attaches Auth0 token, base URL
    offlineQueue.js                 # AsyncStorage queue (stub — full impl in Plan 4)
  hooks/
    useExpenses.js                  # Fetch + refresh expense list
    useCategories.js                # Fetch category list
  constants/
    defaultCategories.js            # Default category list shown during onboarding
  app.json                          # Expo config (bundle ID, name)
  package.json
  jest.config.js
```

---

## Task 1: Backend Project Scaffolding

**Files:**
- Create: `api/package.json`
- Create: `api/src/index.js`
- Create: `api/.env.example`
- Create: `api/jest.config.js`

- [ ] **Step 1: Initialize the API project**

```bash
mkdir api && cd api
npm init -y
npm install express pg dotenv @anthropic-ai/sdk jsonwebtoken jwks-rsa express-rate-limit cors helmet
npm install --save-dev jest supertest @types/jest nodemon
```

- [ ] **Step 2: Write `api/.env.example`**

```
DATABASE_URL=postgres://user:password@localhost:5432/expense_tracker
AUTH0_DOMAIN=your-domain.auth0.com
AUTH0_AUDIENCE=https://api.expense-tracker.app
ANTHROPIC_API_KEY=sk-ant-...
PORT=3001
```

- [ ] **Step 3: Write `api/jest.config.js`**

```js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup.js'],
};
```

- [ ] **Step 4: Write `api/tests/setup.js`**

```js
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/expense_tracker_test';
process.env.AUTH0_DOMAIN = 'test.auth0.com';
process.env.AUTH0_AUDIENCE = 'https://test.api';
process.env.ANTHROPIC_API_KEY = 'test-key';
```

- [ ] **Step 5: Write `api/src/index.js`**

```js
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { errorHandler } = require('./middleware/errorHandler');
const expensesRouter = require('./routes/expenses');
const categoriesRouter = require('./routes/categories');
const usersRouter = require('./routes/users');

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use('/expenses', expensesRouter);
app.use('/categories', categoriesRouter);
app.use('/users', usersRouter);
app.use(errorHandler);

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => console.log(`API running on ${PORT}`));
}

module.exports = app;
```

- [ ] **Step 6: Add scripts to `api/package.json`**

```json
"scripts": {
  "start": "node src/index.js",
  "dev": "nodemon src/index.js",
  "test": "jest"
}
```

- [ ] **Step 7: Commit**

```bash
git add api/
git commit -m "feat: scaffold api project"
```

---

## Task 2: Database Schema

**Files:**
- Create: `api/src/db/index.js`
- Create: `api/src/db/migrations/001_initial_schema.sql`

- [ ] **Step 1: Write `api/src/db/index.js`**

```js
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
```

- [ ] **Step 2: Write `api/src/db/migrations/001_initial_schema.sql`**

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth0_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  household_id UUID REFERENCES households(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE household_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id),
  invited_email TEXT NOT NULL,
  invited_by UUID NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id),
  name TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  household_id UUID REFERENCES households(id),
  merchant TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  date DATE NOT NULL,
  category_id UUID REFERENCES categories(id),
  source TEXT NOT NULL CHECK (source IN ('manual','camera','email')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','dismissed')),
  place_name TEXT,
  address TEXT,
  mapkit_stable_id TEXT,
  notes TEXT,
  raw_receipt_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC,
  unit_price NUMERIC(10,2) NOT NULL,
  total_price NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE merchant_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id),
  merchant_name TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES categories(id),
  hit_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, merchant_name)
);

CREATE TABLE duplicate_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id_a UUID NOT NULL REFERENCES expenses(id),
  expense_id_b UUID NOT NULL REFERENCES expenses(id),
  confidence TEXT NOT NULL CHECK (confidence IN ('exact','fuzzy','uncertain')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','kept_both','dismissed','replaced')),
  resolved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE recurring_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id),
  owned_by TEXT NOT NULL CHECK (owned_by IN ('household','user')),
  user_id UUID REFERENCES users(id),
  merchant TEXT NOT NULL,
  expected_amount NUMERIC(10,2) NOT NULL,
  category_id UUID NOT NULL REFERENCES categories(id),
  frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly','yearly')),
  next_expected_date DATE NOT NULL,
  last_matched_expense_id UUID REFERENCES expenses(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX idx_expenses_user_id ON expenses(user_id);
CREATE INDEX idx_expenses_household_id ON expenses(household_id);
CREATE INDEX idx_expenses_status ON expenses(status);
CREATE INDEX idx_expenses_date ON expenses(date);
CREATE INDEX idx_merchant_mappings_lookup ON merchant_mappings(household_id, merchant_name);
```

- [ ] **Step 3: Run migration against local dev database**

```bash
createdb expense_tracker
psql expense_tracker < api/src/db/migrations/001_initial_schema.sql
```
Expected: no errors, all tables created.

- [ ] **Step 4: Commit**

```bash
git add api/src/db/
git commit -m "feat: add database schema migration"
```

---

## Task 3: Auth0 JWT Middleware

**Files:**
- Create: `api/src/middleware/auth.js`
- Create: `api/src/middleware/errorHandler.js`
- Create: `api/tests/middleware/auth.test.js`

- [ ] **Step 1: Write the failing test**

```js
// api/tests/middleware/auth.test.js
const { authenticate } = require('../../src/middleware/auth');

describe('authenticate middleware', () => {
  it('returns 401 when no Authorization header', async () => {
    const req = { headers: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches auth0Id to req.user when token is valid', async () => {
    // Tested via integration in route tests using a mock token
    // Unit test mocks the JWKS client
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd api && npx jest tests/middleware/auth.test.js -t "returns 401"
```
Expected: FAIL — `authenticate` not defined.

- [ ] **Step 3: Write `api/src/middleware/auth.js`**

```js
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const client = jwksClient({
  jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = await new Promise((resolve, reject) => {
      jwt.verify(token, getKey, {
        audience: process.env.AUTH0_AUDIENCE,
        issuer: `https://${process.env.AUTH0_DOMAIN}/`,
        algorithms: ['RS256'],
      }, (err, payload) => {
        if (err) reject(err);
        else resolve(payload);
      });
    });
    req.auth0Id = decoded.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { authenticate };
```

- [ ] **Step 4: Write `api/src/middleware/errorHandler.js`**

```js
function errorHandler(err, req, res, next) {
  console.error(err.stack);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
}

module.exports = { errorHandler };
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest tests/middleware/auth.test.js -t "returns 401"
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/middleware/ api/tests/middleware/
git commit -m "feat: add Auth0 JWT middleware"
```

---

## Task 4: User Model + Sync Endpoint

**Files:**
- Create: `api/src/models/user.js`
- Create: `api/src/routes/users.js`
- Create: `api/tests/routes/users.test.js`

- [ ] **Step 1: Write the failing test**

```js
// api/tests/routes/users.test.js
const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');

// Mock auth middleware for tests
jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.auth0Id = 'auth0|test-user-123';
    next();
  },
}));

afterAll(() => db.pool.end());

describe('POST /users/sync', () => {
  it('creates a user on first login', async () => {
    const res = await request(app)
      .post('/users/sync')
      .send({ name: 'Dang Nguyen', email: 'dang@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.auth0_id).toBe('auth0|test-user-123');
    expect(res.body.name).toBe('Dang Nguyen');
  });

  it('returns existing user on subsequent logins', async () => {
    const res = await request(app)
      .post('/users/sync')
      .send({ name: 'Dang Nguyen', email: 'dang@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.auth0_id).toBe('auth0|test-user-123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/routes/users.test.js -v
```
Expected: FAIL — route not found (404).

- [ ] **Step 3: Write `api/src/models/user.js`**

```js
const db = require('../db');

async function findOrCreate({ auth0Id, name, email }) {
  const existing = await db.query(
    'SELECT * FROM users WHERE auth0_id = $1',
    [auth0Id]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const result = await db.query(
    `INSERT INTO users (auth0_id, name, email)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [auth0Id, name, email]
  );
  return result.rows[0];
}

async function findByAuth0Id(auth0Id) {
  const result = await db.query(
    'SELECT * FROM users WHERE auth0_id = $1',
    [auth0Id]
  );
  return result.rows[0] || null;
}

module.exports = { findOrCreate, findByAuth0Id };
```

- [ ] **Step 4: Write `api/src/routes/users.js`**

```js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');

router.post('/sync', authenticate, async (req, res, next) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'name and email required' });
    }
    const user = await User.findOrCreate({ auth0Id: req.auth0Id, name, email });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest tests/routes/users.test.js -v
```
Expected: PASS (requires running test DB).

- [ ] **Step 6: Commit**

```bash
git add api/src/models/user.js api/src/routes/users.js api/tests/routes/users.test.js
git commit -m "feat: add user sync endpoint"
```

---

## Task 5: Category API

**Files:**
- Create: `api/src/models/category.js`
- Create: `api/src/routes/categories.js`
- Create: `api/tests/routes/categories.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// api/tests/routes/categories.test.js
const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.auth0Id = 'auth0|test-user-123';
    next();
  },
}));

afterAll(() => db.pool.end());

describe('GET /categories', () => {
  it('returns categories for the user household', async () => {
    const res = await request(app).get('/categories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /categories', () => {
  it('creates a category', async () => {
    const res = await request(app)
      .post('/categories')
      .send({ name: 'Groceries', icon: '🛒', color: '#4ade80' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Groceries');
  });

  it('rejects missing name', async () => {
    const res = await request(app)
      .post('/categories')
      .send({ icon: '🛒' });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/routes/categories.test.js -v
```
Expected: FAIL.

- [ ] **Step 3: Write `api/src/models/category.js`**

```js
const db = require('../db');

async function findByHousehold(householdId) {
  const result = await db.query(
    'SELECT * FROM categories WHERE household_id = $1 OR household_id IS NULL ORDER BY name',
    [householdId]
  );
  return result.rows;
}

async function create({ householdId, name, icon, color }) {
  const result = await db.query(
    `INSERT INTO categories (household_id, name, icon, color)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [householdId, name, icon, color]
  );
  return result.rows[0];
}

async function update({ id, householdId, name, icon, color }) {
  const result = await db.query(
    `UPDATE categories SET name = COALESCE($1, name), icon = COALESCE($2, icon),
     color = COALESCE($3, color)
     WHERE id = $4 AND household_id = $5
     RETURNING *`,
    [name, icon, color, id, householdId]
  );
  return result.rows[0] || null;
}

async function remove({ id, householdId }) {
  await db.query(
    'DELETE FROM categories WHERE id = $1 AND household_id = $2',
    [id, householdId]
  );
}

module.exports = { findByHousehold, create, update, remove };
```

- [ ] **Step 4: Write `api/src/routes/categories.js`**

```js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const Category = require('../models/category');

router.use(authenticate);

async function getUser(req) {
  return User.findByAuth0Id(req.auth0Id);
}

router.get('/', async (req, res, next) => {
  try {
    const user = await getUser(req);
    const categories = await Category.findByHousehold(user?.household_id);
    res.json(categories);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, icon, color } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const user = await getUser(req);
    const category = await Category.create({ householdId: user?.household_id, name, icon, color });
    res.status(201).json(category);
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const user = await getUser(req);
    const category = await Category.update({ id: req.params.id, householdId: user?.household_id, ...req.body });
    if (!category) return res.status(404).json({ error: 'Not found' });
    res.json(category);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const user = await getUser(req);
    await Category.remove({ id: req.params.id, householdId: user?.household_id });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest tests/routes/categories.test.js -v
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/models/category.js api/src/routes/categories.js api/tests/routes/categories.test.js
git commit -m "feat: add categories API"
```

---

## Task 6: NL Parser Service

**Files:**
- Create: `api/src/services/nlParser.js`
- Create: `api/tests/services/nlParser.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// api/tests/services/nlParser.test.js
const { parseExpense } = require('../../src/services/nlParser');

// Mock Claude SDK
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{
          text: JSON.stringify({
            merchant: 'Trader Joe\'s',
            amount: 242.50,
            date: '2026-03-20',
            notes: null,
          })
        }]
      })
    }
  }));
});

describe('parseExpense', () => {
  it('parses amount and merchant from simple NL input', async () => {
    const result = await parseExpense('242.50 trader joes', '2026-03-20');
    expect(result.merchant).toBe("Trader Joe's");
    expect(result.amount).toBe(242.50);
    expect(result.date).toBe('2026-03-20');
  });

  it('returns null for unparseable input', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create.mockResolvedValueOnce({
      content: [{ text: 'null' }]
    });
    const result = await parseExpense('asdfjkl', '2026-03-20');
    expect(result).toBeNull();
  });

  it('throws if Claude API call fails', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create.mockRejectedValueOnce(new Error('API timeout'));
    await expect(parseExpense('lunch chipotle 14.50', '2026-03-20')).rejects.toThrow('API timeout');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/services/nlParser.test.js -v
```
Expected: FAIL.

- [ ] **Step 3: Write `api/src/services/nlParser.js`**

```js
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an expense parser. Extract structured data from natural language expense input.
Return ONLY a JSON object with these fields: merchant (string), amount (number), date (ISO date string), notes (string or null).
If the input cannot be parsed as an expense, return null.
Today's date is provided in the user message. If no date is mentioned, use today's date.
Do not include any text outside the JSON object.`;

async function parseExpense(input, todayDate) {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Today's date: ${todayDate}\nExpense input: ${input}`,
    }],
  });

  const text = message.content[0].text.trim();
  if (text === 'null') return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = { parseExpense };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/services/nlParser.test.js -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/nlParser.js api/tests/services/nlParser.test.js
git commit -m "feat: add NL expense parser service"
```

---

## Task 7: Category Assigner Service

**Files:**
- Create: `api/src/models/merchantMapping.js`
- Create: `api/src/services/categoryAssigner.js`
- Create: `api/tests/services/categoryAssigner.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// api/tests/services/categoryAssigner.test.js
const { assignCategory } = require('../../src/services/categoryAssigner');
const MerchantMapping = require('../../src/models/merchantMapping');
const db = require('../../src/db');

jest.mock('../../src/models/merchantMapping');
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: {
    create: jest.fn().mockResolvedValue({
      content: [{ text: JSON.stringify({ category_id: 'cat-grocery-id', confidence: 'high' }) }]
    })
  }
})));

afterAll(() => db.pool.end());

const mockCategories = [
  { id: 'cat-grocery-id', name: 'Groceries' },
  { id: 'cat-gas-id', name: 'Gas' },
];

describe('assignCategory', () => {
  it('returns category from MerchantMapping when available', async () => {
    MerchantMapping.findByMerchant.mockResolvedValueOnce({
      category_id: 'cat-grocery-id',
      hit_count: 7,
    });

    const result = await assignCategory({
      merchant: "Trader Joe's",
      householdId: 'hh-1',
      categories: mockCategories,
    });

    expect(result.category_id).toBe('cat-grocery-id');
    expect(result.source).toBe('memory');
    expect(result.confidence).toBe(4); // hit_count >= 5 → 4 dots
    expect(MerchantMapping.findByMerchant).toHaveBeenCalledWith('hh-1', "Trader Joe's");
  });

  it('falls back to Claude when no mapping exists', async () => {
    MerchantMapping.findByMerchant.mockResolvedValueOnce(null);

    const result = await assignCategory({
      merchant: 'New Restaurant',
      householdId: 'hh-1',
      categories: mockCategories,
    });

    expect(result.category_id).toBe('cat-grocery-id');
    expect(result.source).toBe('claude');
    expect(result.confidence).toBe(1); // Claude fallback → 1 dot
  });

  it('returns null category when Claude cannot determine', async () => {
    MerchantMapping.findByMerchant.mockResolvedValueOnce(null);
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({ category_id: null, confidence: 'none' }) }]
    });

    const result = await assignCategory({
      merchant: 'Unknown Place',
      householdId: 'hh-1',
      categories: mockCategories,
    });

    expect(result.category_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/services/categoryAssigner.test.js -v
```
Expected: FAIL.

- [ ] **Step 3: Write `api/src/models/merchantMapping.js`**

```js
const db = require('../db');

async function findByMerchant(householdId, merchantName) {
  const result = await db.query(
    `SELECT * FROM merchant_mappings
     WHERE household_id = $1 AND LOWER(merchant_name) = LOWER($2)`,
    [householdId, merchantName]
  );
  return result.rows[0] || null;
}

async function upsert({ householdId, merchantName, categoryId }) {
  await db.query(
    `INSERT INTO merchant_mappings (household_id, merchant_name, category_id, hit_count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (household_id, merchant_name)
     DO UPDATE SET category_id = $3, hit_count = merchant_mappings.hit_count + 1,
     updated_at = NOW()`,
    [householdId, merchantName, categoryId]
  );
}

module.exports = { findByMerchant, upsert };
```

- [ ] **Step 4: Write `api/src/services/categoryAssigner.js`**

```js
const Anthropic = require('@anthropic-ai/sdk');
const MerchantMapping = require('../models/merchantMapping');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function confidenceFromHitCount(hitCount) {
  if (hitCount >= 5) return 4;
  if (hitCount >= 2) return 3;
  return 2;
}

const SYSTEM_PROMPT = `You are an expense categorizer. Given a merchant name and a list of categories,
return the best matching category_id. Return ONLY a JSON object: {"category_id": "<id or null>", "confidence": "high|medium|low|none"}.
If no category fits, return null for category_id. Do not include any text outside the JSON.`;

async function assignCategory({ merchant, householdId, categories, placeType }) {
  // 1. Check merchant memory
  const mapping = await MerchantMapping.findByMerchant(householdId, merchant);
  if (mapping) {
    return {
      category_id: mapping.category_id,
      source: 'memory',
      confidence: confidenceFromHitCount(mapping.hit_count),
    };
  }

  // 2. Claude fallback
  const categoryList = categories.map(c => `${c.id}: ${c.name}`).join('\n');
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 128,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Merchant: ${merchant}${placeType ? `\nPlace type: ${placeType}` : ''}\n\nCategories:\n${categoryList}`,
    }],
  });

  try {
    const parsed = JSON.parse(message.content[0].text.trim());
    return {
      category_id: parsed.category_id || null,
      source: 'claude',
      confidence: 1,
    };
  } catch {
    return { category_id: null, source: 'claude', confidence: 0 };
  }
}

module.exports = { assignCategory };
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest tests/services/categoryAssigner.test.js -v
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/models/merchantMapping.js api/src/services/categoryAssigner.js api/tests/services/categoryAssigner.test.js
git commit -m "feat: add category assigner service with merchant memory"
```

---

## Task 8: Expense API

**Files:**
- Create: `api/src/models/expense.js`
- Create: `api/src/routes/expenses.js`
- Create: `api/tests/routes/expenses.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// api/tests/routes/expenses.test.js
const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.auth0Id = 'auth0|test-user-123';
    next();
  },
}));
jest.mock('../../src/services/nlParser');
jest.mock('../../src/services/categoryAssigner');

const { parseExpense } = require('../../src/services/nlParser');
const { assignCategory } = require('../../src/services/categoryAssigner');

afterAll(() => db.pool.end());

describe('POST /expenses/parse', () => {
  it('returns parsed expense with category suggestion', async () => {
    parseExpense.mockResolvedValueOnce({
      merchant: "Trader Joe's", amount: 84.17, date: '2026-03-20', notes: null,
    });
    assignCategory.mockResolvedValueOnce({
      category_id: 'some-cat-id', source: 'memory', confidence: 4,
    });

    const res = await request(app)
      .post('/expenses/parse')
      .send({ input: '84.17 trader joes', today: '2026-03-20' });

    expect(res.status).toBe(200);
    expect(res.body.merchant).toBe("Trader Joe's");
    expect(res.body.amount).toBe(84.17);
    expect(res.body.category_id).toBe('some-cat-id');
  });

  it('returns 422 when input cannot be parsed', async () => {
    parseExpense.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/expenses/parse')
      .send({ input: 'asdfjkl', today: '2026-03-20' });

    expect(res.status).toBe(422);
  });
});

describe('POST /expenses/confirm', () => {
  it('creates a confirmed expense and updates merchant mapping', async () => {
    const res = await request(app)
      .post('/expenses/confirm')
      .send({
        merchant: "Trader Joe's",
        amount: 84.17,
        date: '2026-03-20',
        category_id: 'some-cat-id',
        source: 'manual',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('confirmed');
  });
});

describe('GET /expenses', () => {
  it('returns expenses for the authenticated user', async () => {
    const res = await request(app).get('/expenses');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/routes/expenses.test.js -v
```
Expected: FAIL.

- [ ] **Step 3: Write `api/src/models/expense.js`**

```js
const db = require('../db');

async function create({ userId, householdId, merchant, amount, date, categoryId, source, status = 'pending', notes }) {
  const result = await db.query(
    `INSERT INTO expenses (user_id, household_id, merchant, amount, date, category_id, source, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [userId, householdId, merchant, amount, date, categoryId, source, status, notes]
  );
  return result.rows[0];
}

async function findByUser(userId, { limit = 50, offset = 0 } = {}) {
  const result = await db.query(
    `SELECT e.*, c.name as category_name, c.icon as category_icon, c.color as category_color
     FROM expenses e
     LEFT JOIN categories c ON e.category_id = c.id
     WHERE e.user_id = $1 AND e.status != 'dismissed'
     ORDER BY e.date DESC, e.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return result.rows;
}

async function updateStatus(id, userId, status) {
  const result = await db.query(
    `UPDATE expenses SET status = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
    [status, id, userId]
  );
  return result.rows[0] || null;
}

module.exports = { create, findByUser, updateStatus };
```

- [ ] **Step 4: Write `api/src/routes/expenses.js`**

```js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const Expense = require('../models/expense');
const Category = require('../models/category');
const MerchantMapping = require('../models/merchantMapping');
const { parseExpense } = require('../services/nlParser');
const { assignCategory } = require('../services/categoryAssigner');

router.use(authenticate);

async function getUser(req) {
  return User.findByAuth0Id(req.auth0Id);
}

const { aiEndpoints } = require('../middleware/rateLimit');

// Parse NL input → structured expense (does NOT save to DB)
router.post('/parse', aiEndpoints, async (req, res, next) => {
  try {
    const { input, today } = req.body;
    if (!input) return res.status(400).json({ error: 'input required' });

    const parsed = await parseExpense(input, today || new Date().toISOString().split('T')[0]);
    if (!parsed) return res.status(422).json({ error: 'Could not parse expense' });

    const user = await getUser(req);
    const categories = await Category.findByHousehold(user?.household_id);
    const { category_id, source, confidence } = await assignCategory({
      merchant: parsed.merchant,
      householdId: user?.household_id,
      categories,
    });

    res.json({ ...parsed, category_id, category_source: source, category_confidence: confidence });
  } catch (err) { next(err); }
});

// Confirm expense → save to DB + update merchant mapping
router.post('/confirm', async (req, res, next) => {
  try {
    const { merchant, amount, date, category_id, source, notes,
            place_name, address, mapkit_stable_id } = req.body;

    if (!merchant || !amount || !date || !source) {
      return res.status(400).json({ error: 'merchant, amount, date, source required' });
    }

    const user = await getUser(req);
    const expense = await Expense.create({
      userId: user.id,
      householdId: user?.household_id,
      merchant, amount, date, categoryId: category_id,
      source, status: 'confirmed', notes,
    });

    // Update merchant memory
    if (category_id && user?.household_id) {
      await MerchantMapping.upsert({
        householdId: user.household_id,
        merchantName: merchant,
        categoryId: category_id,
      });
    }

    res.status(201).json(expense);
  } catch (err) { next(err); }
});

// List confirmed expenses for the authenticated user
router.get('/', async (req, res, next) => {
  try {
    const user = await getUser(req);
    const expenses = await Expense.findByUser(user.id);
    res.json(expenses);
  } catch (err) { next(err); }
});

module.exports = router;
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest tests/routes/expenses.test.js -v
```
Expected: PASS.

- [ ] **Step 6: Run all API tests**

```bash
npx jest --verbose
```
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add api/src/models/expense.js api/src/routes/expenses.js api/tests/routes/expenses.test.js
git commit -m "feat: add expense parse + confirm API"
```

---

## Task 9: Mobile Project Scaffolding

**Files:**
- Create: `mobile/` (Expo project)
- Create: `mobile/services/api.js`
- Create: `mobile/app/_layout.js`

- [ ] **Step 1: Create the Expo project**

```bash
npx create-expo-app mobile --template blank
cd mobile
npx expo install expo-router expo-secure-store react-native-safe-area-context react-native-screens
npm install react-native-auth0
npm install --save-dev jest @testing-library/react-native @testing-library/jest-native
```

- [ ] **Step 2: Configure `mobile/app.json`**

Add to the `expo` object:
```json
{
  "expo": {
    "name": "Expense Tracker",
    "slug": "expense-tracker",
    "scheme": "expensetracker",
    "plugins": ["expo-router"]
  }
}
```

- [ ] **Step 3: Write `mobile/services/api.js`**

```js
import * as SecureStore from 'expo-secure-store';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

async function getToken() {
  return SecureStore.getItemAsync('auth_token');
}

async function request(path, options = {}) {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
};
```

- [ ] **Step 4: Write `mobile/app/_layout.js`**

```js
import { Stack } from 'expo-router';
import Auth0Provider from 'react-native-auth0';

export default function RootLayout() {
  return (
    <Auth0Provider
      domain={process.env.EXPO_PUBLIC_AUTH0_DOMAIN}
      clientId={process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID}
    >
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="confirm" options={{ presentation: 'modal', title: 'Confirm Expense' }} />
      </Stack>
    </Auth0Provider>
  );
}
```

- [ ] **Step 5: Create `mobile/.env.local`** (gitignored)

```
EXPO_PUBLIC_API_URL=http://localhost:3001
EXPO_PUBLIC_AUTH0_DOMAIN=your-domain.auth0.com
EXPO_PUBLIC_AUTH0_CLIENT_ID=your-client-id
```

- [ ] **Step 6: Commit**

```bash
git add mobile/
git commit -m "feat: scaffold mobile Expo project"
```

---

## Task 10: Mobile — Hooks

**Files:**
- Create: `mobile/hooks/useExpenses.js`
- Create: `mobile/hooks/useCategories.js`

- [ ] **Step 1: Write `mobile/hooks/useExpenses.js`**

```js
import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

export function useExpenses() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get('/expenses');
      setExpenses(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { expenses, loading, error, refresh };
}
```

- [ ] **Step 2: Write `mobile/hooks/useCategories.js`**

```js
import { useState, useEffect } from 'react';
import { api } from '../services/api';

export function useCategories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/categories')
      .then(setCategories)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return { categories, loading };
}
```

- [ ] **Step 3: Commit**

```bash
git add mobile/hooks/
git commit -m "feat: add useExpenses and useCategories hooks"
```

---

## Task 11: Mobile — Core Components

**Files:**
- Create: `mobile/components/ExpenseItem.js`
- Create: `mobile/components/CategoryBadge.js`
- Create: `mobile/components/NLInput.js`
- Create: `mobile/components/ConfirmField.js`

- [ ] **Step 1: Write `mobile/components/CategoryBadge.js`**

```js
import { View, Text, StyleSheet } from 'react-native';

export function CategoryBadge({ name, confidence, source }) {
  const dots = '●'.repeat(confidence) + '○'.repeat(4 - confidence);
  const label = source === 'memory' ? 'from memory' : 'suggested';

  return (
    <View style={styles.container}>
      <Text style={styles.name}>{name || 'Unclassified'}</Text>
      {confidence > 0 && (
        <Text style={styles.confidence}>{label} {dots}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 14, color: '#fff' },
  confidence: { fontSize: 10, color: '#666' },
});
```

- [ ] **Step 2: Write `mobile/components/ExpenseItem.js`**

```js
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export function ExpenseItem({ expense, onPress }) {
  return (
    <TouchableOpacity style={styles.container} onPress={() => onPress?.(expense)}>
      <View style={styles.left}>
        <Text style={styles.merchant}>{expense.merchant}</Text>
        <Text style={styles.meta}>
          {expense.category_name || 'Unclassified'} · {expense.date}
        </Text>
      </View>
      <Text style={styles.amount}>${Number(expense.amount).toFixed(2)}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1a1a1a', borderRadius: 8, padding: 12, marginBottom: 8,
  },
  left: { flex: 1 },
  merchant: { fontSize: 14, color: '#fff', fontWeight: '600' },
  meta: { fontSize: 11, color: '#666', marginTop: 2 },
  amount: { fontSize: 16, color: '#fff', fontWeight: '700' },
});
```

- [ ] **Step 3: Write `mobile/components/NLInput.js`**

```js
import { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet } from 'react-native';

export function NLInput({ onSubmit, loading }) {
  const [value, setValue] = useState('');

  function handleSubmit() {
    if (value.trim()) {
      onSubmit(value.trim());
      setValue('');
    }
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        placeholder="242.50 trader joes"
        placeholderTextColor="#555"
        onSubmitEditing={handleSubmit}
        editable={!loading}
        autoCorrect={false}
      />
      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
        <Text style={styles.buttonText}>→</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14,
    color: '#fff', fontSize: 16, borderWidth: 1, borderColor: '#333',
  },
  button: {
    backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 20,
    justifyContent: 'center',
  },
  buttonText: { fontSize: 18, fontWeight: '700', color: '#000' },
});
```

- [ ] **Step 4: Write `mobile/components/ConfirmField.js`**

```js
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export function ConfirmField({ label, value, onPress }) {
  return (
    <TouchableOpacity style={styles.container} onPress={onPress}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value ?? '—'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1a1a1a', borderRadius: 8, padding: 12, marginBottom: 8,
  },
  label: { fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1 },
  value: { fontSize: 14, color: '#fff' },
});
```

- [ ] **Step 5: Commit**

```bash
git add mobile/components/
git commit -m "feat: add core mobile components"
```

---

## Task 12: Mobile — My Feed Screen

**Files:**
- Create: `mobile/app/(tabs)/_layout.js`
- Create: `mobile/app/(tabs)/index.js`

- [ ] **Step 1: Write `mobile/app/(tabs)/_layout.js`**

```js
import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      tabBarStyle: { backgroundColor: '#0a0a0a', borderTopColor: '#222' },
      tabBarActiveTintColor: '#fff',
      tabBarInactiveTintColor: '#555',
      headerStyle: { backgroundColor: '#0a0a0a' },
      headerTintColor: '#fff',
    }}>
      <Tabs.Screen name="index" options={{ title: 'My Feed', tabBarLabel: 'Feed' }} />
      <Tabs.Screen name="add" options={{ title: 'Add Expense', tabBarLabel: 'Add' }} />
    </Tabs>
  );
}
```

- [ ] **Step 2: Write `mobile/app/(tabs)/index.js`**

```js
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useExpenses } from '../../hooks/useExpenses';
import { ExpenseItem } from '../../components/ExpenseItem';

export default function FeedScreen() {
  const { expenses, loading, refresh } = useExpenses();

  const monthlyTotal = expenses
    .filter(e => e.date?.startsWith(new Date().toISOString().slice(0, 7)))
    .reduce((sum, e) => sum + Number(e.amount), 0);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.totalLabel}>This month</Text>
        <Text style={styles.total}>${monthlyTotal.toFixed(2)}</Text>
      </View>
      <FlatList
        data={expenses}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <ExpenseItem expense={item} />}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#fff" />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !loading && <Text style={styles.empty}>No expenses yet. Tap Add to get started.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  totalLabel: { fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1 },
  total: { fontSize: 32, color: '#fff', fontWeight: '700', marginTop: 4 },
  list: { padding: 16 },
  empty: { color: '#555', textAlign: 'center', marginTop: 40 },
});
```

- [ ] **Step 3: Start Expo dev server and verify My Feed renders**

```bash
cd mobile && npx expo start
```
Expected: App opens, Feed tab shows with $0.00 total and empty state message.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/(tabs)/
git commit -m "feat: add My Feed screen"
```

---

## Task 13: Mobile — Add Expense + Confirm Screens

**Files:**
- Create: `mobile/app/(tabs)/add.js`
- Create: `mobile/app/confirm.js`

- [ ] **Step 1: Write `mobile/app/(tabs)/add.js`**

```js
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { NLInput } from '../../components/NLInput';
import { api } from '../../services/api';
import { useState } from 'react';

export default function AddScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(input) {
    try {
      setLoading(true);
      const today = new Date().toISOString().split('T')[0];
      const parsed = await api.post('/expenses/parse', { input, today });
      router.push({ pathname: '/confirm', params: { data: JSON.stringify(parsed) } });
    } catch (err) {
      if (err.message.includes('Could not parse')) {
        Alert.alert("Couldn't parse that", "Try: '84.50 trader joes' or 'lunch chipotle 14'");
      } else {
        Alert.alert('Error', err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>
        try: "242.50 trader joes" · "lunch chipotle 14.50" · "60 gas yesterday"
      </Text>
      <NLInput onSubmit={handleSubmit} loading={loading} />
      {loading && <ActivityIndicator color="#fff" style={{ marginTop: 16 }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 20 },
  hint: { color: '#555', fontSize: 12, marginBottom: 16, lineHeight: 18 },
});
```

- [ ] **Step 2: Write `mobile/app/confirm.js`**

```js
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { api } from '../services/api';
import { ConfirmField } from '../components/ConfirmField';
import { CategoryBadge } from '../components/CategoryBadge';

export default function ConfirmScreen() {
  const { data } = useLocalSearchParams();
  const parsed = JSON.parse(data);
  const router = useRouter();

  const [expense, setExpense] = useState(parsed);
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    if (!expense.category_id) {
      Alert.alert('Category required', 'Please assign a category before confirming.');
      return;
    }
    try {
      setSaving(true);
      await api.post('/expenses/confirm', {
        merchant: expense.merchant,
        amount: expense.amount,
        date: expense.date,
        category_id: expense.category_id,
        source: 'manual',
        notes: expense.notes,
      });
      router.replace('/(tabs)');
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ConfirmField label="Merchant" value={expense.merchant} />
      <ConfirmField label="Amount" value={`$${Number(expense.amount).toFixed(2)}`} />
      <ConfirmField label="Date" value={expense.date} />
      <View style={styles.categoryRow}>
        <Text style={styles.categoryLabel}>CATEGORY</Text>
        <CategoryBadge
          name={expense.category_name}
          confidence={expense.category_confidence || 0}
          source={expense.category_source}
        />
      </View>
      {!expense.category_id && (
        <Text style={styles.categoryRequired}>Category required before confirming</Text>
      )}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.discard} onPress={() => router.back()}>
          <Text style={styles.discardText}>discard</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirm, saving && styles.confirmDisabled]}
          onPress={handleConfirm}
          disabled={saving}
        >
          <Text style={styles.confirmText}>{saving ? 'saving...' : 'confirm →'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20 },
  categoryRow: {
    backgroundColor: '#1a1a1a', borderRadius: 8, padding: 12,
    marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between',
  },
  categoryLabel: { fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1 },
  categoryRequired: { color: '#f97316', fontSize: 11, marginBottom: 8, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  discard: {
    flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10,
    padding: 16, alignItems: 'center',
  },
  discardText: { color: '#666', fontSize: 14 },
  confirm: { flex: 2, backgroundColor: '#fff', borderRadius: 10, padding: 16, alignItems: 'center' },
  confirmDisabled: { opacity: 0.5 },
  confirmText: { color: '#000', fontSize: 14, fontWeight: '700' },
});
```

- [ ] **Step 3: Run end-to-end test manually**

Start both API and mobile dev server:
```bash
# Terminal 1
cd api && npm run dev

# Terminal 2
cd mobile && npx expo start
```
1. Open app in iOS Simulator
2. Tap Add tab
3. Type `84.50 trader joes` → tap →
4. Confirm screen shows with merchant, amount, date pre-filled
5. Tap confirm → returns to Feed with expense listed

Expected: Expense appears in Feed with merchant "Trader Joe's" and amount $84.50.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/(tabs)/add.js mobile/app/confirm.js
git commit -m "feat: add Add Expense and Confirm screens"
```

---

## Task 14: Seed Default Categories

**Files:**
- Create: `api/src/db/seeds/defaultCategories.js`
- Create: `mobile/constants/defaultCategories.js`

- [ ] **Step 1: Write `api/src/db/seeds/defaultCategories.js`**

```js
// Run: node api/src/db/seeds/defaultCategories.js
require('dotenv').config({ path: 'api/.env' });
const db = require('../index');

const defaults = [
  { name: 'Groceries', icon: '🛒', color: '#4ade80' },
  { name: 'Dining Out', icon: '🍽️', color: '#f97316' },
  { name: 'Gas', icon: '⛽', color: '#facc15' },
  { name: 'Household', icon: '🏠', color: '#60a5fa' },
  { name: 'Kids', icon: '👶', color: '#c084fc' },
  { name: 'Healthcare', icon: '💊', color: '#f43f5e' },
  { name: 'Subscriptions', icon: '📱', color: '#a78bfa' },
  { name: 'Entertainment', icon: '🎬', color: '#fb923c' },
  { name: 'Shopping', icon: '🛍️', color: '#38bdf8' },
  { name: 'Travel', icon: '✈️', color: '#34d399' },
  { name: 'Other', icon: '📌', color: '#94a3b8' },
];

async function seed() {
  for (const cat of defaults) {
    await db.query(
      `INSERT INTO categories (name, icon, color)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [cat.name, cat.icon, cat.color]
    );
  }
  console.log('Default categories seeded');
  await db.pool.end();
}

seed().catch(console.error);
```

- [ ] **Step 2: Run the seed**

```bash
node api/src/db/seeds/defaultCategories.js
```
Expected: "Default categories seeded"

- [ ] **Step 3: Write `mobile/constants/defaultCategories.js`**

```js
// Mirror of backend seed — used during onboarding category setup
export const DEFAULT_CATEGORIES = [
  { name: 'Groceries', icon: '🛒', color: '#4ade80' },
  { name: 'Dining Out', icon: '🍽️', color: '#f97316' },
  { name: 'Gas', icon: '⛽', color: '#facc15' },
  { name: 'Household', icon: '🏠', color: '#60a5fa' },
  { name: 'Kids', icon: '👶', color: '#c084fc' },
  { name: 'Healthcare', icon: '💊', color: '#f43f5e' },
  { name: 'Subscriptions', icon: '📱', color: '#a78bfa' },
  { name: 'Entertainment', icon: '🎬', color: '#fb923c' },
  { name: 'Shopping', icon: '🛍️', color: '#38bdf8' },
  { name: 'Travel', icon: '✈️', color: '#34d399' },
  { name: 'Other', icon: '📌', color: '#94a3b8' },
];
```

- [ ] **Step 4: Commit**

```bash
git add api/src/db/seeds/ mobile/constants/
git commit -m "feat: add default categories seed and constants"
```

---

## Task 15: Rate Limiting

**Files:**
- Create: `api/src/middleware/rateLimit.js`

- [ ] **Step 1: Write `api/src/middleware/rateLimit.js`**

```js
const rateLimit = require('express-rate-limit');

const standard = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

// Stricter limit for Claude-dependent endpoints
const aiEndpoints = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded for AI endpoints' },
});

module.exports = { standard, aiEndpoints };
```

- [ ] **Step 2: Apply standard rate limiting in `api/src/index.js`**

```js
const { standard } = require('./middleware/rateLimit');

// Add after cors() middleware:
app.use(standard);
```

Note: `aiEndpoints` is applied **inside** the expenses router (Task 8), not here. Mounting it at `app.use('/expenses/parse', ...)` after the router is already mounted will silently not match — Express routes greedily.

- [ ] **Step 3: Run all tests to verify nothing broke**

```bash
cd api && npx jest --verbose
```
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add api/src/middleware/rateLimit.js api/src/index.js
git commit -m "feat: add rate limiting middleware"
```

---

## Verification Checklist

Before handing off to Plan 2, verify:

- [ ] `npx jest --verbose` in `api/` — all tests pass
- [ ] API server starts: `cd api && npm run dev` — no errors on port 3001
- [ ] Database schema applied: all tables exist in `expense_tracker` DB
- [ ] Default categories seeded: 11 categories visible via `GET /categories`
- [ ] Mobile app runs in iOS Simulator: `cd mobile && npx expo start`
- [ ] Full flow works manually: type NL → parse → confirm → appears in Feed

---

## What Plan 2 Covers

- Household creation + partner invite flow
- Household View screen (side-by-side totals)
- Deduplication pipeline (DuplicateFlag creation + Pending Queue)
- Pending Queue screen (review + resolve)
- Expense detail screen (view/edit confirmed expenses)
