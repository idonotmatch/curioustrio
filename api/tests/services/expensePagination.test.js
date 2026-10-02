const {
  buildExpensePage,
  decodeExpenseCursor,
  encodeExpenseCursor,
} = require('../../src/services/expensePagination');

describe('expensePagination', () => {
  const rows = [1, 2, 3].map((index) => ({
    id: `00000000-0000-4000-8000-00000000000${index}`,
    date: `2026-10-0${4 - index}`,
    created_at: `2026-10-0${4 - index}T12:00:00.000Z`,
  }));

  it('round-trips opaque cursors', () => {
    expect(decodeExpenseCursor(encodeExpenseCursor(rows[0]))).toEqual(rows[0]);
  });

  it('returns one bounded page and a cursor only when more rows exist', () => {
    const page = buildExpensePage(rows, 2);
    expect(page.items).toHaveLength(2);
    expect(decodeExpenseCursor(page.next_cursor)).toEqual(rows[1]);
    expect(buildExpensePage(rows.slice(0, 2), 2).next_cursor).toBeNull();
  });

  it('rejects malformed cursors', () => {
    expect(decodeExpenseCursor('not-a-cursor')).toBeNull();
  });
});
