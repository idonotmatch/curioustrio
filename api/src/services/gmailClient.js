const crypto = require('crypto');
const { google } = require('googleapis');
const OAuthToken = require('../models/oauthToken');
const db = require('../db');

const GMAIL_SEARCH_QUERY = [
  'newer_than:30d',
  '-category:promotions',
  '-category:social',
  '(',
  'subject:(receipt OR order OR "order:" OR confirmation OR purchase OR invoice OR payment OR refund OR return OR renewal OR booking OR subscription OR trip)',
  'OR',
  '"order total"',
  'OR',
  '"total charged"',
  'OR',
  '"payment received"',
  'OR',
  '"receipt for your payment"',
  'OR',
  '"ride receipt"',
  'OR',
  '"your ride"',
  'OR',
  '"thanks for riding"',
  'OR',
  'from:(orders@amazon.com)',
  'OR',
  'from:(auto-confirm@amazon.com)',
  'OR',
  '(from:(amazon.com) subject:"ORDER:")',
  'OR',
  'from:(uber.com)',
  'OR',
  'from:(lyftmail.com)',
  ')',
].join(' ');

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
    q: GMAIL_SEARCH_QUERY,
  });
  return response.data.messages || [];
}

function decodeHtmlEntities(html = '') {
  return html
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function htmlToReadableText(html = '') {
  if (!html) return '';
  return decodeHtmlEntities(html)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n')
    .replace(/<\s*\/div\s*>/gi, '\n')
    .replace(/<\s*\/tr\s*>/gi, '\n')
    .replace(/<\s*(td|th)\b[^>]*>/gi, ' ')
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function countLineMatches(text = '', pattern) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => pattern.test(line)).length;
}

function bodyRichnessScore(text = '') {
  const normalized = `${text || ''}`.trim();
  if (!normalized) return 0;

  const lines = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const moneyLines = countLineMatches(normalized, /\$\s?-?\d+(?:\.\d{2})?/);
  const quantityLines = countLineMatches(normalized, /^(?:qty|quantity)?\s*x?\s*\d+\b/i);
  const skuLines = countLineMatches(normalized, /^[A-Z0-9-]{5,}$/);
  const summaryLines = countLineMatches(normalized, /^(subtotal|total|order total|amount paid|amount charged|grand total|estimated total|shipping|tax)/i);
  const productLikeLines = countLineMatches(normalized, /[a-z]/i)
    - summaryLines;

  return (
    Math.min(lines.length, 60) * 1
    + Math.min(productLikeLines, 24) * 2
    + Math.min(moneyLines, 16) * 3
    + Math.min(quantityLines, 12) * 3
    + Math.min(skuLines, 12) * 4
    - Math.min(summaryLines, 12) * 1
  );
}

function chooseBestMessageBody(plainText = '', htmlText = '', snippet = '') {
  const normalizedPlain = `${plainText || ''}`.trim();
  const normalizedHtml = `${htmlText || ''}`.trim();
  if (!normalizedPlain) return normalizedHtml || snippet || '';
  if (!normalizedHtml) return normalizedPlain || snippet || '';

  const plainScore = bodyRichnessScore(normalizedPlain);
  const htmlScore = bodyRichnessScore(normalizedHtml);

  if (htmlScore >= plainScore + 8) {
    return normalizedHtml;
  }
  return normalizedPlain;
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
  const snippet = response.data.snippet || '';
  const receivedAt = response.data.internalDate
    ? new Date(Number(response.data.internalDate)).toISOString().split('T')[0]
    : null;
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

  const normalizedPlain = plainBody
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const normalizedHtml = htmlToReadableText(htmlBody);
  const body = chooseBestMessageBody(normalizedPlain, normalizedHtml, snippet);

  return { subject, from, snippet, body, receivedAt };
}

module.exports = {
  GMAIL_SEARCH_QUERY,
  getAuthUrl,
  exchangeCode,
  getAuthenticatedClient,
  listRecentMessages,
  getMessage,
  htmlToReadableText,
  chooseBestMessageBody,
  bodyRichnessScore,
};
