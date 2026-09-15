/**
 * The desktop app, as the website has to describe it.
 *
 * Everything a build is called is decided in `desktop/electron-builder.yml`
 * and everything about where it sits is decided by the publish job in
 * `.github/workflows/desktop-release.yml`. This file is the third copy of
 * those two facts and the only one a page reads, so a rename in either place
 * is a rename here.
 *
 * The files are on this same origin, not on a GitHub release: the repository
 * is private, and a release asset there is a download that asks a stranger to
 * log in.
 */

export const DOWNLOADS = '/downloads'

export type BuildOS = 'mac' | 'windows' | 'linux'

export type Build = {
  id: string
  os: BuildOS
  /** The machine, as somebody says it out loud. */
  label: string
  /** Which one of that machine, where there is more than one. */
  detail: string
  file: string
}

export const BUILDS: readonly Build[] = [
  {
    id: 'mac-arm64',
    os: 'mac',
    label: 'macOS',
    detail: 'Apple silicon',
    file: 'LYZN-Daemon-mac-arm64.dmg',
  },
  { id: 'mac-x64', os: 'mac', label: 'macOS', detail: 'Intel', file: 'LYZN-Daemon-mac-x64.dmg' },
  {
    id: 'windows',
    os: 'windows',
    label: 'Windows',
    detail: '64-bit installer',
    file: 'LYZN-Daemon-windows-x64.exe',
  },
  {
    id: 'linux',
    os: 'linux',
    label: 'Linux',
    detail: 'AppImage, 64-bit',
    file: 'LYZN-Daemon-linux-x64.AppImage',
  },
]

export function buildHref(build: Build) {
  return `${DOWNLOADS}/${build.file}`
}

/**
 * The three machines, as the page offers them.
 *
 * A Mac has two builds and the page has one tile for it: the chip is not in
 * a user agent, so the tile offers the one nearly everybody wants and keeps
 * the other a line below rather than making the reader choose between two
 * identical-looking buttons.
 */
export type Platform = {
  os: BuildOS
  label: string
  primary: Build
  /** The other build for the same machine, where there is one. */
  alternate?: Build
}

const byId = (id: string) => BUILDS.find((b) => b.id === id)!

export const PLATFORMS: readonly Platform[] = [
  { os: 'mac', label: 'macOS', primary: byId('mac-arm64'), alternate: byId('mac-x64') },
  { os: 'windows', label: 'Windows', primary: byId('windows') },
  { os: 'linux', label: 'Linux', primary: byId('linux') },
]

/**
 * Which machine is reading this, or nothing.
 *
 * Only ever used to put one download first — every build is listed whatever
 * this says, because a user agent is a guess and a wrong guess that hides
 * the file somebody wants is worse than no guess at all.
 *
 * Phones and tablets are `null` on purpose rather than falling through to
 * "Linux" on Android or "macOS" on an iPad, both of which their user agents
 * would otherwise claim. There is no build for either, and the page says so.
 */
export function readingFrom(userAgent: string): BuildOS | null {
  if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return null
  if (/Mac/i.test(userAgent)) return 'mac'
  if (/Win/i.test(userAgent)) return 'windows'
  if (/Linux|X11/i.test(userAgent)) return 'linux'
  return null
}

/** True for a phone or a tablet, which cannot run any of this. */
export function isHandheld(userAgent: string) {
  return /Android|iPhone|iPad|iPod/i.test(userAgent)
}

/**
 * What the release workflow leaves beside the installers.
 *
 * Its absence is a state the page has to render: before the first release
 * there is no `latest.json` and no files, and four buttons that 404 would be
 * a worse answer than saying so.
 */
export type Latest = {
  version: string
  /** ISO 8601, stamped when the release was published. */
  published: string
  /** The revision it was built from. Shown nowhere; useful in a bug report. */
  commit?: string
}

export function isLatest(value: unknown): value is Latest {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<Latest>
  return typeof v.version === 'string' && typeof v.published === 'string'
}

/** `10 September 2026`, or nothing if the stamp does not parse. */
export function releasedOn(iso: string) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}
