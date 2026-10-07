const mockDeleteUser = jest.fn();
const mockGetUserById = jest.fn();
const mockCreateClient = jest.fn(() => ({
  auth: { admin: { deleteUser: mockDeleteUser, getUserById: mockGetUserById } },
}));

jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }));

const {
  assertSupabaseAuthUserExists,
  deleteSupabaseAuthUser,
  supabaseAdminConfigured,
} = require('../../src/services/supabaseAdminService');

describe('supabaseAdminService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'server-only-key',
    };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('deletes an auth identity with the server-only admin client', async () => {
    mockDeleteUser.mockResolvedValue({ error: null });

    await expect(deleteSupabaseAuthUser('provider-user-1')).resolves.toEqual({ deleted: true });
    expect(mockDeleteUser).toHaveBeenCalledWith('provider-user-1', false);
    expect(mockCreateClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'server-only-key',
      expect.objectContaining({ auth: expect.objectContaining({ persistSession: false }) })
    );
  });

  it('refuses to claim deletion when admin credentials are unavailable', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    expect(supabaseAdminConfigured()).toBe(false);
    await expect(deleteSupabaseAuthUser('provider-user-1')).rejects.toMatchObject({
      status: 503,
      code: 'SUPABASE_ADMIN_NOT_CONFIGURED',
    });
  });

  it('verifies an auth identity when admin credentials are configured', async () => {
    mockGetUserById.mockResolvedValue({ data: { user: { id: 'provider-user-1' } }, error: null });

    await expect(assertSupabaseAuthUserExists('provider-user-1')).resolves.toEqual({ verified: true });
  });
});
