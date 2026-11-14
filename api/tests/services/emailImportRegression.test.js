const cases = require('../fixtures/emailImportRegressionCases.json');
const { assessEmailAdmission } = require('../../src/services/emailAdmissionPolicy');
const { assessEmailAmount } = require('../../src/services/emailAmountAssessment');
const { extractEmailTransactionLifecycle } = require('../../src/services/emailTransactionLifecycle');

describe('sanitized email import regression corpus', () => {
  it.each(cases)('$id', (fixture) => {
    const classification = { disposition: fixture.classification };
    const admission = assessEmailAdmission({
      subject: fixture.subject,
      fromAddress: fixture.fromAddress,
      body: fixture.body,
      classification,
    });
    const lifecycle = extractEmailTransactionLifecycle({
      subject: fixture.subject,
      fromAddress: fixture.fromAddress,
      body: fixture.body,
      classification,
    });

    if (fixture.expected.admit != null) {
      expect(admission.admit).toBe(fixture.expected.admit);
    }
    expect(lifecycle.eventType).toBe(fixture.expected.eventType);

    if (fixture.expected.amountConfidence) {
      expect(assessEmailAmount({
        body: fixture.body,
        parsedAmount: fixture.amount,
        eventType: lifecycle.eventType,
      }).confidence).toBe(fixture.expected.amountConfidence);
    }
  });
});
