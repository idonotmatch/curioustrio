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

const app = express();
app.use(helmet());
app.use(cors());
app.use(standard);
app.use(express.json({ limit: '1mb' }));

app.use('/expenses', expensesRouter);
app.use('/categories', categoriesRouter);
app.use('/users', usersRouter);
app.use('/households', householdsRouter);
app.use('/gmail', gmailRouter);
app.use(errorHandler);

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => console.log(`API running on ${PORT}`));
}

module.exports = app;
