const path = require('path');
const { getAdminClient, supabaseAdminConfigured } = require('./supabaseAdminService');

const DEFAULT_BUCKET = 'receipt-scan-inputs';
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
let bucketPromise = null;

function storageBucket() {
  return `${process.env.RECEIPT_SCAN_STORAGE_BUCKET || DEFAULT_BUCKET}`.trim();
}

function storageError(message, sourceError) {
  const error = new Error(message);
  error.status = 503;
  error.expose = true;
  error.reason_code = 'receipt_storage_unavailable';
  error.cause = sourceError;
  return error;
}

async function ensurePrivateBucket() {
  if (!supabaseAdminConfigured()) {
    throw storageError('Receipt processing storage is not configured');
  }
  if (!bucketPromise) {
    bucketPromise = (async () => {
      const client = getAdminClient();
      const bucket = storageBucket();
      const { data, error } = await client.storage.getBucket(bucket);
      if (data && !error) {
        if (data.public) {
          const secured = await client.storage.updateBucket(bucket, {
            public: false,
            fileSizeLimit: 8 * 1024 * 1024,
            allowedMimeTypes: ALLOWED_MIME_TYPES,
          });
          if (secured.error) throw storageError('Receipt processing storage is not private', secured.error);
        }
        return bucket;
      }
      const missing = error && (error.status === 404 || /not found/i.test(`${error.message || ''}`));
      if (!missing) throw storageError('Could not verify receipt processing storage', error);
      const created = await client.storage.createBucket(bucket, {
        public: false,
        fileSizeLimit: 8 * 1024 * 1024,
        allowedMimeTypes: ALLOWED_MIME_TYPES,
      });
      if (created.error) throw storageError('Could not initialize receipt processing storage', created.error);
      return bucket;
    })().catch((error) => {
      bucketPromise = null;
      throw error;
    });
  }
  return bucketPromise;
}

function extensionFor(endpoint, mediaType, fileName) {
  if (endpoint === 'document') return '.pdf';
  const byType = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
  };
  return byType[mediaType] || path.extname(`${fileName || ''}`).toLowerCase() || '.jpg';
}

async function storeReceiptScanInput({ userId, jobId, endpoint, base64, mediaType, fileName }) {
  const bucket = await ensurePrivateBucket();
  const objectPath = `${userId}/${jobId}${extensionFor(endpoint, mediaType, fileName)}`;
  const contentType = endpoint === 'document' ? 'application/pdf' : mediaType;
  const bytes = Buffer.from(base64, 'base64');
  const client = getAdminClient();
  const { error } = await client.storage.from(bucket).upload(objectPath, bytes, {
    contentType,
    upsert: false,
    cacheControl: '0',
  });
  if (error) throw storageError('Could not securely stage this receipt for processing', error);
  return { bucket, path: objectPath };
}

async function loadReceiptScanInput({ bucket, path: objectPath }) {
  const client = getAdminClient();
  const { data, error } = await client.storage.from(bucket).download(objectPath);
  if (error || !data) throw storageError('Could not load the staged receipt', error);
  const bytes = Buffer.from(await data.arrayBuffer());
  return bytes.toString('base64');
}

async function deleteReceiptScanInput({ bucket, path: objectPath }) {
  if (!bucket || !objectPath || !supabaseAdminConfigured()) return false;
  const client = getAdminClient();
  const { error } = await client.storage.from(bucket).remove([objectPath]);
  if (error) throw storageError('Could not delete the staged receipt', error);
  return true;
}

module.exports = {
  deleteReceiptScanInput,
  ensurePrivateBucket,
  loadReceiptScanInput,
  storageBucket,
  storeReceiptScanInput,
};
