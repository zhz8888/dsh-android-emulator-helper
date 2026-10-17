import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { ROOT } from './helpers/load-bundle.mjs'

/**
 * Render the settings page with real React.
 *
 * The page is the artifact a port most easily gets wrong: a missing dictionary
 * key, a field the host never sends, an `inject` face that does not match what
 * the slot renderer calls, or an uncontrolled input. Rendering it through
 * `react-dom/server` turns all of those into a failing test instead of a broken
 * Settings panel.
 *
 * React is real. `@deepseek-ai/dsh-client-ui-primitives` is doubled, because the
 * shipped package is a browser bundler input (`*.module.css`, `simple-icons`,
 * `zustand/vanilla`) that plain Node cannot import; the double mirrors the
 * documented contract. See `test/helpers/primitives-double.mjs`.
 *
 * The render runs in a child process so the JSON report is not polluted by
 * anything else the module graph prints.
 */

const run = promisify(execFile)

/** Render once; the page is deterministic for a fixed host snapshot. */
async function renderPage() {
  const { stdout } = await run(process.execPath, [path.join(ROOT, 'test', 'helpers', 'render-page.mjs')], {
    cwd: ROOT,
    maxBuffer: 8 * 1024 * 1024,
  })
  return JSON.parse(stdout.trim().split('\n').at(-1))
}

const report = await renderPage()

test('the settings page renders without throwing', () => {
  assert.deepEqual(report.failures, [])
  assert.ok(report.markup.length > 1000, 'the page must render real markup')
})

test('the page registers the slot entry the settings shell expects', () => {
  assert.deepEqual(report.registered, {
    id: 'android-emulator',
    order: 16,
    injectKeys: [
      'close',
      'discard',
      'edit',
      'loadInventory',
      'loadStatus',
      'resetField',
      'save',
      't',
      'useAndroidEmulatorSettings',
    ],
  })
})

test('the section label is a locale-following thunk returning the nav text', () => {
  assert.equal(report.navLabel, 'Android emulator')
})

test('every field group is rendered with its heading and hint', () => {
  for (const heading of [
    'SDK and toolchain',
    'Emulator and devices',
    'API level and system image',
    'Build',
    'Output and logs',
  ]) {
    assert.ok(report.markup.includes(heading), `missing group heading: ${heading}`)
  }
})

test('the controls carry the values the host serves, not placeholders', () => {
  // A controlled input renders its live value; the checked switch proves the
  // boolean path; the selected option proves the enum path is not blank.
  assert.match(report.markup, /value="35"/)
  assert.match(report.markup, /value="17"/)
  assert.match(report.markup, /role="switch" aria-checked="true"/)
  assert.match(report.markup, /<option value="default" selected="">/)
  assert.match(report.markup, /Automatic \(from the host\)/)
})

test('the diagnostics and discovery controls are present', () => {
  assert.match(report.markup, /Run diagnostic/)
  assert.match(report.markup, /Refresh devices and AVDs/)
  assert.match(report.markup, /Diagnostics and discovery/)
})

test('the page frames every category as its own card, under one title', () => {
  // The section draws its own title because the shell renders only the nav
  // label, and one card per category is what separates the groups: the outline
  // is the separator, so no rule sits between them.
  assert.match(report.markup, /<h2 class="aemh_title">Android Emulator<\/h2>/)
  assert.equal((report.markup.match(/aemh_group"/g) ?? []).length >= 6, true, 'five field cards plus the tools card')
})

test('the action bar stays out of the page while nothing is staged', () => {
  // The bar is the only place a save starts and it appears only when it has
  // something to act on — a staged edit, a write in flight, or a failure. A
  // clean form must render neither it nor its labels.
  assert.ok(!report.markup.includes('aemh_actions'), 'a clean form must not render the action bar')
  assert.ok(!/>Save</.test(report.markup), 'a clean form must not offer a save')
  assert.ok(!/>Discard changes</.test(report.markup), 'a clean form must not offer a discard')
})

test('no unresolved dictionary key leaks into the markup', () => {
  // `ctx.locale.bind` returns the key itself for a missing entry, which is what
  // a typo in one of the generated keys would look like.
  assert.ok(!/field\.[A-Za-z]+/.test(report.markup), 'an unresolved field key leaked into the markup')
  assert.ok(!/group\.[A-Za-z]+/.test(report.markup), 'an unresolved group key leaked into the markup')
})
