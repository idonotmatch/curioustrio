// Safe messages for common client-error status codes — exposed in all environments.
const CLIENT_ERROR_MESSAGES = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  422: 'Unprocessable entity',
  429: 'Too many requests',
};

function errorHandler(err, req, res, next) {
  console.error(err.stack);
  const status = err.status || 500;

  let message;
  if (process.env.NODE_ENV !== 'production') {
    // Full detail in development/test
    message = err.message || 'Internal server error';
  } else if (err.expose === true && err.message) {
    // Explicitly marked safe by the application (e.g. res.status(400) with a user-facing message)
    message = err.message;
  } else {
    // In production sanitize everything — use a generic label per status code
    message = CLIENT_ERROR_MESSAGES[status] || 'Internal server error';
  }

  res.status(status).json({ error: message });
}

module.exports = { errorHandler };
