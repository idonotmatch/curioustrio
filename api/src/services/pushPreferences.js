function pushNotificationsEnabled(user, preferenceKey) {
  if (!user || !preferenceKey) return true;
  const value = user[preferenceKey];
  if (value === undefined || value === null) return true;
  return value !== false;
}

module.exports = {
  pushNotificationsEnabled,
};
