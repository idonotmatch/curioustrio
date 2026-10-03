const { finalizeIngestMetadata } = require('../../src/services/parseIngestMetadata');

it('never persists raw model output previews', () => {
  const metadata = finalizeIngestMetadata({
    status: 'failed',
    source: 'receipt',
    metadata: {
      raw_text_preview: '{"merchant":"Private Store"}',
      fallback_raw_text_preview: '{"card_last4":"1234"}',
      model_call_count: 2,
      model_input_tokens: 1200,
    },
  });

  expect(metadata.raw_text_preview).toBeUndefined();
  expect(metadata.fallback_raw_text_preview).toBeUndefined();
  expect(metadata).toMatchObject({
    model_call_count: 2,
    model_input_tokens: 1200,
  });
});
