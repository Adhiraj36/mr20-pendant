/**
 * Iconography and the mark — app spec §4.6, §3 component inventory.
 *
 * The hand-drawn set is gone: `lucide-react-native` (20 pt, stroke 1.5,
 * `currentColor`) covers everything but the brand mark and the two sign-in
 * provider glyphs, which stay hand-drawn because a raster asset would drift
 * out of sync with the theme and both providers require their glyph
 * unaltered anyway.
 *
 * `Mark` is the honeycomb — `assets/lyzn/mono/mark.svg`, 19 hexagon paths,
 * `fill="currentColor"`, viewBox `0 0 45 47` — the same path data as
 * `web/public/favicon.svg` and `web/src/components/Mark.tsx`. Spec §4.6
 * describes a different glyph (a rounded square with two pinhole dots), but
 * §0.2's rule is "the website moved past its own spec — follow the code":
 * the shipped favicon and the site's own `<Mark>` are both this honeycomb,
 * so the app draws the same one rather than a glyph nothing on the site
 * actually uses.
 */
import Svg, { Path } from 'react-native-svg';
import { useTone } from './tone';

export {
  ArrowLeft, ArrowRight, ArrowUp, X, Check, Plus, Minus, ChevronDown,
  Play, Pause, RotateCcw, RotateCw, Image, Paperclip, File, Ellipsis,
} from 'lucide-react-native';

/** The 19 hexagons, verbatim from `assets/lyzn/mono/mark.svg`. */
const MARK_PATHS = [
  'M31.7668 19.3122L35.2048 21.2972V25.267L31.7668 27.2519L28.3288 25.267V21.2972L31.7668 19.3122Z',
  'M27.1077 27.3787L30.5457 29.3636V33.3334L27.1077 35.3184L23.6697 33.3334V29.3636L27.1077 27.3787Z',
  'M17.7955 27.3787L21.2335 29.3636V33.3334L17.7955 35.3184L14.3576 33.3334V29.3636L17.7955 27.3787Z',
  'M13.1365 19.3122L16.5745 21.2972V25.267L13.1365 27.2519L9.69851 25.267V21.2972L13.1365 19.3122Z',
  'M17.7955 11.2458L21.2335 13.2307V17.2006L17.7955 19.1855L14.3576 17.2006V13.2307L17.7955 11.2458Z',
  'M27.1077 11.2458L30.5457 13.2307V17.2006L27.1077 19.1855L23.6697 17.2006V13.2307L27.1077 11.2458Z',
  'M31.7668 3.17957L35.2048 5.1645V9.13434L31.7668 11.1193L28.3288 9.13434V5.1645L31.7668 3.17957Z',
  'M39.1122 9.73223L33.4731 12.9879V16.9578L36.9111 18.9427L42.5502 15.687V11.7172L39.1122 9.73223Z',
  'M41.0786 19.3122L44.5166 21.2972V25.267L41.0786 27.2519L37.6406 25.267V21.2972L41.0786 19.3122Z',
  'M39.0142 36.8806L33.3751 33.6248V29.655L36.8131 27.6701L42.4522 30.9258V34.8956L39.0142 36.8806Z',
  'M31.7668 35.4451L35.2048 37.43V41.3999L31.7668 43.3848L28.3288 41.3999V37.43L31.7668 35.4451Z',
  'M19.041 37.901L19.041 44.4124L22.479 46.3973L25.917 44.4124L25.917 37.901L22.479 35.9161L19.041 37.901Z',
  'M13.1365 35.4451L16.5745 37.43V41.3999L13.1365 43.3848L9.69851 41.3999V37.43L13.1365 35.4451Z',
  'M2.69815 30.7368L8.28306 27.389L11.7531 29.3172L11.8183 33.2865L6.23337 36.6344L2.76328 34.7061L2.69815 30.7368Z',
  'M3.82471 19.3122L7.26269 21.2972V25.267L3.82471 27.2519L0.386719 25.267V21.2972L3.82471 19.3122Z',
  'M6.31847 9.99738L11.9576 13.2531V17.2229L8.51958 19.2079L2.88049 15.9522V11.9823L6.31847 9.99738Z',
  'M13.1365 3.17957L16.5745 5.1645V9.13434L13.1365 11.1193L9.69851 9.13434V5.1645L13.1365 3.17957Z',
  'M19.041 2.71148L19.041 9.22294L22.479 11.2079L25.917 9.22294L25.917 2.71148L22.479 0.726562L19.041 2.71148Z',
  'M22.4519 19.3122L25.8899 21.2972V25.267L22.4519 27.2519L19.0139 25.267V21.2972L22.4519 19.3122Z',
];

/**
 * The LYZN mark — the app icon foreground, the Pendant tab icon, the gate
 * pulse (M0), the loading state, the link panel's glyph and the New chat
 * glyph (spec §4.6). Defaults to the ambient tone's `fg`; pass `color` to
 * override (the app icon draws it in `fg` on `ink` regardless of tone).
 */
export function Mark({ size = 24, color }: { size?: number; color?: string }) {
  const tone = useTone();
  const fill = color ?? tone.fg;
  return (
    <Svg width={size} height={size * (47 / 45)} viewBox="0 0 45 47">
      {MARK_PATHS.map((d) => <Path key={d} d={d} fill={fill} />)}
    </Svg>
  );
}

/**
 * The Google and Apple marks.
 *
 * Drawn rather than shipped as images: both companies require their glyph
 * to appear unaltered and at the right proportions, and an SVG path cannot
 * drift out of sync with a theme the way a bitmap asset does. Moved here
 * from `ProviderMarks.tsx` (spec §3 inventory: "merged into `icons.tsx`");
 * that file is now a re-export shim so `sign-in.tsx` keeps compiling.
 */
export function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <Path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <Path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <Path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </Svg>
  );
}

export function AppleMark({ size = 18, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M17.05 12.54c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.71-3.19-1.73-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.18-1.54 2.67-.39 6.62 1.11 8.79.73 1.06 1.6 2.25 2.75 2.21 1.1-.04 1.52-.71 2.85-.71 1.33 0 1.71.71 2.88.69 1.19-.02 1.94-1.08 2.67-2.14.84-1.23 1.19-2.42 1.21-2.48-.03-.01-2.32-.89-2.34-3.54zM14.88 5.6c.61-.74 1.02-1.77.91-2.8-.88.04-1.94.59-2.57 1.32-.56.65-1.05 1.7-.92 2.7.98.08 1.98-.5 2.58-1.22z"
      />
    </Svg>
  );
}
