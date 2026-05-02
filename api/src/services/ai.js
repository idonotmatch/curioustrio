const Anthropic = require('@anthropic-ai/sdk');
const {
  vendorTimeoutsEnabled,
  textModelTimeoutMs,
  imageModelTimeoutMs,
} = require('./parsingOptimizationConfig');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const DEFAULT_MODEL = process.env.AI_MODEL || 'claude-haiku-4-5-20251001';

class VendorTimeoutError extends Error {
  constructor(message, service, timeoutMs) {
    super(message);
    this.name = 'VendorTimeoutError';
    this.service = service;
    this.timeout_ms = timeoutMs;
  }
}

function withTimeout(promise, { service, timeoutMs }) {
  if (!vendorTimeoutsEnabled() || !timeoutMs) return promise;
  let timeoutHandle = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new VendorTimeoutError(`${service} timed out after ${timeoutMs}ms`, service, timeoutMs));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  });
}

/**
 * Complete a text-only prompt.
 * @param {{ system: string, messages: Array, maxTokens?: number }} opts
 * @returns {Promise<string|null>} The response text, or null if empty
 */
async function complete({ system, messages, maxTokens = 512 }) {
  const response = await withTimeout(client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: maxTokens,
    system,
    messages,
  }), {
    service: 'anthropic_text',
    timeoutMs: textModelTimeoutMs(),
  });
  return response.content?.[0]?.text?.trim() || null;
}

/**
 * Complete a prompt with an image attachment.
 * @param {{ system: string, imageBase64: string, mediaType?: string, text: string, maxTokens?: number }} opts
 * @returns {Promise<string|null>}
 */
async function completeWithImage({ system, imageBase64, mediaType = 'image/jpeg', text, maxTokens = 512 }) {
  const response = await withTimeout(client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text },
      ],
    }],
  }), {
    service: 'anthropic_image',
    timeoutMs: imageModelTimeoutMs(),
  });
  return response.content?.[0]?.text?.trim() || null;
}

module.exports = { complete, completeWithImage, VendorTimeoutError, withTimeout };
