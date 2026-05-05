const Linking = require('expo-linking');
const WebBrowser = require('expo-web-browser');
const { api } = require('./api');

async function startGmailConnectFlow({ redirectPath = '/gmail-import' } = {}) {
  const data = await api.get('/gmail/auth');
  if (!data?.url) {
    throw new Error('Could not start Gmail connection');
  }

  const redirectUrl = Linking.createURL(redirectPath);
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
  const completed = result?.type === 'success' || result?.type === 'opened';

  return {
    completed,
    result,
  };
}

module.exports = {
  startGmailConnectFlow,
};
