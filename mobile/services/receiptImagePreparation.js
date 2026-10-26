const RECEIPT_IMAGE_MAX_BASE64_LENGTH = 2_850_000;
const SUPPORTED_RECEIPT_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function boundedWidth(sourceWidth, targetWidth) {
  const width = Number(sourceWidth);
  if (!Number.isFinite(width) || width <= 0) return targetWidth;
  return Math.min(Math.round(width), targetWidth);
}

function primaryReceiptImagePlan(asset = {}) {
  const width = Number(asset.width);
  const height = Number(asset.height);
  const isTallReceipt = Number.isFinite(width) && width > 0
    && Number.isFinite(height) && height / width >= 2;

  return {
    width: boundedWidth(width, isTallReceipt ? 2100 : 1800),
    compress: isTallReceipt ? 0.78 : 0.72,
    is_tall_receipt: isTallReceipt,
  };
}

function fallbackReceiptImagePlan(asset = {}) {
  return {
    width: boundedWidth(asset.width, 1450),
    compress: 0.58,
    is_tall_receipt: false,
  };
}

function emergencyReceiptImagePlan(asset = {}) {
  return {
    width: boundedWidth(asset.width, 1100),
    compress: 0.42,
    is_tall_receipt: false,
  };
}

function normalizeReceiptBase64(value) {
  const input = `${value || ''}`.trim();
  if (!input) return '';
  const dataUrlMatch = input.match(/^data:([^;,]+);base64,(.*)$/is);
  return (dataUrlMatch ? dataUrlMatch[2] : input).replace(/\s+/g, '');
}

function inferReceiptMediaType(asset = {}) {
  const declared = `${asset.mimeType || asset.type || ''}`.trim().toLowerCase();
  if (SUPPORTED_RECEIPT_MEDIA_TYPES.has(declared)) return declared;
  const name = `${asset.fileName || asset.name || asset.uri || ''}`.toLowerCase();
  if (/\.png(?:$|\?)/.test(name)) return 'image/png';
  if (/\.gif(?:$|\?)/.test(name)) return 'image/gif';
  if (/\.webp(?:$|\?)/.test(name)) return 'image/webp';
  if (/\.jpe?g(?:$|\?)/.test(name)) return 'image/jpeg';
  return declared || null;
}

function isSupportedReceiptMediaType(mediaType) {
  return SUPPORTED_RECEIPT_MEDIA_TYPES.has(`${mediaType || ''}`.trim().toLowerCase());
}

module.exports = {
  RECEIPT_IMAGE_MAX_BASE64_LENGTH,
  emergencyReceiptImagePlan,
  fallbackReceiptImagePlan,
  inferReceiptMediaType,
  isSupportedReceiptMediaType,
  normalizeReceiptBase64,
  primaryReceiptImagePlan,
};
