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
app.use(helmet());
app.use(cors());
app.use(standard);
app.use(express.json({ limit: '1mb' }));

// Health check — no auth, no rate limit. Used by Render's health check config
// and by any keep-alive pinger to prevent free-tier sleep.
app.get('/health', (req, res) => res.json({ ok: true }));

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
