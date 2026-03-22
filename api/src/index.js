require('dotenv').config();
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

app.use(helmet());
app.use(cors());
app.use(standard);
app.use(express.json({ limit: '1mb' }));

app.use('/expenses', expensesRouter);
app.use('/categories', categoriesRouter);
app.use('/users', usersRouter);
app.use('/households', householdsRouter);
app.use('/gmail', gmailRouter);
app.use('/budgets', budgetsRouter);
app.use('/recurring', recurringRouter);
app.use('/push', pushRouter);
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
