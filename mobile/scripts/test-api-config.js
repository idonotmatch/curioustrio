const assert = require('assert');
const {
  buildCandidateBaseUrls,
  deriveExpoHostBaseUrlsFromCandidates,
  missingApiBaseUrlMessage,
} = require('../services/apiConfig');

function run() {
  assert.deepStrictEqual(
    buildCandidateBaseUrls({
      explicitBaseUrl: 'https://api.example.com',
      allowLocalFallback: false,
      expoHostCandidates: ['exp://10.0.0.8:8081'],
      localBaseUrls: ['http://127.0.0.1:3001'],
    }),
    ['https://api.example.com'],
    'explicit release API URL should win outright'
  );

  assert.deepStrictEqual(
    deriveExpoHostBaseUrlsFromCandidates(['exp://10.0.0.8:8081']),
    ['http://10.0.0.8:3001', 'http://10.0.0.8:3002'],
    'dev Expo host should derive LAN API candidates'
  );

  assert.deepStrictEqual(
    buildCandidateBaseUrls({
      explicitBaseUrl: null,
      allowLocalFallback: false,
      expoHostCandidates: ['exp://10.0.0.8:8081'],
      localBaseUrls: ['http://127.0.0.1:3001'],
    }),
    [],
    'release builds without EXPO_PUBLIC_API_URL should not silently fall back to localhost'
  );

  assert.strictEqual(
    missingApiBaseUrlMessage({ allowLocalFallback: false, explicitBaseUrl: null }),
    'This build is missing EXPO_PUBLIC_API_URL. Set it before shipping a user-ready build.',
    'release config error should be explicit'
  );

  assert.strictEqual(
    missingApiBaseUrlMessage({ allowLocalFallback: true, explicitBaseUrl: null }),
    null,
    'dev fallback mode should not emit a release config error'
  );

  process.stdout.write('[mobile-logic] api config checks passed\n');
}

run();
