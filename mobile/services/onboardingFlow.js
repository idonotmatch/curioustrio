function getAuthProvider(sessionUser) {
  if (!sessionUser || typeof sessionUser !== 'object') return null;

  const directProvider = sessionUser.app_metadata?.provider || null;
  if (directProvider) return directProvider;

  if (Array.isArray(sessionUser.identities)) {
    const firstIdentity = sessionUser.identities.find((identity) => identity?.provider);
    if (firstIdentity?.provider) return firstIdentity.provider;
  }

  return null;
}

function shouldOfferGoogleGmailConnect({ isAnonymous, authProvider, gmailConnected }) {
  return isAnonymous !== true && authProvider === 'google' && gmailConnected !== true;
}

function getOnboardingProgress({ step, setupMode, shouldOfferGmailStep }) {
  const totalSteps = setupMode === 'solo'
    ? (shouldOfferGmailStep ? 3 : 2)
    : (shouldOfferGmailStep ? 4 : 3);

  switch (step) {
    case 'path':
    case 'account':
      return { step: 1, totalSteps };
    case 'name':
    case 'join':
      return { step: 2, totalSteps };
    case 'gmail':
      return { step: setupMode === 'solo' ? 2 : 3, totalSteps };
    case 'firstAction':
      return { step: totalSteps, totalSteps };
    default:
      return { step: 1, totalSteps };
  }
}

module.exports = {
  getAuthProvider,
  getOnboardingProgress,
  shouldOfferGoogleGmailConnect,
};
