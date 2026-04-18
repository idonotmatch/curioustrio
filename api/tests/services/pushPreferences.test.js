const { pushNotificationsEnabled } = require('../../src/services/pushPreferences');

describe('pushNotificationsEnabled', () => {
  it('defaults to enabled when a preference is missing', () => {
    expect(pushNotificationsEnabled({}, 'push_insights_enabled')).toBe(true);
  });

  it('returns false when a preference is explicitly disabled', () => {
    expect(pushNotificationsEnabled({ push_insights_enabled: false }, 'push_insights_enabled')).toBe(false);
  });

  it('returns true when a preference is explicitly enabled', () => {
    expect(pushNotificationsEnabled({ push_insights_enabled: true }, 'push_insights_enabled')).toBe(true);
  });
});
