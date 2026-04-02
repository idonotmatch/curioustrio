const crypto = require('crypto');
const { google } = require('googleapis');
const OAuthToken = require('../models/oauthToken');
const db = require('../db');

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

async function getAuthUrl(userId) {
  const stateToken = crypto.randomUUID();
  await db.query(
    `INSERT INTO gmail_oauth_states (token, user_id) VALUES ($1, $2)`, [stateToken, userId]
  );
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    prompt: 'consent',
    state: stateToken,
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
    refresh_token: tokenRow.refresh_token,
  });

  // Always refresh — access_token is never persisted, so always fetch a fresh one
  const { credentials } = await client.refreshAccessToken();
  await OAuthToken.upsert({
    userId,
    accessToken: null,       // do not persist
    refreshToken: credentials.refresh_token || tokenRow.refresh_token,
    expiresAt: null,
    scope: tokenRow.scope,
  });
  client.setCredentials(credentials); // in-memory only, valid for this request

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

  let plainBody = '';
  let htmlBody = '';
  function extractBody(part) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      plainBody += Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      htmlBody += Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
    if (part.parts) part.parts.forEach(extractBody);
  }
  if (payload) extractBody(payload);

  // Prefer plain text; fall back to HTML with tags stripped
  const body = plainBody.trim()
    ? plainBody
    : htmlBody.replace(/<[^>]*>/g, ' ').replace(/\s{2,}/g, ' ').trim();

  return { subject, from, body };
}

module.exports = { getAuthUrl, exchangeCode, getAuthenticatedClient, listRecentMessages, getMessage };
