const {
  MAX_RECEIPT_BASE64_LENGTH,
  normalizeReceiptImageInput,
} = require('../../src/services/receiptImageInput');

describe('receiptImageInput', () => {
  it('normalizes a data URL and uses its media type', () => {
    const pngHeader = 'iVBORw0KGgo=';
    expect(normalizeReceiptImageInput({ imageBase64: `data:image/png;base64,${pngHeader}` })).toEqual({
      imageBase64: pngHeader,
      mediaType: 'image/png',
    });
  });

  it('rejects malformed base64 before calling the image model', () => {
    expect(() => normalizeReceiptImageInput({ imageBase64: 'not base64!' })).toThrow(expect.objectContaining({
      status: 400,
      reason_code: 'invalid_image_data',
    }));
  });

  it('rejects image formats unsupported by the model', () => {
    expect(() => normalizeReceiptImageInput({ imageBase64: '/9j/2Q==', mediaType: 'image/heic' })).toThrow(expect.objectContaining({
      status: 415,
      reason_code: 'unsupported_image_type',
    }));
  });

  it('rejects oversized images with a stable reason code', () => {
    expect(() => normalizeReceiptImageInput({ imageBase64: 'A'.repeat(MAX_RECEIPT_BASE64_LENGTH + 4) })).toThrow(expect.objectContaining({
      status: 413,
      reason_code: 'payload_too_large',
    }));
  });
});
