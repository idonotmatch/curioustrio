const { decodeHtmlEntities } = require('../../src/utils/htmlEntities');

describe('decodeHtmlEntities', () => {
  it('decodes common HTML entities used in email-derived text', () => {
    expect(decodeHtmlEntities('Ordered: &quot;Kinetic Sand&quot; &amp; more &#39;stuff&#39;')).toBe(
      'Ordered: "Kinetic Sand" & more \'stuff\''
    );
  });
});
