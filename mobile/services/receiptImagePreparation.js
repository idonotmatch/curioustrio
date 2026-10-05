const RECEIPT_IMAGE_MAX_BASE64_LENGTH = 2_850_000;

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

module.exports = {
  RECEIPT_IMAGE_MAX_BASE64_LENGTH,
  fallbackReceiptImagePlan,
  primaryReceiptImagePlan,
};
