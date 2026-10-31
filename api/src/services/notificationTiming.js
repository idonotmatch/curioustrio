const DEFAULT_TIMEZONE = 'UTC';

function validTimezone(value) {
  const timezone = `${value || ''}`.trim();
  if (!timezone || timezone.length > 100) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return null;
  }
}

function localHour(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: validTimezone(timezone) || DEFAULT_TIMEZONE,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === 'hour')?.value || 0);
}

function hourInRange(hour, start, end) {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function isQuietTime(user = {}, date = new Date()) {
  if (user.notification_quiet_hours_enabled === false) return false;
  const start = Number.isInteger(Number(user.notification_quiet_start))
    ? Number(user.notification_quiet_start)
    : 22;
  const end = Number.isInteger(Number(user.notification_quiet_end))
    ? Number(user.notification_quiet_end)
    : 8;
  return hourInRange(localHour(date, user.notification_timezone), start, end);
}

function nextNonQuietDate(user = {}, from = new Date()) {
  if (!isQuietTime(user, from)) return from;
  const stepMs = 15 * 60 * 1000;
  for (let step = 1; step <= 96; step += 1) {
    const candidate = new Date(from.getTime() + step * stepMs);
    if (!isQuietTime(user, candidate)) return candidate;
  }
  return new Date(from.getTime() + 24 * 60 * 60 * 1000);
}

function isMorningDeliveryWindow(user = {}, date = new Date()) {
  const hour = localHour(date, user.notification_timezone);
  return hour >= 9 && hour < 11 && !isQuietTime(user, date);
}

module.exports = {
  isMorningDeliveryWindow,
  isQuietTime,
  localHour,
  nextNonQuietDate,
  validTimezone,
};
