function errorHandler(err, req, res, next) {
  console.error(err.stack);
  const status = err.status || 500;
  // Don't leak DB messages, stack info, or internal details to clients in production.
  const message = status >= 500 && process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message || 'Internal server error';
  res.status(status).json({ error: message });
}

module.exports = { errorHandler };
