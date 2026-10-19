import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { ROOT } from './helpers/load-bundle.mjs'

/**
 * Render the plugin's Plugins-page configuration form with real React.
 *
 * The form is the artifact a port most easily gets wrong: a missing dictionary
 * key, a field the host never sends, an `inject` face that does not match what
 * the slot renderer calls, or an uncontrolled input. Rendering it through
 * `react-dom/server` turns all of those into a failing test instead of a broken
 * plugin detail page.
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

/** Render once; the form is deterministic for a fixed host snapshot. */
async function renderPage() {
  const { stdout } = await run(process.execPath, [path.join(ROOT, 'test', 'helpers', 'render-page.mjs')], {
    cwd: ROOT,
    maxBuffer: 8 * 1024 * 1024,
  })
  return JSON.parse(stdout.trim().split('\n').at(-1))
}

const report = await renderPage()

test('the configuration form renders without throwing', () => {
  assert.deepEqual(report.failures, [])
  assert.ok(report.markup.length > 1000, 'the form must render real markup')
})

test('the form registers into the plugin detail page, not the Settings page', () => {
  // A plugin's own configuration belongs on the Plugins page: the
  // `plugins.bundle.config` slot is keyed by the BUNDLE's package name, and the
  // page renders the entry inside the plugin detail. `settings.section` still
  // renders, but registering there as well would give the plugin two
  // configuration pages — this form must name exactly one slot.
  assert.equal(report.registered.slot, 'plugins.bundle.config')
  assert.equal(report.registered.key, '@zhz8888/dsh-android-emulator-helper')
  assert.equal(report.registered.locale, 'settings.androidEmulatorHelper')
  assert.deepEqual(report.registered.slots, ['plugins.bundle.config'])
})

test('the injected face carries the form actions and the view the page asks for', () => {
  // The page asks for `view: 'page'`; there is no summary view for a bundle's
  // own configuration, and the form needs no `label` of its own because the
  // page draws the title.
  assert.deepEqual(report.registered.injectKeys, [
    'discard',
    'edit',
    'loadInventory',
    'loadStatus',
    'resetField',
    'save',
    't',
    'useAndroidEmulatorSettings',
    'view',
  ])
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

test('a switch does not repeat its state as on/off text', () => {
  // The track already shows the state; a neighbouring label only says it twice.
  assert.ok(!/>on<\/span>/.test(report.markup), 'the track already shows the state')
  assert.ok(!/>off<\/span>/.test(report.markup))
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

test('an overridden value shows the badge and its reset control', () => {
  // The fake host stores a user override for one field, so the shared form
  // marks it and offers the reset. Both are harness behaviour, but the page is
  // what has to place them inside the field frame.
  assert.match(report.markup, />Overridden</)
  assert.match(report.markup, />Reset to default</)
})

test('a host that does not serve the namespace renders no form at all', () => {
  // The registration hangs off `whileServed`, so a deployment without the host
  // half must not leave a slot entry behind.
  assert.equal(report.unserved.component, false, 'no component when the namespace is not served')
  assert.deepEqual(report.unserved.slots, [], 'no slot may be injected when the namespace is not served')
})

test('the form draws no title of its own; the plugin detail page owns the chrome', () => {
  // The page draws the plugin's title, icon, crumb and description above this
  // section. Repeating any of that here would render the plugin's name twice on
  // one screen, so the form contributes an effect note and the category cards.
  assert.ok(!report.markup.includes('aemh_title'), 'the form must not draw its own title')
  assert.ok(!/<h[12]\b/.test(report.markup), 'the form must start at section headings')
  assert.match(report.markup, /Changes are saved to this profile and take effect on the next tool call\./)
  assert.equal((report.markup.match(/aemh_group"/g) ?? []).length >= 6, true, 'five field cards plus the tools card')
})

test('the action bar stays out of the form while nothing is staged', () => {
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
