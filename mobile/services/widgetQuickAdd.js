const QUICK_ADD_ROUTE = '/quick-add';

function isWidgetQuickAddUrl(value) {
  const url = `${value || ''}`.trim().toLowerCase();
  if (!url.startsWith('adlo://')) return false;
  const route = url.slice('adlo://'.length).replace(/^\/+/, '').split(/[?#]/)[0];
  return route === 'quick-add';
}

module.exports = {
  QUICK_ADD_ROUTE,
  isWidgetQuickAddUrl,
};
