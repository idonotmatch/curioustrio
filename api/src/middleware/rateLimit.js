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

// Per-authenticated-user limit — applied after authenticate middleware so
// req.userId is always set. No IP fallback needed (and express-rate-limit v7
// throws ERR_ERL_KEY_GEN_IPV6 if req.ip is used without the ipKeyGenerator helper).
const perUser = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many requests, please try again later' },
});

// Per-user limit for AI/write-heavy endpoints
const perUserAi = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Rate limit exceeded for AI endpoints' },
});

module.exports = { standard, aiEndpoints, perUser, perUserAi };
