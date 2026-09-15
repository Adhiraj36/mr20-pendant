// Metro's defaults know about images and video but not 3D geometry, so a
// require of the pendant's .glb resolves to nothing and the model silently
// falls back to the video. Teaching the bundler the extension is all it takes.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('glb', 'gltf', 'bin');

// @lyzn/design lives outside mobile/, as a sibling package rather than a
// dependency published to a registry. `bun add ../packages/design` links it
// into node_modules as a tree of file symlinks (Metro's default watcher
// follows symlinks in Expo 57, but the source directory itself still needs
// to be in the watch set, and its own node_modules resolution needs to
// bottom out at mobile's).
const designDir = path.resolve(__dirname, '../packages/design');
config.watchFolders = [...(config.watchFolders ?? []), designDir];
config.resolver.nodeModulesPaths = [
  ...(config.resolver.nodeModulesPaths ?? []),
  path.resolve(__dirname, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;

// NativeWind wraps last, and has to: it re-points `transformerPath` (chaining
// whatever was there through `transformer.cssInterop_transformerPath`), appends
// "css" to `sourceExts`, and wraps `resolveRequest`, `enhanceMiddleware` and
// `getTransformOptions` — all of it spread over the config above, so the watch
// folders, the symlink resolution and the .glb extension all survive.
module.exports = withNativeWind(config, {
  input: './global.css',
  // NativeWind writes `nativewind-env.d.ts` and pushes it into
  // tsconfig.json's `include` on every Metro start, and rewrites the whole
  // config file through JSON.stringify on the way — reindenting `paths`,
  // exploding `include`, dropping the trailing newline. That is a dirty
  // working tree after every `expo start`, for two lines that never change.
  // Both files are written by hand and committed instead; the d.ts is the
  // generator's own text, verbatim.
  disableTypeScriptGeneration: true,
});
