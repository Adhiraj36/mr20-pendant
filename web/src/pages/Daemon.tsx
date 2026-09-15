import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Footer } from '@/components/Footer'
import { Nav } from '@/components/Nav'
import { DaemonScreen } from '@/components/DaemonScreen'
import { LaptopFrame } from '@/components/Frames'
import { PlatformMark } from '@/components/PlatformMark'
import { Eyebrow } from '@/components/Section'
import {
  DOWNLOADS,
  PLATFORMS,
  buildHref,
  isHandheld,
  isLatest,
  readingFrom,
  releasedOn,
  type BuildOS,
  type Latest,
} from '@/data/daemon'
import { track } from '@/lib/posthog'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { cn } from '@/lib/utils'

/** Loading, a release, or no release yet — three states the page must draw. */
type Release = 'looking' | Latest | null

/**
 * What a reader is told will happen the first time they open it.
 *
 * Nothing here is code-signed. An unsigned dmg makes Gatekeeper say the app
 * is from an unidentified developer and an unsigned installer makes
 * SmartScreen say much the same, and a person who has not been warned reads
 * either as "this is malware". Saying it first, plainly, costs a paragraph
 * and buys the only thing that matters on a download page, which is that the
 * page turned out to be telling the truth.
 */
const FIRST_RUN: Record<BuildOS, { label: string; body: string }> = {
  mac: {
    label: 'On a Mac',
    body: 'macOS will say the app is from an unidentified developer and refuse the first double-click. Control-click the app in Applications, choose Open, and confirm once. It opens normally after that.',
  },
  windows: {
    label: 'On Windows',
    body: 'SmartScreen will put up a blue panel saying it protected your PC. Choose More info, then Run anyway. The installer does not ask for an administrator.',
  },
  linux: {
    label: 'On Linux',
    body: 'An AppImage is one file and installs nothing. Make it executable — chmod +x on the file, or Properties, Permissions, Allow executing — and run it.',
  },
}

const WHAT_IT_DOES = [
  {
    label: 'On your machine',
    body: 'The work takes a shell, your files and the accounts you are already signed into. None of those exist in a cloud that only heard the sentence, which is why this half runs where you are.',
  },
  {
    label: 'Only what you approved',
    body: 'LYZN shows you what you committed to. Nothing here starts until you say so, and anything sensitive asks again.',
  },
  {
    label: 'And says what it did',
    body: 'Every finished task keeps a receipt: what was asked, what was done, where it went and how long it took.',
  },
]

/**
 * The download page for the desktop app.
 *
 * The installers are files on this same origin, published by the desktop
 * workflow into `downloads/` — see src/data/daemon.ts. `latest.json` lands
 * beside them, and its absence is the honest state of a product whose first
 * build has not been cut: this page says that rather than offering four
 * buttons that would 404.
 */
export function Daemon() {
  useDocumentTitle('LYZN Daemon — the half that does the work')

  const [release, setRelease] = useState<Release>('looking')
  const [os, setOs] = useState<BuildOS | null>(null)
  const [handheld, setHandheld] = useState(false)

  useEffect(() => {
    setOs(readingFrom(navigator.userAgent))
    setHandheld(isHandheld(navigator.userAgent))
  }, [])

  useEffect(() => {
    let live = true
    fetch(`${DOWNLOADS}/latest.json`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (live) setRelease(isLatest(body) ? body : null)
      })
      // A miss is served the single-page app's own index.html rather than a
      // 404 — see the errorResponses in backend/lib/web-stack.ts — so "no
      // release yet" arrives here as HTML that will not parse.
      .catch(() => {
        if (live) setRelease(null)
      })
    return () => {
      live = false
    }
  }, [])

  const ready = release !== 'looking' && release !== null
  // The reader's own machine first. All three are shown whatever this says:
  // a user agent is a guess, and a wrong one that buries the file somebody
  // came for is worse than not guessing.
  const platforms = os
    ? [...PLATFORMS].sort((a, b) => Number(b.os === os) - Number(a.os === os))
    : PLATFORMS

  return (
    <div className="on-paper">
      <Nav />

      <main>
        <section className="shell pt-32 pb-14 sm:pt-40">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:gap-16">
            <div>
              <Eyebrow>LYZN · Daemon</Eyebrow>
              <h1 className="display-xl mt-5 max-w-[13ch]">The half that does the work.</h1>
              <p className="body-l mt-6 max-w-[44ch] text-tone-muted">
                LYZN hears what you promised and writes it down. This is the part that keeps it: it
                runs on your own computer, does the work you approved, and hands back a receipt for
                each one.
              </p>
            </div>

            {/* The app, drawn in the site's own line and type rather than
                photographed — see DaemonScreen. It is the same laptop the
                story draws, because it is the same machine. */}
            <div className="aspect-[640/440] w-full max-w-[520px] justify-self-center lg:justify-self-end">
              <LaptopFrame>
                <DaemonScreen />
              </LaptopFrame>
            </div>
          </div>
        </section>

        <section aria-labelledby="get-it" className="shell pb-16">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="get-it" className="display-m">
              Get it
            </h2>
            <p className="label-sm text-tone-faint">
              {release === 'looking'
                ? 'Looking'
                : ready
                  ? `Version ${release.version} · ${releasedOn(release.published)}`
                  : 'Not out yet'}
            </p>
          </div>

          {handheld && (
            <p className="mt-5 max-w-[52ch] text-[15px] text-tone-muted">
              This one is for a computer. Open{' '}
              <span className="font-mono text-[13px] text-tone">lyzn.ai/daemon</span> on the machine
              you want it to run on — the pendant and the phone app need nothing from this page.
            </p>
          )}

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {platforms.map((platform) => {
              const mine = platform.os === os
              return (
                <div
                  key={platform.os}
                  className={cn(
                    'flex flex-col gap-4 bg-tone-panel p-6',
                    // The reader's own machine wears the border the selected
                    // tier card wears, and the padding is adjusted by the
                    // width of it so the three tiles stay the same size.
                    mine ? 'border-2 border-tone-fg p-[23px]' : 'border border-tone-line',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <PlatformMark os={platform.os} className="size-7 text-tone" />
                    {mine && <span className="label-sm text-tone-faint">Yours</span>}
                  </div>

                  <div>
                    <p className="text-[17px] text-tone">{platform.label}</p>
                    <p className="label-sm mt-1.5 text-tone-faint">{platform.primary.detail}</p>
                  </div>

                  {ready ? (
                    <div className="mt-auto flex flex-col gap-2 pt-2">
                      {/* An anchor, not a button: these are files at
                          addresses, so middle-click and copy-link work. The
                          click is tracked but never prevented — the download
                          must still happen on a slow or blocked request. */}
                      <a
                        href={buildHref(platform.primary)}
                        className="btn btn-primary btn-full"
                        onClick={() =>
                          track('daemon_download_clicked', {
                            os: platform.os,
                            variant: 'primary',
                            ownPlatform: mine,
                          })
                        }
                      >
                        Download
                      </a>
                      {platform.alternate && (
                        <a
                          href={buildHref(platform.alternate)}
                          className="link text-center text-[13px] text-tone-muted"
                          onClick={() =>
                            track('daemon_download_clicked', {
                              os: platform.os,
                              variant: 'alternate',
                              ownPlatform: mine,
                            })
                          }
                        >
                          {platform.alternate.detail} Mac
                        </a>
                      )}
                    </div>
                  ) : (
                    <p className="mt-auto pt-2 text-[14px] text-tone-faint">
                      {release === 'looking' ? 'Looking…' : 'Not out yet'}
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          {release === null && (
            <p className="mt-5 max-w-[52ch] text-[15px] text-tone-muted">
              The first build is not published yet. It arrives at these three addresses the day it
              is cut — nothing about this page changes, the buttons simply work.
            </p>
          )}

          <p className="mt-5 max-w-[720px] text-[14px] text-tone-faint">
            Free, and part of a LYZN device. It does nothing on its own — it is the machine end of a
            pendant.
          </p>
        </section>

        <section aria-labelledby="what" className="shell pb-16">
          <h2 id="what" className="sr-only">
            What it does
          </h2>
          <dl className="grid max-w-[900px] gap-8 border-t border-tone-line pt-8 sm:grid-cols-3">
            {WHAT_IT_DOES.map((item) => (
              <div key={item.label}>
                <dt className="label text-tone">{item.label}</dt>
                <dd className="mt-3 text-[15px] leading-relaxed text-tone-muted">{item.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="first-run" className="shell pb-24">
          <div className="max-w-[720px] border-t border-tone-line pt-8">
            <h2 id="first-run" className="display-m">
              The first time you open it
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-tone-muted">
              These builds are not code-signed yet. Every operating system will say so, in its own
              words, and each one is worth reading before you click past it.
            </p>

            <dl className="mt-8 flex flex-col gap-6">
              {(Object.keys(FIRST_RUN) as BuildOS[]).map((key) => (
                <div key={key}>
                  <dt className="label-sm text-tone-faint">{FIRST_RUN[key].label}</dt>
                  <dd className="mt-2 text-[15px] leading-relaxed text-tone-muted">
                    {FIRST_RUN[key].body}
                  </dd>
                </div>
              ))}
            </dl>

            <Link to="/" className="link mt-10 inline-block text-tone-muted">
              Back to LYZN
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
