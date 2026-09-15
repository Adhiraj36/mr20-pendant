# LYZN brand assets

Copied from `MelloB1989/lyzn.core`, where they are scattered across a dozen
app directories. Every file here was opened and confirmed to be LYZN before it
was kept — the source repository is not trustworthy on this point, for reasons
below. Byte-identical copies were collapsed to one; nothing here repeats.

The mark is a cluster of nineteen hexagons in `#226326`. The lockup sets it
beside `lyzn.ai` in a dark serif-less face.

```
logo/       the mark and the wordmark
app-icon/   what ships as the application's own icon
web/        favicons and PWA icons
```

## What is here

| File | Size | What it is |
|---|---|---|
| `logo/lyzn-logo-vector.svg` | vector | **The mark, as vector.** Nineteen `#226326` hexagon paths. Start here — everything else is a raster of this. |
| `logo/lyzn-landing-logo.png` | 624×646 | The mark, transparent, large |
| `logo/logo-green-trans.png` | 331×342 | The mark, transparent, small |
| `logo/logo-white-trans.png` | 702×726 | The mark in white, for dark grounds |
| `logo/lyzn-main-logo.png` | 64×64 | The mark at favicon scale |
| `logo/lyzn-trans.png` | 83×87 | The mark, small, dark green |
| `logo/lyzn-mark-on-green.png` | 1024×1536 | The mark on a green field — an app-icon layer, not square |
| `logo/logo-bg-fill-green2.png` | 988×984 | The mark on a green square |
| `logo/logo-bg-fill-dark-green.png` | 1000×964 | The mark on a dark green square |
| `logo/wordmark-dark-trans.png` | 849×214 | **The lockup**: mark + `lyzn.ai`, dark, transparent |
| `logo/wordmark-white-trans.png` | 1697×427 | The lockup in white, for dark grounds |
| `logo/lyzn-text-logo.png` | 322×96 | The lockup, small |
| `logo/wordmark-bg-green.png` | 2195×985 | The lockup on green |
| `logo/wordmark-bg-white.png` | 2195×985 | The lockup on white |
| `app-icon/ios-marketing-1024.png` | 1024×1024 | **The app icon at full size.** What the App Store listing wants. |
| `app-icon/app-icon-512.png` | 512×512 | The same icon at 512 — also what Play's listing takes |
| `app-icon/android-monochrome.png` | 162×162 | Android themed-icon layer |
| `web/icon-512.png` | 512×512 | PWA icon, circular |
| `web/icon-192.png` | 192×192 | PWA icon |
| `web/icon-192-maskable.png` | 192×192 | PWA maskable icon |
| `web/apple-touch-icon.png` | 180×180 | iOS home screen |
| `web/favicon.ico` | 16+32 | Two-size ICO |
| `web/favicon-16x16.png`, `favicon-32x32.png` | | Individual favicon sizes |

## What was deliberately left out

Three assets in `lyzn.core` carry other companies' branding, sitting under
LYZN filenames because the apps holding them were forked and never fully
rebranded. None of them are LYZN and none were copied:

- `lyzn.react-native/assets/images/adaptive-icon.png` — a **storizz** wordmark
- `lyzn.react-native/assets/images/splash-icon.png` — a **storizz** splash
- `lyzn.vibe/public/fullLogo.png` and `logo.svg` — **LlamaCoder**

Also skipped: `lyzn-ai.png`, which is a product render of the pendant rather
than a logo; the seventy-five per-density Android and iOS variants, which are
generated from the icons above rather than drawn; and the UI glyphs, Kairo
assets and marketing imagery that sit alongside the logos in the source.

Filenames in the source do not reliably describe their contents — `icon-1024-1024.png`
is 512×512, and the two "icons" named above are another company's. Open a file
before trusting its name.
