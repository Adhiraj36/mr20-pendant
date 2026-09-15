import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fonts } from '../src/tokens.ts'

// fonts.json is what web/vite.config.ts reads to build the Google Fonts
// <link>, because Vite loads its config under plain Node and cannot import
// this package's .ts entry. It is generated from `fonts.google` by gen:css;
// this pins the two together so a stale file fails here, not on the site.
test('fonts.json carries fonts.google verbatim', () => {
  const json = JSON.parse(readFileSync(new URL('../fonts.json', import.meta.url), 'utf8'))
  assert.deepEqual(json, { google: fonts.google })
})
