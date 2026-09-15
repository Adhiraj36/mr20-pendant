// The document an agent's dashboard HTML becomes before it reaches the frame.
//
// No electron import here: this is the one place an untrusted string turns
// into markup the app will render, so it has to be checkable by a plain unit
// test rather than only by opening the app and looking.

/** Sent both as a meta tag inside the document and as the response header —
 *  belt and suspenders, so a page cannot loosen the policy just by not
 *  reading it. */
export const DASHBOARD_CSP =
  "default-src 'none'; script-src lyzn-dash: 'unsafe-inline'; style-src lyzn-dash: 'unsafe-inline'; img-src lyzn-dash: data:; font-src lyzn-dash:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"

/** Tags a dashboard must never keep: `http-equiv` can restate the page's own
 *  CSP looser than ours (or redirect it), and `<base>` can repoint every
 *  relative URL on the page — both are ways to escape a sandbox that
 *  otherwise has no network of its own. */
function stripDangerousTags(html: string): string {
  return html.replace(/<meta\b[^>]*\bhttp-equiv\b[^>]*>/gi, '').replace(/<base\b[^>]*>/gi, '')
}

/** `<style>` blocks and `<link rel="stylesheet">` tags from an agent's own
 *  `<head>`, kept in the order they were written. Everything else a head can
 *  hold — title, other meta, other links — has no equivalent here and is
 *  simply not carried forward. */
function extractHeadAssets(headHtml: string): string {
  const parts: string[] = []
  const tagRe = /<style\b[^>]*>[\s\S]*?<\/style>|<link\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(headHtml))) {
    const tag = m[0]
    if (/^<link/i.test(tag)) {
      if (/\brel\s*=\s*["']?stylesheet["']?/i.test(tag)) parts.push(tag)
    } else {
      parts.push(tag)
    }
  }
  return parts.join('')
}

function extractBody(html: string): string {
  const closed = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)
  if (closed) return closed[1]
  // Malformed markup with no closing tag: take everything after the opening
  // one rather than discard a real dashboard over a missing </body>.
  const open = /<body\b[^>]*>/i.exec(html)
  return open ? html.slice(open.index + open[0].length) : html
}

/** Turn an agent's dashboard HTML — a fragment, or a full document — into the
 *  page `lyzn-dash://page/<id>` serves. Pure and synchronous: given the same
 *  string, always the same document, which is what makes it testable without
 *  Electron. */
export function buildDashboardDocument(agentHtml: string, theme: 'light' | 'dark' = 'light'): string {
  const isFullDocument = /<body[\s>]/i.test(agentHtml)
  let headExtra = ''
  let body = agentHtml

  if (isFullDocument) {
    const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(agentHtml)
    if (head) headExtra = extractHeadAssets(head[1])
    body = extractBody(agentHtml)
  }

  body = stripDangerousTags(body)
  headExtra = stripDangerousTags(headExtra)

  return (
    '<!doctype html>' +
    `<html data-theme="${theme}">` +
    '<head>' +
    '<meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${DASHBOARD_CSP}">` +
    '<link rel="stylesheet" href="lyzn-dash://kit/lz-kit.css">' +
    '<script src="lyzn-dash://kit/lz-kit.js"></script>' +
    headExtra +
    '</head><body>' +
    body +
    '</body></html>'
  )
}
