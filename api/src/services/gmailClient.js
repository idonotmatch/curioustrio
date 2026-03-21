const { google } = require('googleapis');
const OAuthToken = require('../models/oauthToken');

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl() {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    prompt: 'consent',
  });
}

async function exchangeCode(code) {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    scope: tokens.scope,
  };
}

async function getAuthenticatedClient(userId) {
  const tokenRow = await OAuthToken.findByUserId(userId);
  if (!tokenRow) throw new Error('Gmail not connected for this user');

  const client = createOAuth2Client();
  client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
    expiry_date: tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : undefined,
  });

  // Auto-refresh if token expires within 5 minutes
  const expiresAt = tokenRow.expires_at ? new Date(tokenRow.expires_at) : null;
  if (!expiresAt || expiresAt < new Date(Date.now() + 5 * 60 * 1000)) {
    const { credentials } = await client.refreshAccessToken();
    await OAuthToken.upsert({
      userId,
      accessToken: credentials.access_token,
      refreshToken: credentials.refresh_token || tokenRow.refresh_token,
      expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
      scope: tokenRow.scope,
    });
    client.setCredentials(credentials);
  }

  return client;
}

async function listRecentMessages(userId, maxResults = 50) {
  const auth = await getAuthenticatedClient(userId);
  const gmail = google.gmail({ version: 'v1', auth });
  const response = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    q: 'subject:(receipt OR order OR confirmation OR purchase) newer_than:30d',
  });
  return response.data.messages || [];
}

async function getMessage(userId, messageId) {
  const auth = await getAuthenticatedClient(userId);
  const gmail = google.gmail({ version: 'v1', auth });
  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const payload = response.data.payload;
  const headers = payload?.headers || [];
  const subject = headers.find(h => h.name === 'Subject')?.value || '';
  const from = headers.find(h => h.name === 'From')?.value || '';

  let body = '';
  function extractBody(part) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      body += Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
    if (part.parts) part.parts.forEach(extractBody);
  }
  if (payload) extractBody(payload);

  return { subject, from, body };
}

module.exports = { getAuthUrl, exchangeCode, getAuthenticatedClient, listRecentMessages, getMessage };
