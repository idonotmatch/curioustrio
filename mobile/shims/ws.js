// Shim for the `ws` package in React Native.
// Supabase's realtime-js imports `ws` for WebSocket support, but React Native
// already provides a global WebSocket natively. This shim re-exports the
// global so Supabase uses the native implementation instead.
const W = typeof WebSocket !== 'undefined' ? WebSocket : null;
module.exports = W;
module.exports.default = W;
