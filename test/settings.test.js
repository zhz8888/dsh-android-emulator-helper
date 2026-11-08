import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config, FIELD_KEYS, FIELDS, readSettings, systemImagePackage } from '../lib/settings.js'
import { splitArgumentLines } from '../lib/util/run.js'

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
  assert.equal(settings.bootTimeoutSeconds, 180)
  assert.equal(settings.buildTimeoutSeconds, 600)
  assert.equal(settings.minSdk, 23)
  assert.equal(settings.logTailLines, 500)
  assert.equal(settings.sdkPath, '')
  assert.equal(settings.systemImageAbi, '')
  assert.equal(settings.showInSettings, false)
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
    { bootTimeoutSeconds: { get: () => 'soon' }, minSdk: { get: () => -5 }, logTailLines: { get: () => 12.5 } },
    {},
  )
  assert.equal(settings.bootTimeoutSeconds, 180)
  assert.equal(settings.minSdk, 23)
  assert.equal(settings.logTailLines, 500)
})

test('the schema accepts a negative and a fractional number so the entry still loads', () => {
  // Cordis validates the entry config before `apply` runs, so a value the
  // schema refuses takes the whole plugin down with it: every `android_*`
  // tool disappears instead of the one setting falling back. The number
  // fields must therefore accept everything `readSettings` is written to
  // normalise.
  const numberFields = [...FIELDS.values()].filter((field) => field.kind === 'number')
  assert.deepEqual(
    numberFields.map((field) => field.key),
    ['bootTimeoutSeconds', 'minSdk', 'buildTimeoutSeconds', 'logTailLines'],
  )
  for (const field of numberFields) {
    for (const value of [-1, 1.5, 0]) {
      assert.doesNotThrow(() => Config({ [field.key]: value }), `${field.key} must accept ${value}`)
    }
  }
})

test('a negative and a fractional number project the declared default', () => {
  // The fallback in `readSettings` is only reachable if the schema let the
  // value through, so the two halves are pinned together: the schema keeps
  // the entry loadable, the projection decides what is usable.
  const settings = readSettings(
    liveConfig({ bootTimeoutSeconds: -1, minSdk: -23, buildTimeoutSeconds: 1.5, logTailLines: 12.5 }),
    {},
  )
  assert.equal(settings.bootTimeoutSeconds, 180)
  assert.equal(settings.minSdk, 23)
  assert.equal(settings.buildTimeoutSeconds, 600)
  assert.equal(settings.logTailLines, 500)
})

test('a stored 0 is unset and projects the declared default', () => {
  const settings = readSettings(liveConfig({ bootTimeoutSeconds: 0, logTailLines: 0 }), {})
  assert.equal(settings.bootTimeoutSeconds, 180)
  assert.equal(settings.logTailLines, 500)
})

test('the schema still refuses a string for a number field', () => {
  // The field's type stays `number`, so a hand-edited profile carrying `'180'`
  // is refused by the schema instead of being silently coerced into 180. The
  // configuration page writes real numbers; the string branch of the
  // projection is the legacy environment rung, where a value is always a
  // string.
  assert.throws(() => Config({ bootTimeoutSeconds: '180' }), /expected number/)
  assert.throws(() => Config({ logTailLines: '500' }), /expected number/)
})

test('a non-boolean setting keeps the declared default', () => {
  assert.equal(readSettings({ autoStartEmulator: { get: () => 'yes' } }, {}).autoStartEmulator, true)
  assert.equal(readSettings({ autoStartEmulator: { get: () => false } }, {}).autoStartEmulator, false)
  // `showInSettings` is the one boolean whose default is false, so a live false
  // must survive the projection rather than be mistaken for "nothing stored".
  assert.equal(readSettings({ showInSettings: { get: () => 'yes' } }, {}).showInSettings, false)
  assert.equal(readSettings({ showInSettings: { get: () => false } }, {}).showInSettings, false)
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

test('the emulator-arguments example is one argv token per line', () => {
  // `emulatorArgs` is a line-per-token grammar: everything after the first
  // non-space character of a line is ONE argv element, so an example that puts an
  // option and its value on one line tells the user to write a call the emulator
  // rejects as an unknown option. Pin the example against the real parser.
  const field = FIELDS.get('emulatorArgs')
  if (field === undefined) throw new Error('emulatorArgs is not declared')
  // The placeholder is a dictionary entry like every other string, so it is
  // read in both languages: the example is the same argv grammar either way,
  // and a translation that broke the line-per-token shape would be a bug.
  for (const language of ['en', 'zh']) {
    const placeholder = field.placeholder?.[language] ?? ''
    const lines = placeholder.split(/\r?\n/).filter((line) => line.trim().length > 0)
    assert.ok(lines.length > 1, `the ${language} example must show more than one line`)
    assert.deepEqual(splitArgumentLines(placeholder), lines.map((line) => line.trim()))
    for (const token of lines) {
      assert.ok(!/\s/.test(token.trim()), `one argv token per line in ${language}, got ` + JSON.stringify(token))
    }
  }
  assert.match(field.hint?.zh ?? '', /每行一个参数/)
  assert.match(field.hint?.en ?? '', /^One argument per line/)
})
