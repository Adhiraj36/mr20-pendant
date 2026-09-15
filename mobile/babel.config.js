/**
 * NativeWind's JSX runtime, and the worklets transform that is no longer
 * written down here.
 *
 * `react-native-worklets/plugin` used to be listed under `plugins` with a
 * comment saying it has to be last. It was in fact running *first*: Babel
 * applies root `plugins` before preset plugins, so the explicit entry landed
 * at index 0, ahead of the TypeScript transform. `babel-preset-expo@57`
 * already auto-injects the plugin whenever the package resolves, and that
 * copy runs after every preset — which is where Reanimated needs it. Two
 * further copies (this one and `nativewind/babel`'s) bought nothing but an
 * extra AST walk per file, so the explicit entry is gone.
 *
 * `jsxImportSource: 'nativewind'` is what `verifyInstallation()` looks for.
 * The transform that actually rewrites JSX is `nativewind/babel`'s, which
 * points at `react-native-css-interop/jsx-runtime` and runs first; the
 * preset's copy is then a no-op on already-transformed JSX.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
