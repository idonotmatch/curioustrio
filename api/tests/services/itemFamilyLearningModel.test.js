jest.mock('../../src/db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

const db = require('../../src/db');
const ItemFamilyLearning = require('../../src/models/itemFamilyLearning');

describe('itemFamilyLearning model', () => {
  beforeEach(() => jest.clearAllMocks());

  it('treats missing pre-migration tables as no assignments', async () => {
    db.query.mockRejectedValueOnce(Object.assign(new Error('item_family_assignments missing'), { code: '42P01' }));
    await expect(ItemFamilyLearning.findAssignments('household-1')).resolves.toEqual([]);
  });

  it('loads compact candidate groups instead of raw item history', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ comparable_key: 'chicken breast', occurrence_count: 4 }] });

    await expect(ItemFamilyLearning.loadCandidateGroups(
      'household-1',
      'user-1',
      365
    )).resolves.toHaveLength(1);

    expect(db.query.mock.calls[0][0]).toContain('COUNT(*)::int AS occurrence_count');
    expect(db.query.mock.calls[0][0]).toContain('GROUP BY');
    expect(db.query.mock.calls[0][1]).toEqual(['household-1', 365, 'user-1']);
  });

  it('stores generated candidates as one bounded JSON batch', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'candidate-1' }] });
    const candidate = {
      left_item_key: 'boneless chicken breast',
      right_item_key: 'chicken breast',
      left_label: 'Boneless Chicken Breast',
      right_label: 'Chicken Breast',
      suggested_family_key: 'learned:chicken-breast:12345678',
      suggested_family_name: 'Chicken Breast',
      family_signature: 'chicken breast',
      similarity_score: 0.9,
      evidence: { common_tokens: ['chicken', 'breast'] },
    };

    await ItemFamilyLearning.saveCandidates('household-1', [candidate]);

    expect(db.query.mock.calls[0][1][0]).toBe('household-1');
    expect(JSON.parse(db.query.mock.calls[0][1][1])).toEqual([candidate]);
  });

  it('accepts a candidate transactionally and writes learned assignments', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{
          id: 'candidate-1',
          left_item_key: 'boneless chicken breast',
          right_item_key: 'chicken breast',
          suggested_family_key: 'learned:chicken-breast:12345678',
          suggested_family_name: 'Chicken Breast',
          family_signature: 'chicken breast',
        }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: 'candidate-1', status: 'accepted' }] })
        .mockResolvedValueOnce({}),
      release: jest.fn(),
    };
    db.pool.connect.mockResolvedValueOnce(client);

    await expect(ItemFamilyLearning.reviewCandidate({
      householdId: 'household-1',
      userId: 'user-1',
      candidateId: 'candidate-1',
      decision: 'same',
    })).resolves.toMatchObject({ status: 'accepted' });

    expect(client.query.mock.calls[3][0]).toContain('INSERT INTO item_family_assignments');
    expect(client.query.mock.calls[3][1][6]).toEqual(['boneless chicken breast', 'chicken breast']);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('undoes only assignments created by the reviewed candidate', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{
          id: 'candidate-1',
          left_item_key: 'boneless chicken breast',
          right_item_key: 'chicken breast',
          suggested_family_key: 'learned:chicken-breast:12345678',
          suggested_family_name: 'Chicken Breast',
          family_signature: 'chicken breast',
        }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: 'candidate-1', status: 'pending' }] })
        .mockResolvedValueOnce({}),
      release: jest.fn(),
    };
    db.pool.connect.mockResolvedValueOnce(client);

    await expect(ItemFamilyLearning.reviewCandidate({
      householdId: 'household-1',
      userId: 'user-1',
      candidateId: 'candidate-1',
      decision: 'undo',
    })).resolves.toMatchObject({ status: 'pending' });

    expect(client.query.mock.calls[2][0]).toContain('candidate_id = $2');
    expect(client.query.mock.calls[2][1]).toEqual([
      'household-1',
      'candidate-1',
      ['boneless chicken breast', 'chicken breast'],
    ]);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });
});
