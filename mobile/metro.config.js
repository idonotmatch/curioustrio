const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Supabase uses the `ws` package for realtime. In React Native, the global
// WebSocket is already provided natively, so we shim `ws` to a no-op module
// to prevent Metro from trying (and failing) to bundle Node.js built-ins.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'ws') {
    return {
      filePath: `${__dirname}/shims/ws.js`,
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
