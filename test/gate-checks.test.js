import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import * as gate from '../scripts/check-bundle.mjs'
import { SETTINGS_NAMESPACE } from '../lib/settings.js'

/** The repository under test, so a copy can be laid out the way the gate reads it. */
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

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
const KINDS = ['text', 'number', 'boolean', 'select', 'multiline', 'discovery']

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

test('a discovery dropdown without a suggest source is reported', () => {
  // Its descriptor carries no `options`, so `suggest` is the only source of
  // options: without it the control renders the saved value alone, which looks
  // like a machine with no AVDs rather than like a broken field.
  const failures = gate.checkSuggestSources([field('defaultAvd', 'discovery')], SOURCES)
  assert.ok(failures.length > 0, 'a discovery field must name a suggest source')
  const message = failures.join('\n')
  assert.match(message, /defaultAvd/, 'the message must name the offending field')
  assert.match(message, /suggest/, 'the message must say what is missing')
})

test('a discovery dropdown that names a provided source is reported by no check', () => {
  assert.deepEqual(gate.checkSuggestSources([field('defaultAvd', 'discovery', { suggest: 'avds' })], SOURCES), [])
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

// ---------------------------------------------------------------------------
// The gate defects G-1..G-4
//
// Each of these was a way the gate stayed green while the page was broken. They
// are regression tests for the gate itself, so they mutate the *source* the gate
// reads rather than a fixture: a check that only passes on a fixture is exactly
// the failure mode being fixed.
// ---------------------------------------------------------------------------

/** The shipped client source, as the gate reads it. */
const CLIENT_SOURCE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('G-1: a registration that repeats the slot as a literal is reported', () => {
  // Renaming only the registration used to move the page somewhere nothing
  // renders while PLUGIN_SURFACE — the only thing the gate compared — stayed
  // correct, so the gate stayed green.
  const mutated = CLIENT_SOURCE.replace('name: PLUGIN_SURFACE.slot,', 'name: "plugins.bundle.config.renamed",')
  assert.notEqual(mutated, CLIENT_SOURCE, 'the mutation must actually change the source')
  const failures = gate.checkRegistrationUsesSurface(mutated)
  assert.ok(failures.length > 0, 'a registration that does not read PLUGIN_SURFACE.slot must be reported')
  assert.match(failures.join('\n'), /PLUGIN_SURFACE\.slot/)
})

test('G-1: the shipped registration passes', () => {
  assert.deepEqual(gate.checkRegistrationUsesSurface(CLIENT_SOURCE), [])
})

test('G-3: a single-quoted settings.section registration is reported', () => {
  const mutated = `${CLIENT_SOURCE}\nconst LEGACY = 'settings.section';\n`
  const failures = gate.checkNoSettingsSection(mutated)
  assert.ok(failures.length > 0, 'a single-quoted settings.section must be reported')
  assert.match(failures.join('\n'), /Settings dialog/)
})

test('G-3: a bare settings.section property access is reported', () => {
  const failures = gate.checkNoSettingsSection(`${CLIENT_SOURCE}\nconst legacy = slots.inject(settings.section);\n`)
  assert.ok(failures.length > 0, 'a bare settings.section access must be reported')
})

test('G-3: the shipped client registers into no Settings section', () => {
  assert.deepEqual(gate.checkNoSettingsSection(CLIENT_SOURCE), [])
})

test('G-2: a kind exported without a renderer is reported', () => {
  // The audit's reproduction: push a kind onto the exported list while
  // RENDERERS has no entry for it. Every host↔client comparison still passes,
  // and the page renders a text box.
  const failures = gate.checkKindsAreRendered([...KINDS, 'slider'], CLIENT_SOURCE)
  assert.ok(failures.length > 0, 'an exported kind with no renderer must be reported')
  assert.match(failures.join('\n'), /slider/)
  assert.match(failures.join('\n'), /RENDERERS/)
})

test('G-2: a renderer whose kind is not exported is reported', () => {
  const failures = gate.checkKindsAreRendered(KINDS.filter((kind) => kind !== 'multiline'), CLIENT_SOURCE)
  assert.ok(failures.length > 0, 'a renderer missing from the exported list must be reported')
  assert.match(failures.join('\n'), /multiline/)
})

test('G-2: the shipped list and renderers agree', () => {
  assert.deepEqual(gate.checkKindsAreRendered(KINDS, CLIENT_SOURCE), [])
})

test('G-4: a lookup that skips optionKey() is reported', () => {
  // The exact drift the audit reproduced: the entry exists under the encoded
  // key, the page looks up the raw value, and the select renders the raw value.
  const mutated = CLIENT_SOURCE.replace(
    'return t(`field.${field.key}.option.${optionKey(value)}`);',
    'return t(`field.${field.key}.option.${value}`);',
  )
  assert.notEqual(mutated, CLIENT_SOURCE, 'the mutation must actually change the source')
  const failures = gate.checkOptionLabelLookup(mutated)
  assert.ok(failures.length > 0, 'a lookup that skips optionKey() must be reported')
  assert.match(failures.join('\n'), /optionKey\(value\)/)
})

test('G-4: the shipped lookup goes through optionKey()', () => {
  assert.deepEqual(gate.checkOptionLabelLookup(CLIENT_SOURCE), [])
})

test('G-4: two options sharing English text but differing in Chinese are accepted', () => {
  // The value-based matching this replaced rejected this legitimate table.
  const shared = field('systemImageVariant', 'select', {
    optionLabel: {
      google: { en: 'Google APIs', zh: 'Google APIs' },
      aosp: { en: 'Google APIs', zh: 'AOSP 原生' },
    },
  })
  const dictionary = { en: {}, zh: {} }
  for (const [value, label] of Object.entries(shared.optionLabel)) {
    dictionary.en[`field.systemImageVariant.option.${gate.optionKey(value)}`] = label.en
    dictionary.zh[`field.systemImageVariant.option.${gate.optionKey(value)}`] = label.zh
  }
  assert.deepEqual(gate.checkOptionLabels([shared], dictionary), [])
})

test('G-4: an option filed under the wrong key is reported', () => {
  const shared = field('systemImageVariant', 'select', {
    optionLabel: { aosp: { en: 'AOSP', zh: 'AOSP 原生' } },
  })
  const failures = gate.checkOptionLabels([shared], {
    en: { 'field.systemImageVariant.option.aosp': 'AOSP' },
    zh: { 'field.systemImageVariant.option.aosp': 'AOSP 原生' },
  })
  assert.ok(failures.length > 0, 'the encoded key is the one the page looks up')
  assert.match(failures.join('\n'), /option\.v\.aosp/)
})

// ---------------------------------------------------------------------------
// The gate's wiring
//
// The checks above are pure functions, so they stay green whether or not
// `main()` still calls them. The OK line the gate prints is a fixed summary
// string, so a gate that lost a `failures.push(...)` call — the exact drift the
// old subprocess test claimed to catch — kept passing every test in this file.
// The two tests below close that: one reads main()'s own body and requires every
// exported check to be called from it, and the other runs the gate against a
// *copy* of the repository with one known drift, which only a wired-up main()
// can report.
// ---------------------------------------------------------------------------

/** The names the gate exports as checks, in the order they were written. */
const GATE_CHECK_NAMES = [
  'checkRegistrationUsesSurface',
  'checkNoSettingsSection',
  'checkFieldKinds',
  'checkKindsAreRendered',
  'checkSuggestSources',
  'checkDictionarySymmetry',
  'checkOptionLabels',
  'checkOptionLabelLookup',
]

test('main() calls every check the gate declares', () => {
  const source = readFileSync(path.join(REPO, 'scripts', 'check-bundle.mjs'), 'utf8')
  const mainStart = source.indexOf('function main()')
  const mainEnd = source.indexOf('// Only when this file is the entry point')
  assert.notEqual(mainStart, -1, 'scripts/check-bundle.mjs must define main()')
  assert.notEqual(mainEnd, -1, 'the entry-point guard must stay after main()')
  const body = source.slice(mainStart, mainEnd)
  for (const name of GATE_CHECK_NAMES) {
    assert.equal(typeof gate[name], 'function', `scripts/check-bundle.mjs must export ${name}`)
    // Read main()'s body, not the whole file: the definition alone would match a
    // deleted call site, which is exactly what this is guarding.
    assert.match(body, new RegExp(`${name}\\(`), `main() must call ${name}() — an unwired check is a check the gate lost`)
  }
})

/**
 * Lay out the files the gate reads in a fresh directory.
 *
 * Only the files `main()` opens are copied — the package manifest, the patch
 * row, `lib/` (the bundle and the holder of the namespace), `locale/`, the
 * bundle loader and the gate itself; `node_modules` is linked rather than
 * copied because the host's peers are what the imported modules resolve
 * against. The layout is the point: `load-bundle.mjs` derives the repository
 * root from its own location, so a copy runs the gate against the copy.
 *
 * @param {string} directory - the directory to build the copy in.
 * @returns {string} the copy's root.
 */
function copyGateTree(directory) {
  const copy = path.join(directory, 'repo')
  mkdirSync(path.join(copy, 'test', 'helpers'), { recursive: true })
  mkdirSync(path.join(copy, 'scripts'), { recursive: true })
  for (const entry of ['package.json', 'cordis.patch.yml', 'locale', 'lib']) {
    cpSync(path.join(REPO, entry), path.join(copy, entry), { recursive: true })
  }
  cpSync(path.join(REPO, 'test', 'helpers', 'load-bundle.mjs'), path.join(copy, 'test', 'helpers', 'load-bundle.mjs'))
  cpSync(path.join(REPO, 'scripts', 'check-bundle.mjs'), path.join(copy, 'scripts', 'check-bundle.mjs'))
  // A Windows junction needs no SeCreateSymbolicLinkPrivilege, which a stock
  // host does not grant; POSIX gets a plain directory symlink.
  symlinkSync(path.join(REPO, 'node_modules'), path.join(copy, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  return copy
}

/**
 * Run one copy's gate and report what it answered.
 *
 * @param {string} copy - the copy's root.
 * @returns {Promise<{code: number, stdout: string, stderr: string}>} the outcome.
 */
async function runGate(copy) {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [path.join(copy, 'scripts', 'check-bundle.mjs')], {
      cwd: copy,
    })
    return { code: 0, stdout: String(stdout), stderr: String(stderr) }
  } catch (error) {
    return { code: typeof error?.code === 'number' ? error.code : 1, stdout: String(error?.stdout ?? ''), stderr: String(error?.stderr ?? '') }
  }
}

test('the gate exits non-zero on a copy of the repository with one known drift', async (t) => {
  // The control run matters as much as the drift: a copy that cannot pass would
  // make the second assertion meaningless, so a broken fixture fails here
  // instead of silently proving nothing.
  const directory = mkdtempSync(path.join(os.tmpdir(), 'aemh-gate-copy-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const copy = copyGateTree(directory)

  const clean = await runGate(copy)
  assert.equal(clean.code, 0, `the untouched copy must pass the gate:\n${clean.stderr}`)
  assert.match(clean.stdout, /check-bundle: OK/)

  // Drift 1: the patch row that carries the settings namespace. `main()` reads
  // this file; none of the pure checks do, so only a wired-up main() reports it.
  // The replacement is a different id rather than an appended suffix: the gate
  // looks for the id as a substring, so `android-emulator-helper-drifted` would
  // still satisfy it.
  const patchFile = path.join(copy, 'cordis.patch.yml')
  const patch = readFileSync(patchFile, 'utf8')
  const drifted = patch.replace(`id: ${SETTINGS_NAMESPACE}`, 'id: drifted-helper-row')
  assert.notEqual(drifted, patch, 'the drift must actually change the patch row')
  writeFileSync(patchFile, drifted)
  const namespaceDrift = await runGate(copy)
  assert.notEqual(namespaceDrift.code, 0, 'a patch row whose id is wrong must fail the gate')
  assert.match(namespaceDrift.stderr, /cordis\.patch\.yml must mount a row whose id is/)

  // Drift 2: a locale entry the plugin list reads. This check sits late in
  // main(), after the field, dictionary and group comparisons, so it proves the
  // gate did not stop at the first group of checks.
  const zhFile = path.join(copy, 'locale', 'zh.json')
  const zh = JSON.parse(readFileSync(zhFile, 'utf8'))
  delete zh.meta.description
  writeFileSync(zhFile, JSON.stringify(zh, null, 2))
  const localeDrift = await runGate(copy)
  assert.notEqual(localeDrift.code, 0, 'a locale file without meta.description must fail the gate')
  assert.match(localeDrift.stderr, /locale\/zh\.json must declare meta\.description/)
})

test('the mounted gate is the same one verify-mount uses to prove the tool surface', async () => {
  // `pnpm run check` runs the mount after the consistency gate; if verify-mount
  // is broken on this host, `pnpm test` says so before `pnpm run check` does.
  // The output is asserted rather than only the exit code: the two set checks are
  // what turn "23 tools" into "every registered tool dispatched, and every
  // dispatched name registered", which is what the old 18-tool check lacked.
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(REPO, 'scripts', 'verify-mount.mjs')], {
    cwd: REPO,
    timeout: 120_000,
  })
  assert.match(stdout, /^ok\s+every tool this gate dispatches is registered/m)
  assert.match(stdout, /^ok\s+this gate dispatches every registered android_\* tool/m)
  assert.doesNotMatch(stdout, /^FAIL\s/m)
  assert.match(stdout, /verify-mount: OK/)
})
