# LYZN — preorder site and checkout

The preorder site for the pendant, and the four-step order flow behind it.
React + Vite + TypeScript, Tailwind v4, react-router, and the real
`pendant.glb` rendered live behind the landing page with react-three-fiber.

Built from **`docs/design-spec.md`**, which is the source of truth for
structure, copy, tokens, motion and the 3D states. If you are changing what the
site *says* or *does*, change the spec too.

The pendant model, the firmware work and the mobile app live in the product
repository (`mr20-pendant`); this repository is the website on its own.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # → dist/
npm run preview
npm run lint     # tsc --noEmit
```

## Routes

| Path | What it is |
|---|---|
| `/` | The landing page: eight sections, about twelve screens |
| `/order` | Plan, quantity, and the optional automation add-on |
| `/order/details` | Contact, and delivery **only** for the pendant |
| `/order/pay` | Billing, payment method, terms, provider handoff |
| `/order/confirmed` | "You're in." / "You're ready to begin." |
| `/privacy`, `/terms` | Plain text pages, paper theme |
| `/poster` | **Development only.** The still-image renderer — see below |

The basket lives in `src/order/OrderContext.tsx` and persists to
**session**Storage: a basket should not still be sitting there next week, and a
shared machine should not hand the next person an address. `/order/pay` bounces
back to `/order/details` without valid contact details, and `/order/confirmed`
bounces to `/order` if no order was placed, so neither is reachable by deep
link alone.

Because these are real paths, **the host must serve `index.html` for any
unmatched route.** Netlify: the `public/_redirects` already here. Vercel: the
rewrite in `vercel.json`. Nginx: `try_files $uri /index.html`.

## The slots

Nine facts the product has not confirmed are **empty exported constants** in
`src/data/content.ts`. Every sentence that uses one is assembled so that an
empty slot drops out of it — no page ever renders a placeholder.

| Constant | What it is |
|---|---|
| `SHIP_MONTH` | e.g. `'March 2027'`. Pricing meta, final CTA, confirmation |
| `GST_NOTE` | e.g. `'Prices include GST'`. Pricing footnote, summary rail |
| `PAYMENT_TERMS` | Cancellation and refund wording |
| `PRIVACY_DELETE` | What deleting a recording removes |
| `PRIVACY_RETENTION` | How long audio and transcripts are kept |
| `PRIVACY_ACCESS` | Who can access audio, and whether it trains models |
| `PRIVACY_HAPTIC_START` | Whether the pendant buzzes when it starts |
| `CONTACT_EMAIL` | Footer and the two policy pages |

The privacy section drops its fourth cell entirely while `PRIVACY_DELETE` and
`PRIVACY_RETENTION` are empty. **Do not fill these with something reassuring.**
They are claims about what happens to somebody's conversations, and the section
is built to be honest about not knowing yet rather than to sound complete.

## Pricing

`src/data/pricing.ts` owns everything that costs money. `priceOrder()` is the
one function that turns a basket into line items and a total, and every surface
that shows a number calls it.

The ₹1,500/month automation add-on is deliberately **not** part of the total. It
is billed from the day it is activated, so it is carried beside `dueToday` and
never summed into it. The summary rail puts it below a divider and labels it
"not charged today". Keep it that way — the single most important thing the
pricing has to communicate is that the subscription is optional.

## Wiring up Razorpay

Everything is in **`src/data/payment.ts`**, which is the only file to touch.

1. **Payment Link or Payment Page** — no backend. Paste the URL from the
   Razorpay dashboard into `RAZORPAY_LINK`. The pay step sends the customer
   there with `reference_id`, email and phone prefilled.
2. **Checkout with an order id** — set `RAZORPAY_KEY_ID` and
   `CREATE_ORDER_ENDPOINT` and swap the hosted-link branch in `src/pages/Pay.tsx`
   for the standard Razorpay script flow. The key **secret** never belongs in
   this repo.

Until one is set, the pay step runs in **rehearsal mode**: it renders exactly
what a customer will see, says plainly on both the pay and confirmation screens
that no processor is connected, records the order so the confirmation is real,
and never claims money was taken.

On failure, send the customer back to `/order/pay?status=failed`. Every field is
still filled; only a one-line notice is added.

## The 3D pendant

`public/models/pendant.glb` is the product repository's `mobile/assets/pendant.glb`
run through gltf-transform — 1.42 MB down to 255 KB:

```bash
npx @gltf-transform/cli dedup   mobile/assets/pendant.glb /tmp/p1.glb
npx @gltf-transform/cli meshopt /tmp/p1.glb               web/public/models/pendant.glb
```

Meshopt, not Draco: its decoder ships with three-stdlib, so nothing is fetched
from a CDN. `Pendant.tsx` passes `[false, true]` to `useGLTF` to say so
explicitly.

### Which side is the front

Settle this from the mesh bounds, never by eye. `Pendant_Glass` occupies the
highest Z in the export and `Pendant_MicMesh` sits on that same face, so **+Z is
the front**: the flat panel with the microphone opening. The dished side at −Z
is the back, shaped to sit against a sternum.

The model is measured and normalised at load so its longest edge is
`TARGET_SIZE` world units — re-export it at any scale and nothing needs
changing.

### Where it is, and why

`src/three/rig.ts` is the whole choreography: four states, and a `timeline()`
that mixes between them from the page's scroll. It imports nothing from React
or three.js, so the numbers can be read and argued with on their own. Two
deviations from the spec's table are documented in that file — the final view's
scale, and the mobile hero's — both because the tabled size does not fit on one
screen beside the copy that has to sit under it.

The pendant goes dark between the "what it does" section and the story. That is
deliberate: the four lines are the most typographic screen on the site and the
object's travel crosses them. It keeps moving; only the lights are off.

### The story scene

"How it works" is one sticky screen over a wide scene (`src/sections/Story.tsx`):
the pendant, the phone and the computer laid out left to right, and a camera
that pans between them following a packet of information — the spoken words
fold into a slip of transcript that flies to the phone, and one task flies on
to the computer. The pendant in the first station is the real one: the scene
publishes where it has put it every frame through `src/three/storyAnchor.ts`
and the rig places the model there, so the object pans off with the scene.

Every position is a number on a 2600 × 720 strip at the top of that file, and
the choreography is a list of progress ranges in one frame callback. Phones,
short screens and reduced motion get the stacked version instead.

### The handover to the checkout

Pressing any preorder button on the landing page runs `OrderTransition`: the
model spins up and rushes the camera on a canvas of its own (`SpinStage.tsx`),
and the route swaps under the paper blow-out. It only runs when the model is
already in memory (`data-3d="ready"`) and motion is welcome; otherwise it is a
plain navigation. Middle-click and modifier keys still open the real URL.

### The material tune, and why it is not "as exported"

The export gives the shell `metallic 0.92` over a base of `#1A1A1C`. For a
metal, base colour *is* reflectance — that is about 1% in linear terms, so no
lighting rig recovers it; driving the panels bright enough to lift the face
blows out the mic mesh and the chamfers first. `TUNING` in `Pendant.tsx` gives
it the reflectance bead-blasted anodised aluminium actually has, and blurs the
front panel enough that it stops mirroring the lighting rig as rectangles.

Two things to know before adjusting the rig in `PendantScene.tsx`:

- **drei aims every lightformer at the origin.** Their `rotation` props are
  overridden; position is what places them.
- **A wide bright panel becomes a slab across the face.** The chamfer highlights
  have to come from narrow strips. The two large round sources are large and
  round on purpose — a small or square one reflects as a small square.

### Regenerating the posters

`/poster` renders one rig state, centred and frozen, from the same scene. That
is how `img/poster-{a,b,c}.webp` and `img/og.jpg` were made, and it is why the
still fallback lines up with the canvas it replaces.

```bash
npm run dev
# screenshot http://localhost:5173/poster?state=a at 1600 × 1600  (b, c)
# screenshot http://localhost:5173/poster?state=og at 1200 × 630
node scripts/poster-desk-fill.mjs shot.png
cwebp -resize 1600 1600 -q 90 -alpha_q 100 -exact -m 6 shot.desk.png \
  -o public/img/poster-a.webp
```

Screenshot `a`, `b` and `c` at **2× device scale** (3200 px) with the page
background omitted (Playwright's `deviceScaleFactor: 2` and
`omitBackground: true`), so the PNG is the object on transparency and the
resize above is a supersample. Rendered at 1600 and encoded as-is, the
silhouette is a staircase: it is a hard edge against a plain ground, with no
detail to lose it in.

The stills are transparent, and the fill step is not optional. `-exact` keeps
the colour under the transparent pixels, which is what stops the object's edge
fringing when the browser scales it — but a screenshot leaves that colour pure
black, and a renderer that drops the alpha then paints a black rectangle the
shape of the image box, behind the pendant, on the hero. The script repaints
it the desk so that failure shows nothing. It changes nothing a reader can
see, and refuses to write a file in which any pixel came out coloured that was
not: the site is monochrome, so a saturated pixel in a still is damage.

`og` alone keeps its ink ground and skips all of this — it is composited by
other people's link previews.

Each poster is a square render whose framing matches its state exactly, which
is why `PosterFallback` displays every one of them at `100vh` square positioned
on its state's anchor. Break that invariant and the fallback stops lining up.

### When there is no canvas

`useCanRender3D` refuses WebGL on a failed context, four cores or fewer, four
gigabytes or less, or `prefers-reduced-motion`. Any one of them and the page
uses `PosterFallback` instead. The landing page reads completely either way:
the story section stacks into five panels, the differentiator shows all four of
its states, and nothing that carries meaning lives only in the movement.

## Scroll

`src/lib/scroll.ts` is the page's one clock: one listener, one rAF loop, one
damped value, and sections registered by id so their geometry is measured once
rather than read back every frame.

Two rules it exists to enforce:

1. **Nothing hijacks the scroll.** Pins are `position: sticky`.
2. **Continuous values never touch React.** A scrubbed value changes sixty
   times a second; subscribers write a CSS custom property or a three.js
   object directly. React state is only for things that change a handful of
   times, like which story step is active.

The counted-in reveals (`--reveal`, `--tasks`, `--status`, `--sweep`) are pure
CSS in `index.css`, driven by a counter the parent writes once a frame.

## Imagery

`public/img/` holds only what ships: three lifestyle photographs and the
pendant flat-lay, each at 600/900/1200 in WebP and AVIF, plus the three posters
and the OG image. About 165 KB reaches a desktop landing page.

The photographs are 4:5 crops of the originals in git history, graded to sit in
the monochrome palette — saturation to 0.88, a touch of magenta out of the
greens, warmed highlights, and blacks lifted to #101012 so they do not punch a
hole in the page:

```bash
ffmpeg -i use-cafe.webp -vf \
  "crop=1200:1500:0:27,eq=saturation=0.88,colorbalance=gm=-0.05:rh=0.05:bh=-0.04,curves=all='0/0.062 0.5/0.5 1/1'" \
  full.png
cwebp -q 80 -m 6 full.png -o public/img/use-cafe-1200.webp
avifenc -q 62 -s 6 full.png public/img/use-cafe-1200.avif
```

**Pick any new reference frames from the front.** An earlier generation used a
frame showing the dished back, and every model ended up wearing the pendant the
wrong way round. Any regeneration prompt has to say the outward face is flat and
plain, with a microphone opening and no circular dish.

## Layout

```
src/
  data/
    content.ts        every word on the site, and the nine slots
docs/
  design-spec.md      the design specification the site was built from
    pricing.ts        the two plans, the add-on, priceOrder(), validation
    payment.ts        Razorpay wiring — the file to edit
  lib/
    scroll.ts         the page's clock
    hooks.ts          stages, frames, media queries, the WebGL probe
  three/
    rig.ts            the four states and the timeline. No React, no three.js
    Pendant.tsx       the GLB: normalising, material cloning, the tune
    PendantScene.tsx  the lighting rig and the per-frame driver
    PendantStage.tsx  the canvas — everything three.js is behind this import
    PendantCanvas.tsx capability probe, poster swap, frameloop gating
    PosterFallback.tsx
  sections/           one file per landing-page section, in page order
  components/
    Stage.tsx         the shared visual language of the transformation
    checkout/         shell, fields, summary, plan controls
  pages/              Landing, Choose, Details, Pay, Confirmed, Policy, Poster
public/
  models/pendant.glb  255 KB, meshopt
  img/                three photographs, one flat-lay, three posters, OG
```

## Before it goes live

| What | Where |
|---|---|
| The nine slots | `src/data/content.ts` — see above |
| Payment | `src/data/payment.ts` |
| Prices | `PLANS` and `AUTOMATION` in `src/data/pricing.ts` |
| Quantity cap | `MAX_QUANTITY` in `src/data/pricing.ts` |
| Order references | `makeReference()` in `src/order/OrderContext.tsx` — replace with whatever your backend issues |
