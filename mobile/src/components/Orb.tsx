/**
 * Mira's mark: a dark glass sphere with a standing wave running through it —
 * sound held inside a stone. Drawn, not shipped as a bitmap, so it stays in
 * the app's own palette at any size. Static by design.
 *
 * The halo is gone and the ring is `line2` (spec §3.5): the wave reads in the
 * foreground, and there is no glow anywhere in the app.
 */
import Svg, {
  Defs, RadialGradient, Stop, Circle, Path, ClipPath, G,
} from 'react-native-svg';
import { colors, tones } from '../design/tokens';

export function Orb({ size = 120 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Defs>
        <RadialGradient id="orbBody" cx="38%" cy="30%" r="75%">
          <Stop offset="0%" stopColor={colors.graphite2} stopOpacity="1" />
          <Stop offset="55%" stopColor={colors.charcoal} stopOpacity="1" />
          <Stop offset="100%" stopColor={colors.void} stopOpacity="1" />
        </RadialGradient>
        <ClipPath id="orbClip">
          <Circle cx="60" cy="60" r="46" />
        </ClipPath>
      </Defs>

      {/* The stone, then a hairline ring. No halo. */}
      <Circle cx="60" cy="60" r="46" fill="url(#orbBody)" />
      <Circle cx="60" cy="60" r="46" stroke={tones.ink.line2} strokeWidth="1" fill="none" />

      {/* The wave: one bright line, echoed twice at lower energy. */}
      <G clipPath="url(#orbClip)">
        <Path
          d="M14 62 C 30 48, 40 76, 52 60 S 74 40, 84 60 S 100 74, 108 58"
          stroke={colors.fg} strokeOpacity="0.9" strokeWidth="1.6" fill="none" strokeLinecap="round"
        />
        <Path
          d="M14 62 C 30 48, 40 76, 52 60 S 74 40, 84 60 S 100 74, 108 58"
          stroke={colors.fg} strokeOpacity="0.18" strokeWidth="5" fill="none" strokeLinecap="round"
        />
        <Path
          d="M12 66 C 28 58, 44 68, 58 62 S 82 52, 96 64 S 104 68, 110 64"
          stroke={colors.fg} strokeOpacity="0.35" strokeWidth="1" fill="none" strokeLinecap="round"
        />
        <Path
          d="M16 56 C 34 62, 46 50, 62 56 S 86 64, 106 52"
          stroke={colors.fg} strokeOpacity="0.30" strokeWidth="0.9" fill="none" strokeLinecap="round"
        />
        {/* Glass highlight along the upper left. */}
        <Circle cx="44" cy="38" r="30" fill={colors.fg} opacity="0.045" />
      </G>
    </Svg>
  );
}
