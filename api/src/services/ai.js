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

function withTimeout(promise, { service, timeoutMs, onTimeout = null }) {
  if (!vendorTimeoutsEnabled() || !timeoutMs) return promise;
  let timeoutHandle = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      if (typeof onTimeout === 'function') onTimeout();
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
  const controller = new AbortController();
  const response = await withTimeout(client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: maxTokens,
    system,
    messages,
  }, {
    signal: controller.signal,
  }), {
    service: 'anthropic_text',
    timeoutMs: textModelTimeoutMs(),
    onTimeout: () => controller.abort(),
  });
  return response.content?.[0]?.text?.trim() || null;
}

function isOutputSchemaValidationError(error) {
  const message = [error?.message, error?.error?.message]
    .filter(Boolean)
    .join(' ');
  const status = Number(error?.status) || (message.startsWith('400 ') ? 400 : null);
  return status === 400
    && /(?:output_config\.format\.schema|invalid schema)/i.test(message);
}

async function createImageCompletion(request) {
  const controller = new AbortController();
  return withTimeout(client.messages.create(request, {
    signal: controller.signal,
  }), {
    service: 'anthropic_image',
    timeoutMs: imageModelTimeoutMs(),
    onTimeout: () => controller.abort(),
  });
}

/**
 * Complete a prompt with an image attachment.
 * @param {{ system: string, imageBase64: string, mediaType?: string, text: string, maxTokens?: number }} opts
 * @returns {Promise<string|null>}
 */
async function completeWithImageDetailed({
  system,
  imageBase64,
  mediaType = 'image/jpeg',
  text,
  maxTokens = 512,
  outputSchema = null,
}) {
  const request = {
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
    ...(outputSchema ? {
      output_config: {
        format: {
          type: 'json_schema',
          schema: outputSchema,
        },
      },
    } : {}),
  };

  let response;
  let schemaFallbackUsed = false;
  try {
    response = await createImageCompletion(request);
  } catch (error) {
    if (!outputSchema || !isOutputSchemaValidationError(error)) throw error;
    const { output_config: _invalidOutputConfig, ...requestWithoutSchema } = request;
    response = await createImageCompletion(requestWithoutSchema);
    schemaFallbackUsed = true;
  }
  const textBlock = response.content?.find((block) => block?.type === 'text')
    || response.content?.find((block) => typeof block?.text === 'string');
  return {
    text: textBlock?.text?.trim() || null,
    model: response.model || DEFAULT_MODEL,
    stop_reason: response.stop_reason || null,
    schema_fallback_used: schemaFallbackUsed,
    usage: {
      input_tokens: Number(response.usage?.input_tokens) || 0,
      output_tokens: Number(response.usage?.output_tokens) || 0,
      cache_creation_input_tokens: Number(response.usage?.cache_creation_input_tokens) || 0,
      cache_read_input_tokens: Number(response.usage?.cache_read_input_tokens) || 0,
    },
  };
}

async function completeWithImage(options) {
  const result = await completeWithImageDetailed(options);
  return result.text;
}

module.exports = {
  complete,
  completeWithImage,
  completeWithImageDetailed,
  VendorTimeoutError,
  isOutputSchemaValidationError,
  withTimeout,
};
