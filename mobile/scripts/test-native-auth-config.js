const assert = require('node:assert/strict');
const { expo } = require('../app.json');

const googlePlugin = expo.plugins.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === '@react-native-google-signin/google-signin'
);

assert.equal(expo.scheme, 'adlo');
assert.equal(expo.ios.bundleIdentifier, 'com.curioustrio.expensetracker');
assert.equal(
  expo.runtimeVersion?.policy,
  'fingerprint',
  'OTA updates must be isolated by native runtime compatibility'
);
assert.equal(expo.ios.infoPlist.CFBundleURLTypes, undefined);
assert.deepEqual(expo.ios.entitlements['keychain-access-groups'], [
  '$(AppIdentifierPrefix)$(CFBundleIdentifier)',
]);
assert.ok(googlePlugin, 'Google Sign-In must be configured as an Expo plugin');
assert.match(googlePlugin[1].iosUrlScheme, /^com\.googleusercontent\.apps\./);

console.log('[mobile-logic] native auth config checks passed');
