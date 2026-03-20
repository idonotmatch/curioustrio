const rateLimit = require('express-rate-limit');
const aiEndpoints = (req, res, next) => next(); // stub — replaced in Task 15
const standard = (req, res, next) => next();
module.exports = { standard, aiEndpoints };
