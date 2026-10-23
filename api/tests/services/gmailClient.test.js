jest.mock('node-fetch', () => jest.fn());
const mockGmailList = jest.fn();
const mockGmailGet = jest.fn();
const mockGmailGetProfile = jest.fn();
const mockGmailHistoryList = jest.fn();
const mockGmailAttachmentGet = jest.fn();
const mockRefreshAccessToken = jest.fn();
const mockSetCredentials = jest.fn();
const mockOAuth2 = jest.fn(() => ({
  transporter: { defaults: {} },
  setCredentials: mockSetCredentials,
  refreshAccessToken: mockRefreshAccessToken,
}));
const mockGoogleGmail = jest.fn(() => ({
  users: {
    getProfile: mockGmailGetProfile,
    history: { list: mockGmailHistoryList },
    messages: {
      list: mockGmailList,
      get: mockGmailGet,
      attachments: { get: mockGmailAttachmentGet },
    },
  },
}));
jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: mockOAuth2 },
    gmail: mockGoogleGmail,
  },
}));
jest.mock('../../src/models/oauthToken', () => ({
  findCredentialsByUserId: jest.fn(),
  upsert: jest.fn(),
  deleteByUserId: jest.fn(),
}));
jest.mock('../../src/db', () => ({
  query: jest.fn(),
}));

const fetch = require('node-fetch');
const OAuthToken = require('../../src/models/oauthToken');
const db = require('../../src/db');
const {
  htmlToReadableText,
  GMAIL_SEARCH_QUERY,
  chooseBestMessageBody,
  bodyRichnessScore,
  createGmailSession,
  disconnectGmailConnection,
  listHistoryMessages,
  getMessage,
  extractStructuredHtmlEvidence,
} = require('../../src/services/gmailClient');

describe('gmailClient helpers', () => {
  it('broadens the Gmail search query beyond basic receipt subjects', () => {
    expect(GMAIL_SEARCH_QUERY).toContain('invoice');
    expect(GMAIL_SEARCH_QUERY).toContain('renewal');
    expect(GMAIL_SEARCH_QUERY).toContain('subject:"ORDER:"');
    expect(GMAIL_SEARCH_QUERY).toContain('"ride receipt"');
    expect(GMAIL_SEARCH_QUERY).toContain('from:(uber.com)');
    expect(GMAIL_SEARCH_QUERY).toContain('from:(lyftmail.com)');
    expect(GMAIL_SEARCH_QUERY).toContain('from:(venmo.com)');
    expect(GMAIL_SEARCH_QUERY).toContain('"you paid"');
    expect(GMAIL_SEARCH_QUERY).toContain('from:(auto-confirm@amazon.com)');
    expect(GMAIL_SEARCH_QUERY).toContain('-category:promotions');
    expect(GMAIL_SEARCH_QUERY).toContain('-category:social');
  });

  it('turns transactional HTML into readable text', () => {
    const html = `
      <div>Thanks for your order</div>
      <table>
        <tr><td>Order total</td><td>$42.15</td></tr>
      </table>
      <div>Shipped soon</div>
    `;
    const text = htmlToReadableText(html);
    expect(text).toContain('Thanks for your order');
    expect(text).toContain('Order total $42.15');
    expect(text).toContain('Shipped soon');
  });

  it('extracts order identity, totals, and items from receipt JSON-LD', () => {
    const html = `<script type="application/ld+json">
      {
        "@type": "Order",
        "orderNumber": "BB-1042",
        "seller": { "name": "Bobby Boy Bakeshop" },
        "priceCurrency": "USD",
        "totalPrice": "27.10",
        "orderedItem": [{
          "orderQuantity": 2,
          "itemOffered": { "name": "Croissant" },
          "price": "9.00"
        }]
      }
    </script>`;

    expect(extractStructuredHtmlEvidence(html)).toContain('Order ID: BB-1042');
    expect(extractStructuredHtmlEvidence(html)).toContain('Merchant: Bobby Boy Bakeshop');
    expect(extractStructuredHtmlEvidence(html)).toContain('Order total: USD 27.10');
    expect(extractStructuredHtmlEvidence(html)).toContain('Croissant');
  });

  it('loads text stored behind Gmail attachment IDs', async () => {
    mockGmailGet.mockResolvedValueOnce({
      data: {
        threadId: 'thread-1',
        snippet: 'Invoice attached',
        payload: {
          headers: [
            { name: 'Subject', value: 'Your invoice' },
            { name: 'From', value: 'billing@example.com' },
          ],
          mimeType: 'multipart/mixed',
          parts: [{
            filename: 'invoice.txt',
            mimeType: 'text/plain',
            body: { attachmentId: 'attachment-1', size: 42 },
          }],
        },
      },
    });
    mockGmailAttachmentGet.mockResolvedValueOnce({
      data: { data: Buffer.from('Order ID: A-42\nOrder total: $18.25').toString('base64url') },
    });

    await expect(getMessage('user-1', 'message-1', {
      gmailClient: mockGoogleGmail(),
    })).resolves.toEqual(expect.objectContaining({
      threadId: 'thread-1',
      attachmentCount: 1,
      attachmentTextCount: 1,
      body: expect.stringContaining('Order total: $18.25'),
    }));
    expect(mockGmailAttachmentGet).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'message-1',
      id: 'attachment-1',
    }), expect.any(Object));
  });

  it('extracts bounded PDF attachment text without persisting the file', async () => {
    const pdfTextExtractor = jest.fn().mockResolvedValue('Invoice #INV-9\nTotal $40.00');
    mockGmailGet.mockResolvedValueOnce({
      data: {
        snippet: 'Invoice attached',
        payload: {
          headers: [],
          parts: [{
            filename: 'invoice.pdf',
            mimeType: 'application/pdf',
            body: { attachmentId: 'pdf-1', size: 128 },
          }],
        },
      },
    });
    mockGmailAttachmentGet.mockResolvedValueOnce({
      data: { data: Buffer.from('%PDF-test').toString('base64url') },
    });

    const result = await getMessage('user-1', 'message-pdf', {
      gmailClient: mockGoogleGmail(),
      pdfTextExtractor,
    });

    expect(pdfTextExtractor).toHaveBeenCalledTimes(1);
    expect(result.body).toContain('Invoice #INV-9');
    expect(result.attachmentTextCount).toBe(1);
  });

  it('prefers the richer html body when plain text drops item structure', () => {
    const plain = `Subtotal
$107.95
Shipping and taxes
$8.96
Total
$116.91`;

    const htmlText = `ITEM DESCRIPTION
DAK - Plum Marmalade Espresso
DAK Coffee Roasters
COF-DA-0323
x 1
$19.99

DAK - House of Plum Espresso
DAK Coffee Roasters
COF-DA-0397
x 1
$21.99

Total
$107.95`;

    expect(bodyRichnessScore(htmlText)).toBeGreaterThan(bodyRichnessScore(plain));
    expect(chooseBestMessageBody(plain, htmlText, 'Total $107.95')).toBe(htmlText);
  });

  it('rejects css-heavy plain bodies in favor of readable html', () => {
    const plain = `/* What it does: Remove spaces around the email design */
html, body {
Margin: 0 auto !important;
padding: 0 !important;
width: 100% !important;
height: 100% !important;
}
.ExternalClass {
width: 100%;
}
*[x-apple-data-detectors],
.x-gmail-data-detectors,
.x-gmail-data-detectors *,
.aBn {
color: inherit !important;
text-decoration: none !important;
font-size: inherit !important;
font-family: inherit !important;
}
table,
th {
mso-table-lspace: 0pt;
mso-table-rspace: 0pt;
}`;

    const htmlText = `Order Confirmation
Order No. #RT-270233
21 April, 2026

Item Description
DAK - Plum Marmalade Espresso
DAK Coffee Roasters
COF-DA-0323
x 1
$19.99

DAK - House of Plum Espresso
DAK Coffee Roasters
COF-DA-0397
x 1
$21.99

DAK - Cream Donut Espresso
DAK Coffee Roasters
COF-DA-0377
x 1
$29.99

Subtotal
$107.95

Total
$107.95`;

    expect(bodyRichnessScore(htmlText)).toBeGreaterThan(bodyRichnessScore(plain));
    expect(chooseBestMessageBody(plain, htmlText, 'Order #RT-270233 confirmed')).toBe(htmlText);
  });
});

describe('createGmailSession', () => {
  beforeEach(() => {
    mockGmailList.mockReset();
    mockGmailGet.mockReset();
    mockGmailAttachmentGet.mockReset();
    mockRefreshAccessToken.mockReset();
    mockSetCredentials.mockReset();
    mockOAuth2.mockClear();
    mockGoogleGmail.mockClear();
    OAuthToken.findCredentialsByUserId.mockReset();
    OAuthToken.upsert.mockReset();
  });

  it('reuses one refreshed Gmail client for message listing and reads', async () => {
    OAuthToken.findCredentialsByUserId.mockResolvedValue({
      refresh_token: 'refresh-token',
      scope: 'gmail.readonly',
    });
    OAuthToken.upsert.mockResolvedValue({});
    mockRefreshAccessToken.mockResolvedValue({
      credentials: { access_token: 'access-token', expiry_date: Date.now() + 3600000 },
    });
    mockGmailList.mockResolvedValue({ data: { messages: [{ id: 'message-1' }] } });
    mockGmailGet.mockResolvedValue({
      data: {
        snippet: 'Order total $12.00',
        internalDate: `${Date.now()}`,
        payload: {
          headers: [
            { name: 'Subject', value: 'Order receipt' },
            { name: 'From', value: 'orders@example.com' },
          ],
          mimeType: 'text/plain',
          body: { data: Buffer.from('Order total $12.00').toString('base64') },
        },
      },
    });

    const session = await createGmailSession('user-1');
    await expect(session.listRecentMessages()).resolves.toEqual([{ id: 'message-1' }]);
    await expect(session.getMessage('message-1')).resolves.toMatchObject({
      subject: 'Order receipt',
      from: 'orders@example.com',
      body: 'Order total $12.00',
    });

    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
    expect(mockGoogleGmail).toHaveBeenCalledTimes(1);
    expect(mockGmailList).toHaveBeenCalledTimes(1);
    expect(mockGmailList.mock.calls[0][0]).toEqual(expect.objectContaining({ maxResults: 100 }));
    expect(mockGmailGet).toHaveBeenCalledTimes(1);
  });

  it('reads incremental message additions across Gmail history pages', async () => {
    OAuthToken.findCredentialsByUserId.mockResolvedValue({
      refresh_token: 'refresh-token',
      scope: 'gmail.readonly',
    });
    OAuthToken.upsert.mockResolvedValue({});
    mockRefreshAccessToken.mockResolvedValue({
      credentials: { access_token: 'access-token', expiry_date: Date.now() + 3600000 },
    });
    mockGmailHistoryList
      .mockResolvedValueOnce({
        data: {
          history: [{ messagesAdded: [{ message: { id: 'message-1', threadId: 'thread-1' } }] }],
          historyId: '102',
          nextPageToken: 'next',
        },
      })
      .mockResolvedValueOnce({
        data: {
          history: [{ messagesAdded: [
            { message: { id: 'message-1', threadId: 'thread-1' } },
            { message: { id: 'message-2', threadId: 'thread-2' } },
          ] }],
          historyId: '105',
        },
      });

    await expect(listHistoryMessages('user-1', '100')).resolves.toEqual({
      messages: [
        { id: 'message-1', threadId: 'thread-1' },
        { id: 'message-2', threadId: 'thread-2' },
      ],
      historyId: '105',
      pageCount: 2,
    });
    expect(mockGmailHistoryList).toHaveBeenNthCalledWith(2, expect.objectContaining({
      startHistoryId: '100',
      pageToken: 'next',
    }), expect.any(Object));
  });
});

describe('disconnectGmailConnection', () => {
  beforeEach(() => {
    fetch.mockReset();
    OAuthToken.findCredentialsByUserId.mockReset();
    OAuthToken.deleteByUserId.mockReset();
    db.query.mockReset();
  });

  it('cleans up local Gmail state even when no token exists', async () => {
    OAuthToken.findCredentialsByUserId.mockResolvedValue(null);
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await expect(disconnectGmailConnection('user-1')).resolves.toEqual({
      disconnected: true,
      revoked: false,
      had_token: false,
    });

    expect(OAuthToken.deleteByUserId).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledWith('DELETE FROM gmail_oauth_states WHERE user_id = $1', ['user-1']);
  });

  it('deletes local Gmail state even if revoke fails', async () => {
    OAuthToken.findCredentialsByUserId.mockResolvedValue({ refresh_token: 'refresh-token' });
    fetch.mockRejectedValue(new Error('network down'));
    OAuthToken.deleteByUserId.mockResolvedValue({});
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await expect(disconnectGmailConnection('user-1')).resolves.toEqual({
      disconnected: true,
      revoked: false,
      had_token: true,
    });

    expect(OAuthToken.deleteByUserId).toHaveBeenCalledWith('user-1');
    expect(db.query).toHaveBeenCalledWith('DELETE FROM gmail_oauth_states WHERE user_id = $1', ['user-1']);
  });
});
