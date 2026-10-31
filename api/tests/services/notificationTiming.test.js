const {
  isMorningDeliveryWindow,
  isQuietTime,
  nextNonQuietDate,
  validTimezone,
} = require('../../src/services/notificationTiming');

describe('notificationTiming', () => {
  const user = {
    notification_timezone: 'America/New_York',
    notification_quiet_hours_enabled: true,
    notification_quiet_start: 22,
    notification_quiet_end: 8,
  };

  it('validates IANA timezones', () => {
    expect(validTimezone('America/New_York')).toBe('America/New_York');
    expect(validTimezone('not/a-zone')).toBeNull();
  });

  it('evaluates overnight quiet hours in the user timezone', () => {
    expect(isQuietTime(user, new Date('2026-10-30T03:00:00.000Z'))).toBe(true);
    expect(isQuietTime(user, new Date('2026-10-30T16:00:00.000Z'))).toBe(false);
  });

  it('moves deferred delivery to the end of quiet hours', () => {
    const available = nextNonQuietDate(user, new Date('2026-10-30T03:00:00.000Z'));
    expect(available.toISOString()).toBe('2026-10-30T12:00:00.000Z');
  });

  it('uses the local morning window for insight delivery', () => {
    expect(isMorningDeliveryWindow(user, new Date('2026-10-30T13:30:00.000Z'))).toBe(true);
    expect(isMorningDeliveryWindow(user, new Date('2026-10-30T17:30:00.000Z'))).toBe(false);
  });
});
