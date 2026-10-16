import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config, FIELD_KEYS, readSettings, systemImagePackage } from '../lib/settings.js'

/**
 * Settings projection tests.
 *
 * The two behaviours worth pinning are the live read (a volatile reference must
 * be unwrapped on every call, not captured once) and the legacy fallback chain
 * (settings page → `ANDROID_PLUGIN_*` environment variable → declared default),
 * because the original plugin's users depend on the middle rung.
 */

/** Build a config object shaped like the one Cordis hands to `apply`. */
function liveConfig(values) {
  const out = {}
  for (const [key, value] of Object.entries(values)) {
    out[key] = { get: () => value }
  }
  return out
}

test('every declared field is a volatile node in the Config schema', () => {
  const json = Config.toJSON()
  const root = json.refs[json.uid]
  assert.equal(root.type, 'object')
  const fields = Object.keys(root.dict)
  assert.deepEqual(fields, FIELD_KEYS)
  for (const ref of Object.values(root.dict)) {
    assert.equal(json.refs[ref].meta.volatile, true, 'every field must be volatile to be live-editable')
  }
})

test('defaults are used when nothing is configured', () => {
  const settings = readSettings({}, {})
  assert.equal(settings.apiLevel, '35')
  assert.equal(settings.buildToolsVersion, '35.0.0')
  assert.equal(settings.systemImageVariant, 'default')
  assert.equal(settings.jdkMajor, '17')
  assert.equal(settings.defaultAvd, 'medium_phone')
  assert.equal(settings.autoStartEmulator, true)
  assert.equal(settings.bootTimeoutMs, 180000)
  assert.equal(settings.buildTimeoutMs, 600000)
  assert.equal(settings.minSdk, 23)
  assert.equal(settings.logTailLines, 500)
  assert.equal(settings.sdkPath, '')
  assert.equal(settings.systemImageAbi, '')
})

test('a volatile reference is read fresh on every projection', () => {
  let value = '34'
  const config = { apiLevel: { get: () => value } }
  assert.equal(readSettings(config, {}).apiLevel, '34')
  value = '36'
  assert.equal(readSettings(config, {}).apiLevel, '36', 'a settings save must reach the next call')
})

test('an empty setting falls back to the legacy environment variable, then the default', () => {
  const env = { ANDROID_PLUGIN_API_LEVEL: '33', ANDROID_PLUGIN_DEFAULT_AVD: 'pixel_7' }
  const settings = readSettings({ apiLevel: { get: () => '' } }, env)
  assert.equal(settings.apiLevel, '33')
  assert.equal(settings.defaultAvd, 'pixel_7')
  assert.equal(settings.buildToolsVersion, '35.0.0')
})

test('the settings page wins over the legacy environment variable', () => {
  const settings = readSettings({ apiLevel: { get: () => '36' } }, { ANDROID_PLUGIN_API_LEVEL: '33' })
  assert.equal(settings.apiLevel, '36')
})

test('an out-of-range select value falls back to the declared default', () => {
  const settings = readSettings({ systemImageVariant: { get: () => 'not_a_variant' } }, {})
  assert.equal(settings.systemImageVariant, 'default')
})

test('a malformed number falls back instead of reaching the providers', () => {
  const settings = readSettings(
    { bootTimeoutMs: { get: () => 'soon' }, minSdk: { get: () => -5 }, logTailLines: { get: () => 12.5 } },
    {},
  )
  assert.equal(settings.bootTimeoutMs, 180000)
  assert.equal(settings.minSdk, 23)
  assert.equal(settings.logTailLines, 500)
})

test('a non-boolean setting keeps the declared default', () => {
  assert.equal(readSettings({ autoStartEmulator: { get: () => 'yes' } }, {}).autoStartEmulator, true)
  assert.equal(readSettings({ autoStartEmulator: { get: () => false } }, {}).autoStartEmulator, false)
})

test('the system image package follows the API level, variant and ABI', () => {
  assert.equal(
    systemImagePackage({ apiLevel: '35', systemImageVariant: 'google_apis', systemImageAbi: 'x86_64' }),
    'system-images;android-35;google_apis;x86_64',
  )
})

test('an empty ABI picks the host architecture', () => {
  const expected = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64'
  assert.equal(
    systemImagePackage({ apiLevel: '34', systemImageVariant: 'default', systemImageAbi: '' }),
    `system-images;android-34;default;${expected}`,
  )
})
