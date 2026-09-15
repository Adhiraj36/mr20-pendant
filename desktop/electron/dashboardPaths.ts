// Where the dashboard kit's built files and the app's own shipped pages live,
// resolved the same way whether this is a dev checkout or a packaged app.
//
// fs/path only — no electron import — so a build with no kit dist yet (the
// kit is a sibling package someone else is still writing) can be exercised by
// a plain unit test instead of by launching the app and finding a blank frame.
import fs from 'node:fs'
import path from 'node:path'

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.md': 'text/markdown',
}

export function contentTypeFor(filePath: string): string | null {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? null
}

/** Resolve a request path against a root, refusing anything that would land
 *  outside it. A dashboard's HTML is agent-written, so the `<file>` in
 *  `lyzn-dash://kit/<file>` is not a name to trust — plain `..`, an absolute
 *  path, and a percent-encoded `..` must all fail the same way. */
export function safeJoin(root: string, requestPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    return null
  }
  if (decoded.includes('\0') || path.isAbsolute(decoded)) return null

  const resolvedRoot = path.resolve(root)
  const joined = path.resolve(resolvedRoot, decoded)
  const rel = path.relative(resolvedRoot, joined)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return joined
}

/** The kit's own dist: packaged-and-built first, then a sibling workspace
 *  package for a dev checkout that has not run the copy step yet. */
export function kitRoots(appPath: string): string[] {
  return [
    path.join(appPath, 'dist', 'renderer', 'dashboard-kit'),
    path.join(appPath, '..', 'packages', 'dashboard-kit', 'dist'),
  ]
}

/** A kit file, tried across the fallback roots in order. Null for a path that
 *  escapes its root, has no recognised content type, or is missing everywhere
 *  the kit could be — a build with no kit yet, which must 404, not crash. */
export function resolveKitFile(
  appPath: string,
  requestPath: string,
): { path: string; contentType: string } | null {
  for (const root of kitRoots(appPath)) {
    const full = safeJoin(root, requestPath)
    if (!full) continue
    const contentType = contentTypeFor(full)
    if (!contentType) continue
    try {
      if (fs.statSync(full).isFile()) return { path: full, contentType }
    } catch {
      // Not in this root; the next one may still have it.
    }
  }
  return null
}

/** The default dashboard's page: shipped inside the built kit, or read
 *  straight from the source tree in dev. Someone else writes this file — its
 *  absence is a build-order fact, not an error. */
export function resolveDefaultPage(appPath: string): string | null {
  const candidates = [
    path.join(appPath, 'dist', 'renderer', 'dashboard-kit', 'pages', 'default.html'),
    path.join(appPath, 'src', 'dashboards', 'default.html'),
  ]
  for (const p of candidates) {
    try {
      if (fs.statSync(p).isFile()) return p
    } catch {
      // Not there; try the next candidate.
    }
  }
  return null
}
