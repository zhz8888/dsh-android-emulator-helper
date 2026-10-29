import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT, STATIC_MODULES, loadBundle } from './helpers/load-bundle.mjs'

/**
 * Structural verification of the browser bundle.
 *
 * The client half is a hand-written `window.__ModuleLoader__.load({…})` script,
 * not a build artifact, so nothing else would catch a bundle the host cannot
 * load. These tests execute it against the shell's own contract: a classic
 * script, the frozen static module table, and the factory's returned exports.
 */

test('client bundle registers under the package name', () => {
  const { registration } = loadBundle()
  assert.equal(registration.id, '@zhz8888/dsh-android-emulator-helper')
  assert.equal(typeof registration.factory, 'function')
})

test('client bundle exports apply, inject and its namespace', () => {
  const { exported } = loadBundle()
  assert.equal(typeof exported.apply, 'function')
  assert.deepEqual(exported.inject, ['slots', 'locale', 'configForms'])
  assert.equal(exported.NS, 'android-emulator-helper')
})

test('a discovery dropdown keeps a saved value the discovery did not return', () => {
  // The default-AVD dropdown is filled from the discovery route, and the saved
  // value may be an AVD that was deleted, or one named before an SDK was
  // installed. A `<select>` whose value matches no option renders as nothing
  // selected, so the saved value has to be appended to the discovered list —
  // once, and only when it is not already there.
  const { exported } = loadBundle()
  assert.deepEqual(exported.DISCOVERY_OPTIONS('medium_phone', []), ['medium_phone'])
  assert.deepEqual(exported.DISCOVERY_OPTIONS('medium_phone', undefined), ['medium_phone'])
  assert.deepEqual(exported.DISCOVERY_OPTIONS('Pixel_8', ['Emulator_Only', 'Pixel_8']), ['Emulator_Only', 'Pixel_8'])
  assert.deepEqual(exported.DISCOVERY_OPTIONS('Gone', ['Pixel_8', 'Gone']), ['Pixel_8', 'Gone'], 'no duplicate option')
  assert.deepEqual(exported.DISCOVERY_OPTIONS('', ['Pixel_8']), ['Pixel_8'], 'an empty saved value is not an option')
  assert.deepEqual(exported.DISCOVERY_OPTIONS('  ', ['Pixel_8']), ['Pixel_8', '  '], 'only the empty string is skipped')
})

test('client bundle resolves only modules from the static table', () => {
  const { required } = loadBundle()
  assert.ok(required.length > 0, 'the bundle requires at least React')
  for (const specifier of required) {
    assert.ok(STATIC_MODULES.includes(specifier), `unexpected require: ${specifier}`)
  }
})

test('client bundle is a classic script, not an ES module', () => {
  const source = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.ok(!/^\s*import\s/m.test(source), 'bundle must not use import statements')
  assert.ok(!/^\s*export\s/m.test(source), 'bundle must not use export statements')
  assert.match(source, /window\.__ModuleLoader__\.load\(\{/)
})

test('client bundle tags its stylesheet for framework reclamation', () => {
  const source = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.match(source, /tag\.dataset\.pluginCss = CSS_TAG/)
  assert.match(source, /tag\.dataset\.plugin = "@zhz8888\/dsh-android-emulator-helper"/)
})
