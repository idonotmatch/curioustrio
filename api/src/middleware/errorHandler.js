const { captureException } = require('../services/observability');

function errorHandler(err, req, res, next) {
  const bodyTooLarge = err?.type === 'entity.too.large';
  const status = bodyTooLarge ? 413 : (err.status || 500);
  const reasonCode = bodyTooLarge ? 'payload_too_large' : (err?.reason_code || null);
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
  const isReceiptUpload = `${req?.originalUrl || req?.url || ''}`.startsWith('/expenses/scan');
  const message = bodyTooLarge
    ? (isReceiptUpload ? 'Receipt upload is too large' : 'Request payload is too large')
    : status >= 500 && process.env.NODE_ENV === 'production' && err.expose !== true
    ? 'Internal server error'
    : err.message || 'Internal server error';
  const safeDetails = err?.expose === true && err?.details && typeof err.details === 'object'
    ? err.details
    : {};
  if (safeDetails.retry_at) {
    const retrySeconds = Math.max(1, Math.ceil((new Date(safeDetails.retry_at).getTime() - Date.now()) / 1000));
    res.setHeader('retry-after', retrySeconds);
  }
  res.status(status).json({
    error: message,
    ...(reasonCode ? { reason_code: reasonCode } : {}),
    ...safeDetails,
    request_id: req?.requestId || null,
  });
}

module.exports = { errorHandler };
