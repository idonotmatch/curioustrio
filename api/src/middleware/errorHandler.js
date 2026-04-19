function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  console.error('[api error]', {
    status,
    method: req?.method || null,
    path: req?.originalUrl || req?.url || null,
    message: err?.message || null,
    code: err?.code || null,
    stack: process.env.NODE_ENV === 'production' ? undefined : err?.stack,
  });
  // Don't leak DB messages, stack info, or internal details to clients in production.
  const message = status >= 500 && process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message || 'Internal server error';
  res.status(status).json({ error: message });
}

module.exports = { errorHandler };
