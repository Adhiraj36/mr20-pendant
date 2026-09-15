import { useSyncExternalStore } from 'react'
import { INK_STORAGE_KEY, inks } from '@lyzn/design'

/**
 * The six printer inks.
 *
 * The reader picks the colour the headings are set in, the way a press
 * operator picks a plate. One attribute on `<html>` and the cascade does the
 * rest: `[data-ink="…"]` sets `--heading`, and `h1, h2, h3` read it. Nothing
 * here manipulates colour, and nothing but a heading changes — not the
 * stamp, not the buttons, not a rule.
 *
 * The list is `inks` in @lyzn/design and nothing below is a copy of it: this
 * module is the picker's view of that list, the `[data-ink]` rules the
 * cascade reads are generated from it, and the app will read the same ids
 * when an account syncs a pick. The ids and the key are plain strings rather
 * than an enum for exactly that reason.
 *
 * One copy is unavoidable: the pre-paint bootstrap in `web/index.html` has to
 * run before any module is fetched, so it repeats the key and the ids inline.
 * Change them in the package and change that script too.
 */

export const STORAGE_KEY = INK_STORAGE_KEY

export type InkId = (typeof inks)[number]['id']

export type Ink = {
  id: InkId
  hex: string
  label: string
  /** The ink the page is set in when nothing has been picked. */
  default?: boolean
}

export const INKS: readonly Ink[] = inks

/* The one the package flags, rather than the id 'ink' written down a second
   time. The fallback is only for the type — a list with no default is not a
   list this picker could show — and it keeps this an InkId, not an optional
   one. */
export const DEFAULT_INK: InkId = (INKS.find((i) => i.default) ?? INKS[0]!).id

const IDS = INKS.map((i) => i.id)

function isInkId(value: unknown): value is InkId {
  return typeof value === 'string' && (IDS as string[]).includes(value)
}

/* Storage is a privilege, not a right: Safari in private mode throws on
   read as well as write, and a page that can only ever be the default ink
   is a better outcome than a page that does not render. */
function store(id: InkId) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* no persistence available; the pick still holds for this page view */
  }
}

function load(): InkId {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return isInkId(value) ? value : DEFAULT_INK
  } catch {
    return DEFAULT_INK
  }
}

/* ─────────────────────────────────────────────────────────────
   The store. Both rows — the one in the header and the one in the
   footer — show the same pick, so the pick lives in one place and
   they subscribe to it rather than each keeping their own copy.
   ───────────────────────────────────────────────────────────── */

const subscribers = new Set<() => void>()

/** Read straight off `<html>`, which the bootstrap script has already set. */
function fromDocument(): InkId {
  if (typeof document === 'undefined') return DEFAULT_INK
  const value = document.documentElement.getAttribute('data-ink')
  return isInkId(value) ? value : DEFAULT_INK
}

let current: InkId = fromDocument()

/**
 * Puts an ink on the page, and optionally remembers it.
 *
 * The default ink removes the attribute rather than setting `data-ink="ink"`,
 * so `--heading` goes undefined and the headings fall back to the tone they
 * would have had if this feature did not exist.
 */
export function applyInk(id: InkId, persist: boolean) {
  if (id === DEFAULT_INK) document.documentElement.removeAttribute('data-ink')
  else document.documentElement.setAttribute('data-ink', id)

  if (persist) store(id)

  if (current === id) return
  current = id
  subscribers.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

/** The ink the page is currently set in. */
export function useInk(): InkId {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT_INK,
  )
}

/**
 * Reconciles the attribute the bootstrap wrote with what is in storage.
 *
 * The bootstrap only ever sets a non-default ink, so a page that starts on
 * the default has nothing on `<html>` and this is a no-op. It exists for the
 * case where storage says one thing and the document another — a second tab
 * that picked an ink after this one loaded, say.
 */
export function hydrateInk() {
  applyInk(load(), false)
}
