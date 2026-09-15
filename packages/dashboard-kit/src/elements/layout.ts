// The frame a dashboard is laid out in: a page, a grid, sections, cards, tabs.
//
// These keep the children the agent wrote and add only their own heading, so a
// page reads the same in the HTML as on screen.
import { getContext, on, unref } from '../bridge.ts'
import { ago } from '../format.ts'
import { define, h } from '../element.ts'

class LzPage extends HTMLElement {
  private built = false
  private stamp: HTMLElement | null = null

  connectedCallback() {
    if (this.built) return
    this.built = true
    const title = this.getAttribute('title')
    const subtitle = this.getAttribute('subtitle')
    if (title) this.removeAttribute('title')
    this.stamp = h('p', { class: 'lz-page-stamp' })
    const header = h(
      'header',
      { class: 'lz-page-head' },
      h('div', {}, title ? h('h1', { class: 'lz-page-title' }, title) : null, subtitle ? h('p', { class: 'lz-page-sub' }, subtitle) : null),
      this.stamp,
    )
    this.prepend(header)
    this.dataset.title = title ?? ''
    const paint = () => {
      const ctx = getContext() as { updatedAt?: string } | null
      if (this.stamp) this.stamp.textContent = ctx?.updatedAt ? `Updated ${ago(ctx.updatedAt)}` : ''
      // A page with nothing to say up top starts with its content, not a gap.
      header.hidden = !title && !subtitle && !this.stamp?.textContent
    }
    paint()
    on('context', paint)
    unref(setInterval(paint, 30_000))
  }
}

class LzGrid extends HTMLElement {
  static get observedAttributes() {
    return ['cols']
  }
  connectedCallback() {
    this.apply()
  }
  attributeChangedCallback() {
    this.apply()
  }
  private apply() {
    const cols = Math.max(1, Math.min(6, Number(this.getAttribute('cols')) || 2))
    this.style.setProperty('--lz-cols', String(cols))
  }
}

class LzSection extends HTMLElement {
  private built = false
  connectedCallback() {
    if (this.built) return
    this.built = true
    const title = this.getAttribute('title')
    const subtitle = this.getAttribute('subtitle')
    if (!title) return
    this.removeAttribute('title')
    this.prepend(
      h('header', { class: 'lz-section-head' }, h('h2', {}, title), subtitle ? h('p', { class: 'lz-section-sub' }, subtitle) : null),
    )
  }
}

class LzCard extends HTMLElement {
  private built = false
  connectedCallback() {
    if (this.built) return
    this.built = true
    const title = this.getAttribute('title')
    const subtitle = this.getAttribute('subtitle')
    if (!title && !subtitle) return
    this.removeAttribute('title')
    this.prepend(
      h(
        'header',
        { class: 'lz-card-head' },
        title ? h('h3', {}, title) : null,
        subtitle ? h('p', { class: 'lz-card-sub' }, subtitle) : null,
      ),
    )
  }
}

class LzTab extends HTMLElement {}

class LzTabs extends HTMLElement {
  private watcher: MutationObserver | null = null
  private count = 0
  private selected = -1

  connectedCallback() {
    // The kit loads in the head, so the parser connects this element before any
    // of its lz-tab children exist, and a script may add tabs later. Watching
    // its own children, and rebuilding the strip whenever their number changes,
    // covers both without guessing when parsing is done.
    if (!this.watcher) {
      this.watcher = new MutationObserver(() => this.sync())
      this.watcher.observe(this, { childList: true })
    }
    this.sync()
  }

  disconnectedCallback() {
    this.watcher?.disconnect()
    this.watcher = null
  }

  private sync() {
    const tabs = [...this.children].filter((c): c is LzTab => c.tagName === 'LZ-TAB')
    if (tabs.length === this.count) return
    this.count = tabs.length
    this.querySelector(':scope > .lz-tabstrip')?.remove()
    if (tabs.length === 0) return

    const strip = h('div', { class: 'lz-tabstrip', role: 'tablist' })
    const buttons = tabs.map((tab, i) => {
      tab.id = tab.id || `lz-tab-${Math.random().toString(36).slice(2, 8)}`
      tab.setAttribute('role', 'tabpanel')
      const b = h('button', { type: 'button', role: 'tab', 'aria-controls': tab.id }, tab.getAttribute('label') ?? `Tab ${i + 1}`)
      b.addEventListener('click', () => select(i))
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
        const next = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
        select(next)
        buttons[next].focus()
      })
      strip.append(b)
      return b
    })
    const select = (n: number) => {
      this.selected = n
      tabs.forEach((tab, i) => {
        tab.hidden = i !== n
        buttons[i].setAttribute('aria-selected', String(i === n))
        buttons[i].tabIndex = i === n ? 0 : -1
      })
      // A chart drawn while hidden measured zero width.
      tabs[n].querySelectorAll('lz-chart,lz-sparkline').forEach((c) => (c as HTMLElement & { redraw?: () => void }).redraw?.())
    }
    this.prepend(strip)
    const marked = tabs.findIndex((t) => t.hasAttribute('selected'))
    select(this.selected >= 0 && this.selected < tabs.length ? this.selected : marked >= 0 ? marked : 0)
  }
}

export function defineLayout() {
  define('lz-page', LzPage)
  define('lz-grid', LzGrid)
  define('lz-section', LzSection)
  define('lz-card', LzCard)
  define('lz-tab', LzTab)
  define('lz-tabs', LzTabs)
}
