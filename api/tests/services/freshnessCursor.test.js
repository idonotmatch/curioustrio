const { parseFreshnessCursor } = require('../../src/services/freshnessCursor');

describe('freshness cursor parsing', () => {
  it('accepts a timestamp and UUID cursor', () => {
    expect(parseFreshnessCursor({
      since: '2026-10-05T12:00:00.000Z',
      since_id: '00000000-0000-4000-8000-000000000001',
    })).toEqual({
      error: null,
      since: '2026-10-05T12:00:00.000Z',
      sinceId: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('rejects malformed timestamps and cursor ids', () => {
    expect(parseFreshnessCursor({ since: 'not-a-date' }).error)
      .toBe('Invalid freshness cursor timestamp');
    expect(parseFreshnessCursor({
      since: '2026-10-05T12:00:00.000Z',
      since_id: 'not-a-uuid',
    }).error).toBe('Invalid freshness cursor id');
  });
});
