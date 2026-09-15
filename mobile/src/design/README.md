# Design system

The desk and the night, with ink and paper still on them. Everything visual
comes from here; a screen defines no colour, radius, spacing or font size of
its own. If something is missing, it is added to `@lyzn/design` and reaches
this folder through `tokens.ts` — see
`docs/superpowers/plans/2026-09-08-app-round-seven.md` §2.1–2.3, and
`docs/superpowers/specs/2026-09-06-lyzn-app-ui-design.md` for the round-six
system underneath it.

**The desk is where the day is laid out. Paper is what is kept on it.**

Styling is Tailwind classes through NativeWind 4 (`tailwind.config.js` reads
`@lyzn/design/tokens.json`; `global.css` and `src/design/interop.ts` are
imported once from `app/_layout.tsx`). A tone is CSS variables, written by
`ToneProvider`; `dark:` is reserved for the app-wide light/dark choice.

```
tokens.ts      colors, tones, space, radius, type, formatters
theme.ts       Theme, THEME_STORAGE_KEY, resolveGround — pure, and tested
tone.tsx       ToneProvider, toneVars, useTone, useTheme, setTheme, Screen
interop.ts     className on Animated, react-native-svg, gradients; Icon
motion.ts      ease, dur, enter, useReducedMotionFlag
kit/           the components — see below
Touchable.tsx  Touchable
TickRow.tsx    TickRow
Receipt.tsx    Receipt, ReceiptRow, ReceiptCut, ReceiptStamp, ReceiptBarcode
stage/         Waveform, SpokenLine, TranscriptLine, SummaryCard, Sweep,
               TaskRow, StatusBlock
Scrub.tsx      Scrub
Toast.tsx      ToastProvider / useToast
icons.tsx      Mark, AppleMark, GoogleMark — Lucide for everything else
Enter.tsx      Enter (M1)   ·   MarkPulse.tsx  MarkPulse (M0)
primitives.tsx DEPRECATED — the round-six StyleSheet primitives, kept only
               until T6–T8 have rewritten the screens that still import them
```

## The kit

`src/design/kit/` is every part on the design canvas, once, with the rule
that governs it (canvas §06, "COMPONENT SHEET"). One import site:

```tsx
import { Screen, TopRow, Card, Button, TaskCard } from '../src/design/kit';
```

```
type.ts        TXT · MONO · TEXT_TONE · BG_TONE · BORDER_TONE · cx
               the canvas' every size, weight, tracking and leading, once
models.ts      taskCardState, taskTag, taskKindLabel, taskEyebrow,
               receiptFromTask, receiptClock, metaLine, countLabel,
               conversationChips, codeBoxes, parseInk — pure, and tested
text.tsx       Txt · Label · MetaLine
surfaces.tsx   Screen · TopRow · TopAction · Card · Banner · EmptyCard ·
               Chip · Progress · AskBar · KitTextInput
controls.tsx   Button · Segments · Toggle · Field · CodeBoxes · InkPicker ·
               useInk
rows.tsx       KeyValue · KeyValues · SettingsRow · TaskCard ·
               ConversationRow · NotificationCard · RecordingPill
receipt.tsx    Receipt (paper always) · ReceiptCard (the roll item)
Sheet.tsx      Sheet          ·  TabBar.tsx  TabBar, TABS
Waveform.tsx   Waveform, in the canvas' void red
index.ts       the barrel, and the three rules below
```

`app/_kit.tsx` is a **development-only route** (`lyzn:///_kit`) that renders
every component in every variant and state, with a theme toggle at the top.
It returns `null` when `__DEV__` is false, so the file ships and the route
does not. Screenshots of a kit change go through it.

### The three rules

1. **A component names a role, never a colour.** Every surface is written
   over the `--tone-*` variables, so one class is right on the desk and at
   night and nothing branches on the theme. A primary button is
   `bg-tone-inv-bg text-tone-inv-fg` — ink on a sheet in daylight, a sheet on
   ink after dark, which is exactly what the canvas draws in both.
2. **`className` is layout only** — margin, gap, flex, position. A card's
   ground, a label's size and a button's fill belong to its props. Two
   classes that set the same property are decided by the order Tailwind
   emitted them, not by the order they appear in the attribute, so a caller
   can never reliably override a variant; a component that needs a new look
   needs a new variant.
3. **The decisions are pure.** `taskCardState`, `receiptFromTask`,
   `codeBoxes` and the label joins live in `models.ts` with no React around
   them, and `tests/design/kit.test.ts` asks them directly.

### The rule that costs the most to forget

**A Reanimated `useAnimatedStyle` object in the `style` prop of a className'd
component silently destroys that component's styles.** css-interop collects
the inline `style` prop alongside the compiled rules so a class and a style
can merge; an animated style is not a style object, and merging it drops both
— the element renders with neither its classes nor its animation, at zero
height. Measured on the simulator; the table is in `interop.ts`'s header.

So `Animated.*` is **not** registered for `className`, and:

- **Class-animated** — a plain component with `transition-*` and a state
  class. The runtime upgrades it to an animated component itself. This is how
  `Touchable`'s press scale and `Toggle`'s knob travel work.
- **Hand-animated** — an `Animated.View` with a `useAnimatedStyle` and **no**
  className. `Enter`, `MarkPulse` and the receipt's paper are these.
- **Both** — nest them: the animated view outside carrying the motion, a
  plain `View` inside carrying the classes. `TickRow`, `Scrub` and
  `Waveform` are these.

One more: a class that sets a CSS variable (every `scale-*` and `translate-*`,
through Tailwind's `--tw-*` transform slots) makes css-interop wrap the
element in a variable provider the first time it appears. If the only such
class is behind `active:`, that first time is the first *press* — a remount
mid-gesture and nativewind PR #1835's crash. Declare the resting value too:
`scale-100 … active:scale-[0.985]`.

### Two places a colour is still resolved in JavaScript

`placeholderTextColor` is a prop React Native resolves itself and no class
reaches it, so `KitTextInput` reads `--tone-faint` through
`useUnstableNativeVariable`. And the ink picker's swatch is the value being
picked rather than a token, so it goes inline. Everything else is a class.

### Carbon carries the tone's own type

The canvas sets type on a dark carbon card in `#EBDFB8`, which is a fifth
colour the tone table does not carry. The kit uses `text-tone-fg` / `muted` /
`faint` on carbon in both themes instead: the desk's carbon is light and the
night's is dark, so the ground's own ink is legible on each without a
per-component branch. That is the trade rule 1 asks for.

The old surface systems are gone: the glass and gradient cards, the bento
tiles, the tick dial, the LED numerals, the arc gauge, the hand-drawn icon
set and the two green palettes were all deleted in the last step of the
restyle. Nothing in `src/` or `app/` names a colour of its own any more.

## The rules that make it feel coherent

**Four grounds, and `Screen` chooses.** `desk` and `night` are the two the
appearance resolves to; `paper` and `ink` are named explicitly by the things
that are not part of the appearance — a receipt is paper in both themes, and
the screens not yet rebuilt are still ink. A route that names no ground gets
the theme's. Nothing below `Screen` names a background. `PanelInverted` is the
only way to put one ground inside another.

**Colour is the ground plus one signal.** `colors.signal` is a warm gold that
never fills anything larger than 8 pt: dots, 1–2 px rules, the ✓ on a confirmed
row, the last lit tick, a focus border. `colors.danger` is errors and
destructive actions. There is no third colour.

**Hairlines, not borders. No shadows at all.** `border` in `border-tone-line`,
or `border-[1.5px] border-tone-line2` for a control. The receipt's Skia shadow
is the one shadow in the app. Never toggle a `shadow-*` class on and off —
nativewind PR #1835 crashes when an element inside a React Navigation screen
conditionally *gains* a variable-producing class; put `shadow-none` on the
other variant instead.

**Never a weight without its family.** Archivo and Martian Mono (ruling R17 —
the website's faces) ship as separate weighted files, so a `fontWeight` alone
gets a synthesised fake bold on Android. Every entry in `type` carries its
`fontFamily`, and the map it names them from is `fonts.native` in
`@lyzn/design` — eight families, all eight registered in `app/_layout.tsx`.
The heaviest are the ones the website is set in: Archivo 800 for the three
display variants, Martian Mono 700 for the button's label.

**Numbers are tabular.** Anything that changes in place uses `mono` on `Txt` or
`RollingNumber`, so digits do not shift the layout as they tick.

**Mono labels are uppercase, joined by ` · `.** `Label` handles the join and
drops empty fragments, so a missing value renders nothing rather than a token.

**One press response.** `Touchable` scales to 0.985 over 120 ms with a light
haptic and no dim. Every tappable thing in the app uses it.

## Motion

Timing only; no springs — nothing bounces. All animation is Reanimated on the
UI thread, so it stays smooth while the JS thread decodes a BLE transfer.

- Curves: `ease.out` / `ease.inOut` / `ease.in`
- Durations: `dur.micro` 120 · `dur.ui` 160 · `dur.enter` 420 · `dur.slow` 700
- Entry stagger: `enter(i)`, capped at 8 blocks
- Layout changes: `LinearTransition.duration(220)`
- `useReducedMotionFlag()` combines Reanimated's flag with the live
  `AccessibilityInfo` one; when it is true, durations are zero (`useDur()`) and
  loops do not start.

The loop rule: the only things that move without a cause are the waveform while
audio is live, the pendant's idle float, the recording dot, the orb while Mira
is present or working, and the mark pulse on the gate. Nothing else loops,
pulses or shimmers. No spinners, no shimmer skeletons, no glows.

## Adding a screen

A screen names no ground: it gets the theme's, which is the desk in light and
the night in dark. It names no colour, size or radius either — every one of
those is a kit prop.

```tsx
import { Screen, TopRow, Card, Label, Txt, Button } from '../src/design/kit';

export default function Thing() {
  return (
    <Screen>
      <TopRow back="TODAY" onBack={() => router.back()} />
      <Card className="mx-[18px]">
        <Label variant="eyebrow">Section</Label>
        <Txt variant="title">Heading</Txt>
        <Txt variant="body" tone="muted">Body copy.</Txt>
        <Button title="DO IT" onPress={go} full className="mt-[12px]" />
      </Card>
    </Screen>
  );
}
```

## Toasts

Long BLE work must confirm it started — a spinner alone leaves the user unsure
the tap registered. Toasts are ink chrome on every ground.

```tsx
const toast = useToast();
toast.show('Sync started', { detail: 'This can take a few minutes.', tone: 'busy' });
toast.show('Sync complete', { detail: '3 pulled · 3 uploaded', tone: 'success' });
toast.show('That did not work', { detail: err.message, tone: 'error' });
```

## The pendant visual

`src/components/PendantVisual.tsx` — three layers (spec §5.6): the poster
shows immediately, the GL scene fades in over 600 ms once it has drawn a
frame, and the video clip replaces the poster only when GL reports it cannot
deliver. The object never spins; where it stands is `src/three/rig.ts`'s four
poses. Under reduce motion no GL is mounted at all and the poster is the
picture.

The clip is the last fallback, and its source has a green screen. It is keyed out and composited onto the app's
black **offline**, not at runtime — React Native has no chroma-key filter, and
video-with-alpha is platform-split (HEVC+alpha on iOS, VP9 on Android). Since
the design is true black, compositing onto black is seamless and costs nothing.

To regenerate from a new source clip:

```bash
ffmpeg -i pendant-vid.mp4 -filter_complex "\
  [0:v]crop=620:566:330:28,format=rgba,\
  colorkey=color=0x12882F:similarity=0.12:blend=0.035,\
  despill=type=green:mix=0.5:expand=0.25,\
  scale=540:493,pad=540:540:0:24:color=0x00000000[k];\
  color=c=0x040404:s=540x540:d=10,format=rgba[bg];\
  [bg][k]overlay=shortest=1,format=yuv420p[out]" \
  -map "[out]" -an -c:v libx264 -crf 22 assets/pendant.mp4
```

`similarity` matters: the pendant is nearly black and the screen green is dark,
so above about 0.16 the key eats the device itself, and below 0.08 green survives
in the corners.
