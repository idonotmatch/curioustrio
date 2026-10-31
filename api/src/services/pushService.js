const https = require('https');
const BackgroundJob = require('../models/backgroundJob');
const NotificationDelivery = require('../models/notificationDelivery');
const PushToken = require('../models/pushToken');
const { captureException } = require('./observability');

const EXPO_HOST = 'exp.host';
const MAX_BATCH_SIZE = 100;
const REQUEST_TIMEOUT_MS = 15000;
const RECEIPT_DELAY_MS = 15 * 60 * 1000;
// InvalidCredentials is an app-level APNs/FCM configuration problem. Only
// DeviceNotRegistered proves that this particular device token is unusable.
const PERMANENT_TOKEN_ERRORS = new Set(['DeviceNotRegistered']);

function postExpoJson(path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request({
      hostname: EXPO_HOST,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json',
      },
    }, (response) => {
      let responseBody = '';
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => {
        let parsed = null;
        try {
          parsed = responseBody ? JSON.parse(responseBody) : {};
        } catch {
          const error = new Error('Expo push service returned an invalid response');
          error.code = 'expo_invalid_response';
          return reject(error);
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(`Expo push service returned HTTP ${response.statusCode}`);
          error.code = 'expo_http_error';
          error.status = response.statusCode;
          error.response = parsed;
          return reject(error);
        }
        return resolve(parsed);
      });
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(Object.assign(new Error('Expo push request timed out'), { code: 'expo_timeout' }));
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function chunks(values, size = MAX_BATCH_SIZE) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function normalizeTickets(response, expectedCount) {
  const data = response?.data;
  const tickets = Array.isArray(data) ? data : data ? [data] : [];
  return Array.from({ length: expectedCount }, (_, index) => tickets[index] || {
    status: 'error',
    message: 'Expo did not return a ticket for this notification',
    details: { error: 'MissingTicket' },
  });
}

function publicMessage(message = {}) {
  const { pushTokenId, ...payload } = message;
  return payload;
}

function ticketError(ticket = {}) {
  return {
    code: `${ticket?.details?.error || 'ExpoRejected'}`.slice(0, 100),
    message: `${ticket?.message || 'Expo rejected the notification'}`.slice(0, 500),
  };
}

async function recordTicket({ message, ticket, userId, category, notificationKey, metadata }) {
  const accepted = ticket?.status === 'ok' && !!ticket?.id;
  const error = accepted ? null : ticketError(ticket);
  let delivery = null;

  if (userId && category) {
    delivery = await NotificationDelivery.create({
      userId,
      pushTokenId: message.pushTokenId || null,
      category,
      notificationKey,
      expoTicketId: accepted ? ticket.id : null,
      status: accepted ? 'accepted' : 'failed',
      errorCode: error?.code || null,
      errorMessage: error?.message || null,
      metadata,
    });
  }

  if (!accepted && PERMANENT_TOKEN_ERRORS.has(error.code) && message.pushTokenId) {
    await PushToken.disable(message.pushTokenId, error.code);
  }

  if (accepted && delivery?.id) {
    await BackgroundJob.enqueue({
      jobType: BackgroundJob.JOB_TYPES.pushReceipt,
      dedupeKey: delivery.id,
      payload: { delivery_id: delivery.id, ticket_id: ticket.id },
      delayMs: RECEIPT_DELAY_MS,
      maxAttempts: 5,
    });
  }

  return {
    accepted,
    ticketId: accepted ? ticket.id : null,
    error,
    deliveryId: delivery?.id || null,
  };
}

async function recordTransportFailure({ message, error, userId, category, notificationKey, metadata }) {
  const failure = {
    code: `${error?.code || 'expo_transport_error'}`.slice(0, 100),
    message: `${error?.message || 'Expo push request failed'}`.slice(0, 500),
  };
  let delivery = null;
  if (userId && category) {
    delivery = await NotificationDelivery.create({
      userId,
      pushTokenId: message.pushTokenId || null,
      category,
      notificationKey,
      status: 'failed',
      errorCode: failure.code,
      errorMessage: failure.message,
      metadata,
    });
  }
  return {
    accepted: false,
    ticketId: null,
    error: failure,
    deliveryId: delivery?.id || null,
  };
}

async function sendNotifications(messages, {
  userId = null,
  category = null,
  notificationKey = null,
  metadata = {},
  transport = postExpoJson,
} = {}) {
  if (!Array.isArray(messages) || !messages.length) {
    return { accepted: 0, rejected: 0, results: [] };
  }

  const results = [];
  for (const batch of chunks(messages)) {
    let response;
    try {
      response = await transport('/--/api/v2/push/send', batch.map(publicMessage));
    } catch (error) {
      captureException(error, { area: 'push_transport', category });
      for (const message of batch) {
        try {
          results.push(await recordTransportFailure({
            message,
            error,
            userId,
            category,
            notificationKey,
            metadata,
          }));
        } catch (recordError) {
          captureException(recordError, { area: 'push_delivery_record', category });
          results.push({
            accepted: false,
            ticketId: null,
            error: { code: `${error?.code || 'expo_transport_error'}` },
          });
        }
      }
      continue;
    }
    const tickets = normalizeTickets(response, batch.length);
    for (let index = 0; index < batch.length; index += 1) {
      try {
        results.push(await recordTicket({
          message: batch[index],
          ticket: tickets[index],
          userId,
          category,
          notificationKey,
          metadata,
        }));
      } catch (error) {
        captureException(error, { area: 'push_delivery_record', category });
        results.push({ accepted: false, ticketId: null, error: { code: 'delivery_record_failed' } });
      }
    }
  }

  return {
    accepted: results.filter((result) => result.accepted).length,
    rejected: results.filter((result) => !result.accepted).length,
    results,
  };
}

async function reconcilePushReceipt(payload = {}, { transport = postExpoJson } = {}) {
  const deliveryId = `${payload.delivery_id || ''}`.trim();
  const ticketId = `${payload.ticket_id || ''}`.trim();
  if (!deliveryId || !ticketId) throw new Error('Push receipt job is missing delivery or ticket id');

  const delivery = await NotificationDelivery.findById(deliveryId);
  if (!delivery || delivery.status !== 'accepted') return { skipped: true };

  const response = await transport('/--/api/v2/push/getReceipts', { ids: [ticketId] });
  const receipt = response?.data?.[ticketId];
  if (!receipt) {
    const error = new Error('Expo push receipt is not ready');
    error.code = 'push_receipt_pending';
    throw error;
  }

  if (receipt.status === 'ok') {
    await NotificationDelivery.markResult(deliveryId, { status: 'delivered' });
    return { delivered: true };
  }

  const error = ticketError(receipt);
  await NotificationDelivery.markResult(deliveryId, {
    status: 'failed',
    errorCode: error.code,
    errorMessage: error.message,
  });
  if (PERMANENT_TOKEN_ERRORS.has(error.code) && delivery.push_token_id) {
    await PushToken.disable(delivery.push_token_id, error.code);
  }
  return { delivered: false, error_code: error.code };
}

module.exports = {
  PERMANENT_TOKEN_ERRORS,
  normalizeTickets,
  postExpoJson,
  reconcilePushReceipt,
  sendNotifications,
};
