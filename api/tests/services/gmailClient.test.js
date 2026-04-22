const { htmlToReadableText, GMAIL_SEARCH_QUERY, chooseBestMessageBody, bodyRichnessScore } = require('../../src/services/gmailClient');

describe('gmailClient helpers', () => {
  it('broadens the Gmail search query beyond basic receipt subjects', () => {
    expect(GMAIL_SEARCH_QUERY).toContain('invoice');
    expect(GMAIL_SEARCH_QUERY).toContain('renewal');
    expect(GMAIL_SEARCH_QUERY).toContain('subject:"ORDER:"');
    expect(GMAIL_SEARCH_QUERY).toContain('"ride receipt"');
    expect(GMAIL_SEARCH_QUERY).toContain('from:(uber.com)');
    expect(GMAIL_SEARCH_QUERY).toContain('from:(lyftmail.com)');
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
