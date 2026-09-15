/**
 * `import '../global.css'` is a side effect, not a value: Metro reads the
 * file and NativeWind compiles it, and nothing about it reaches TypeScript.
 * `nativewind/types` declares the `className` prop but not the module, so
 * without this the entry file's first line is a TS2882.
 */
declare module '*.css';
