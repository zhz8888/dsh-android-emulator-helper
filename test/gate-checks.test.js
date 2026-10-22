import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as gate from '../scripts/check-bundle.mjs'

/**
 * Consistency-gate unit tests.
 *
 * The gate compares the two written-twice copies of the settings table, and
 * every comparison it makes is a pure function over plain data. These tests
 * pin the four checks that close the degradations no other test could see:
 *
 *   - an unknown field kind renders as a text box and loses the value,
 *   - a mistyped `suggest` name silently removes the datalist,
 *   - a key in one language's dictionary but not the other's renders as a
 *     raw key.
 *
 * The assertions below import the shipped gate rather than a copy of it: a
 * copy would keep passing after the gate itself stopped checking.
 */

/** The kinds the browser half renders a control for. */
const KINDS = ['text', 'number', 'boolean', 'select', 'multiline']

/** The suggestion sources the browser half fills its datalists from. */
const SOURCES = ['avds', 'javaMajors', 'deviceSerials', 'apiLevels', 'buildTools']

/**
 * One field descriptor, in the shape the client exports.
 *
 * @param {string} key - the field key.
 * @param {string} kind - the field kind.
 * @param {object} [extra] - further descriptor properties.
 * @returns {object} the descriptor.
 */
function field(key, kind, extra = {}) {
  return { key, kind, ...extra }
}

// ---------------------------------------------------------------------------
// Field kinds
// ---------------------------------------------------------------------------

test('the gate exports the four checks', () => {
  for (const name of ['checkFieldKinds', 'checkSuggestSources', 'checkDictionarySymmetry', 'checkOptionLabels']) {
    assert.equal(typeof gate[name], 'function', `scripts/check-bundle.mjs must export ${name}`)
  }
})

test('a kind the page renders is reported by no check', () => {
  const failures = gate.checkFieldKinds([field('sdkPath', 'text'), field('minSdk', 'number')], KINDS)
  assert.deepEqual(failures, [])
})

test('a kind the page does not render is reported', () => {
  // `numbr` reaches the page as a text box: the value is stored but the
  // control no longer behaves like the one the schema declared.
  const failures = gate.checkFieldKinds([field('sdkPath', 'numbr')], KINDS)
  assert.ok(failures.length > 0, 'an unknown kind must be reported')
  const message = failures.join('\n')
  assert.match(message, /sdkPath/, 'the message must name the offending field')
  assert.match(message, /numbr/, 'the message must name the offending kind')
})

test('a field list with no fields reports nothing', () => {
  assert.deepEqual(gate.checkFieldKinds([], KINDS), [])
})

// ---------------------------------------------------------------------------
// Suggestion sources
// ---------------------------------------------------------------------------

test('a suggest name the client provides is reported by no check', () => {
  const failures = gate.checkSuggestSources([field('jdkMajor', 'text', { suggest: 'javaMajors' })], SOURCES)
  assert.deepEqual(failures, [])
})

test('a mistyped suggest name is reported', () => {
  // `javaMajor` resolves to nothing, so the datalist disappears and the field
  // silently loses the suggestions the inventory route fetched.
  const failures = gate.checkSuggestSources([field('jdkMajor', 'text', { suggest: 'javaMajor' })], SOURCES)
  assert.ok(failures.length > 0, 'an unknown suggest source must be reported')
  const message = failures.join('\n')
  assert.match(message, /jdkMajor/, 'the message must name the offending field')
  assert.match(message, /javaMajor/, 'the message must name the offending source')
})

test('a field without a suggest is not reported', () => {
  assert.deepEqual(gate.checkSuggestSources([field('sdkPath', 'text')], SOURCES), [])
  assert.deepEqual(gate.checkSuggestSources([field('sdkPath', 'text', { suggest: undefined })], SOURCES), [])
  assert.deepEqual(gate.checkSuggestSources([field('sdkPath', 'text', { suggest: null })], SOURCES), [])
})

// ---------------------------------------------------------------------------
// Dictionary symmetry
// ---------------------------------------------------------------------------

test('a dictionary with the same keys in both languages is reported by no check', () => {
  const failures = gate.checkDictionarySymmetry({
    en: { save: 'Save', reset: 'Reset to default' },
    zh: { save: '保存', reset: '恢复默认' },
  })
  assert.deepEqual(failures, [])
})

test('a key missing from the English dictionary is reported', () => {
  const failures = gate.checkDictionarySymmetry({
    en: { save: 'Save' },
    zh: { save: '保存', writeFailed: 'These values were not accepted.' },
  })
  assert.ok(failures.length > 0, 'a key missing from one language must be reported')
  assert.match(failures.join('\n'), /writeFailed/, 'the message must name the missing key')
})

test('a key missing from the Chinese dictionary is reported', () => {
  const failures = gate.checkDictionarySymmetry({
    en: { save: 'Save', writeFailed: 'These values were not accepted.' },
    zh: { save: '保存' },
  })
  assert.ok(failures.length > 0, 'a key missing from one language must be reported')
  assert.match(failures.join('\n'), /writeFailed/, 'the message must name the missing key')
})

test('a dictionary missing from one side entirely is reported', () => {
  const failures = gate.checkDictionarySymmetry({ en: { save: 'Save' } })
  assert.ok(failures.length > 0, 'a dictionary without both languages must be reported')
})

// ---------------------------------------------------------------------------
// Option labels
// ---------------------------------------------------------------------------

/** A select whose empty option carries a translated label. */
const ABI_FIELD = field('systemImageAbi', 'select', {
  options: ['', 'arm64-v8a'],
  optionLabel: { '': { en: 'Automatic (from the host)', zh: '自动（按宿主架构）' } },
})

test('an option label present in both languages is reported by no check', () => {
  const failures = gate.checkOptionLabels([ABI_FIELD], {
    en: { 'field.systemImageAbi.option.empty': 'Automatic (from the host)' },
    zh: { 'field.systemImageAbi.option.empty': '自动（按宿主架构）' },
  })
  assert.deepEqual(failures, [])
})

test('an option label missing from the page dictionary is reported', () => {
  // The page renders the raw option value when the dictionary has no entry,
  // so the field shows the stored value instead of the label.
  const failures = gate.checkOptionLabels([ABI_FIELD], { en: {}, zh: {} })
  assert.ok(failures.length > 0, 'an option label with no dictionary entry must be reported')
  const message = failures.join('\n')
  assert.match(message, /systemImageAbi/, 'the message must name the offending field')
  assert.match(message, /Automatic \(from the host\)/, 'the message must name the label that is missing')
})

test('an option label translated in one language only is reported', () => {
  const failures = gate.checkOptionLabels([ABI_FIELD], {
    en: { 'field.systemImageAbi.option.empty': 'Automatic (from the host)' },
    zh: {},
  })
  assert.ok(failures.length > 0, 'an option label missing from one language must be reported')
  assert.match(failures.join('\n'), /systemImageAbi/, 'the message must name the offending field')
})

test('an option label filed under different keys in the two languages is reported', () => {
  // The page looks the label up by key, so the two languages have to file it
  // under the same one — otherwise one language renders the raw option value.
  const failures = gate.checkOptionLabels([ABI_FIELD], {
    en: { 'field.systemImageAbi.option.empty': 'Automatic (from the host)' },
    zh: { 'field.systemImageAbi.option.auto': '自动（按宿主架构）' },
  })
  assert.ok(failures.length > 0, 'an option label filed under two keys must be reported')
  assert.match(failures.join('\n'), /systemImageAbi/, 'the message must name the offending field')
})

test('an option label that declares no text in one language is reported', () => {
  const failures = gate.checkOptionLabels(
    [field('systemImageAbi', 'select', { optionLabel: { '': { en: '', zh: '自动（按宿主架构）' } } })],
    { en: {}, zh: {} },
  )
  assert.ok(failures.length > 0, 'an option label without text in one language must be reported')
  assert.match(failures.join('\n'), /systemImageAbi/, 'the message must name the offending field')
})

test('a select without an option label is not reported', () => {
  assert.deepEqual(gate.checkOptionLabels([field('systemImageVariant', 'select', { options: ['default'] })], { en: {}, zh: {} }), [])
})

test('the shipped gate runs its whole comparison as a subprocess', async () => {
  // The four pure checks used by the gate are tested above; this is the only
  // test that executes `main()`, the code path `pnpm run check` actually relies
  // on. A deleted check call in main() would otherwise stay green here.
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(ROOT, 'scripts', 'check-bundle.mjs')], {
    cwd: ROOT,
  })
  assert.match(stdout, /check-bundle: OK/)
})
