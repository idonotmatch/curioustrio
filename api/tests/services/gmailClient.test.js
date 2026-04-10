const { htmlToReadableText, GMAIL_SEARCH_QUERY } = require('../../src/services/gmailClient');

describe('gmailClient helpers', () => {
  it('broadens the Gmail search query beyond basic receipt subjects', () => {
    expect(GMAIL_SEARCH_QUERY).toContain('invoice');
    expect(GMAIL_SEARCH_QUERY).toContain('renewal');
    expect(GMAIL_SEARCH_QUERY).toContain('from:(amazon.com)');
    expect(GMAIL_SEARCH_QUERY).toContain('from:(auto-confirm@amazon.com)');
    expect(GMAIL_SEARCH_QUERY).not.toContain('-category:promotions');
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
});
