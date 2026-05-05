const assert = require('assert');
const {
  getAuthProvider,
  getOnboardingProgress,
  shouldOfferGoogleGmailConnect,
} = require('../services/onboardingFlow');

function run() {
  assert.strictEqual(
    getAuthProvider({
      app_metadata: { provider: 'google' },
    }),
    'google',
    'should read provider from app metadata first'
  );

  assert.strictEqual(
    getAuthProvider({
      identities: [{ provider: 'apple' }],
    }),
    'apple',
    'should fall back to linked identities when needed'
  );

  assert.strictEqual(
    shouldOfferGoogleGmailConnect({
      isAnonymous: false,
      authProvider: 'google',
      gmailConnected: false,
    }),
    true,
    'signed-in Google users without Gmail connected should get the connect step'
  );

  assert.strictEqual(
    shouldOfferGoogleGmailConnect({
      isAnonymous: false,
      authProvider: 'apple',
      gmailConnected: false,
    }),
    false,
    'non-Google providers should not be forced through the Google-specific connect step'
  );

  assert.deepStrictEqual(
    getOnboardingProgress({
      step: 'gmail',
      setupMode: 'solo',
      shouldOfferGmailStep: true,
    }),
    { step: 2, totalSteps: 3 },
    'solo Google users should see Gmail as the middle onboarding step'
  );

  assert.deepStrictEqual(
    getOnboardingProgress({
      step: 'firstAction',
      setupMode: 'create_household',
      shouldOfferGmailStep: true,
    }),
    { step: 4, totalSteps: 4 },
    'shared setup plus Gmail should show the last step correctly'
  );

  process.stdout.write('[mobile-logic] onboarding flow checks passed\n');
}

run();
