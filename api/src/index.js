require('dotenv').config();
// Prefer IPv4 DNS results — belt-and-suspenders alongside the pooler URL which
// already resolves to IPv4 on AWS. This must be called before any network I/O.
require('dns').setDefaultResultOrder('ipv4first');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { errorHandler } = require('./middleware/errorHandler');
const { standard } = require('./middleware/rateLimit');
const expensesRouter = require('./routes/expenses');
const categoriesRouter = require('./routes/categories');
const usersRouter = require('./routes/users');
const householdsRouter = require('./routes/households');
const gmailRouter = require('./routes/gmail');
const budgetsRouter = require('./routes/budgets');
const recurringRouter = require('./routes/recurring');
const pushRouter = require('./routes/push');
const placesRouter = require('./routes/places');
const cronRouter = require('./routes/cron');

const app = express();

// Trust Render's load balancer so express-rate-limit sees the real client IP
// via X-Forwarded-For rather than the proxy's internal IP. Without this,
// rate-limit v6+ misidentifies all clients as the same IP and can block valid
// requests. '1' means trust the first hop (Render's LB).
app.set('trust proxy', 1);

// Health check — registered before all other middleware so it responds
// immediately regardless of rate limits, auth, or body parsing. Render's
// internal health checker pings this to confirm the service is alive.
app.get('/health', (req, res) => res.json({ ok: true }));

const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Origins that Expo/React Native sends on real devices and simulators.
// These are not browser origins so CORS restrictions don't apply, but the
// cors middleware still sees them as a non-null origin and would reject them
// if not explicitly listed.
const MOBILE_ORIGINS = [
  'capacitor://localhost',  // Expo on iOS (TestFlight + device)
  'https://localhost',      // Expo web / some RN bridges
  'http://localhost',       // local dev
];

app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // curl, server-to-server
    if (MOBILE_ORIGINS.includes(origin)) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`Origin ${origin} not allowed by CORS policy`));
  },
}));
app.use(standard);
app.use(express.json({ limit: '5mb' }));

app.use('/expenses', expensesRouter);
app.use('/categories', categoriesRouter);
app.use('/users', usersRouter);
app.use('/households', householdsRouter);
app.use('/gmail', gmailRouter);
app.use('/budgets', budgetsRouter);
app.use('/recurring', recurringRouter);
app.use('/push', pushRouter);
app.use('/places', placesRouter);
app.use('/cron', cronRouter);
app.use(errorHandler);

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  // Bind explicitly to 0.0.0.0 (IPv4 wildcard) so the server is reachable from
  // the iOS Simulator and physical devices on the local network. Without an
  // explicit hostname, Node.js on some systems binds to :: (IPv6 only) which
  // is unreachable when the client falls back to 127.0.0.1.
  app.listen(PORT, '0.0.0.0', () => console.log(`API running on ${PORT}`));
}

module.exports = app;
