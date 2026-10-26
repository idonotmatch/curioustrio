const MAX_RECEIPT_BASE64_LENGTH = 3_000_000;
const SUPPORTED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function inputError(status, reasonCode, message) {
  return Object.assign(new Error(message), {
    status,
    reason_code: reasonCode,
    expose: true,
  });
}

function detectImageMediaType(data) {
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function normalizeReceiptImageInput({ imageBase64, mediaType = null } = {}) {
  if (typeof imageBase64 !== 'string' || !imageBase64.trim()) {
    throw inputError(400, 'image_required', 'Receipt image is required');
  }

  const input = imageBase64.trim();
  const dataUrlMatch = input.match(/^data:([^;,]+);base64,(.*)$/is);
  const normalizedMediaType = `${mediaType || dataUrlMatch?.[1] || 'image/jpeg'}`.trim().toLowerCase();
  const data = `${dataUrlMatch?.[2] || input}`.replace(/\s+/g, '');

  if (!SUPPORTED_MEDIA_TYPES.has(normalizedMediaType)) {
    throw inputError(415, 'unsupported_image_type', 'Receipt image must be JPEG, PNG, GIF, or WebP');
  }
  if (data.length > MAX_RECEIPT_BASE64_LENGTH) {
    throw inputError(413, 'payload_too_large', 'Receipt image is too large');
  }
  if (!data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 === 1) {
    throw inputError(400, 'invalid_image_data', 'Receipt image data is invalid');
  }

  const detectedMediaType = detectImageMediaType(data);
  if (!detectedMediaType || detectedMediaType !== normalizedMediaType) {
    throw inputError(400, 'invalid_image_data', 'Receipt image data does not match its image format');
  }

  return { imageBase64: data, mediaType: normalizedMediaType };
}

module.exports = {
  MAX_RECEIPT_BASE64_LENGTH,
  SUPPORTED_MEDIA_TYPES,
  detectImageMediaType,
  normalizeReceiptImageInput,
};
