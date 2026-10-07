const { captureException } = require('../services/observability');

function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const context = {
    status,
    request_id: req?.requestId || null,
    method: req?.method || null,
    path: req?.originalUrl || req?.url || null,
    message: err?.message || null,
    code: err?.code || null,
    stack: process.env.NODE_ENV === 'production' ? undefined : err?.stack,
  };
  console.error('[api error]', context);
  if (status >= 500) captureException(err, context);
  // Don't leak DB messages, stack info, or internal details to clients in production.
  const message = status >= 500 && process.env.NODE_ENV === 'production' && err.expose !== true
    ? 'Internal server error'
    : err.message || 'Internal server error';
  res.status(status).json({
    error: message,
    request_id: req?.requestId || null,
  });
}

module.exports = { errorHandler };
