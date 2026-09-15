// buildDashboardDocument turns whatever an agent wrote into the page
// lyzn-dash://page/<id> actually serves — the one boundary between agent
// text and rendered markup, so every rule it enforces gets a direct test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDashboardDocument, DASHBOARD_CSP } from '../electron/dashboardDocument.js'

test('a fragment becomes the body, with the kit css and script ahead of it', () => {
  const doc = buildDashboardDocument('<lz-card>Hello</lz-card>')
  assert.match(doc, /^<!doctype html>/)
  assert.match(doc, /<html data-theme="light">/)
  assert.match(doc, /<link rel="stylesheet" href="lyzn-dash:\/\/kit\/lz-kit\.css">/)
  assert.match(doc, /<script src="lyzn-dash:\/\/kit\/lz-kit\.js"><\/script>/)
  assert.match(doc, /<body><lz-card>Hello<\/lz-card><\/body>/)
})

test('a full document is reduced to its head styles and its body', () => {
  const agent =
    '<html><head><title>ignored</title><meta name="description" content="x">' +
    '<style>.x{color:red}</style>' +
    '<link rel="stylesheet" href="page.css">' +
    '<link rel="preconnect" href="https://example.com">' +
    '</head><body class="x"><lz-page>hi</lz-page></body></html>'
  const doc = buildDashboardDocument(agent)
  assert.match(doc, /<style>\.x\{color:red\}<\/style>/)
  assert.match(doc, /<link rel="stylesheet" href="page\.css">/)
  assert.doesNotMatch(doc, /preconnect/)
  assert.doesNotMatch(doc, /ignored/)
  assert.doesNotMatch(doc, /description/)
  assert.match(doc, /<body><lz-page>hi<\/lz-page><\/body>/)
})

test('a page cannot loosen its own CSP or repoint its base: both are stripped wherever they appear', () => {
  const agent =
    '<html><head><base href="https://evil.example/">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src *">' +
    '<style>.y{}</style></head><body>' +
    '<meta http-equiv="refresh" content="0;url=https://evil.example">' +
    'text</body></html>'
  const doc = buildDashboardDocument(agent)
  assert.doesNotMatch(doc, /evil\.example/)
  assert.doesNotMatch(doc, /<base/i)
  assert.match(doc, /<style>\.y\{\}<\/style>/)
  // Exactly one CSP directive in the whole document: ours.
  const cspMatches = doc.match(/Content-Security-Policy/g) ?? []
  assert.equal(cspMatches.length, 1)
})

test('the injected CSP is the exact policy the sandboxed frame gets', () => {
  const doc = buildDashboardDocument('<p>hi</p>')
  assert.ok(doc.includes(`content="${DASHBOARD_CSP}"`))
})

test('theme sets the html attribute; light is the default', () => {
  assert.match(buildDashboardDocument('<p></p>'), /data-theme="light"/)
  assert.match(buildDashboardDocument('<p></p>', 'dark'), /data-theme="dark"/)
})

test('malformed markup with no closing body tag still keeps the content', () => {
  const doc = buildDashboardDocument('<html><body><lz-stat>42</lz-stat>')
  assert.match(doc, /<body><lz-stat>42<\/lz-stat><\/body>/)
})
