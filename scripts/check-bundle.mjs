#!/usr/bin/env node
import process from 'node:process'
import { FIELD_GROUPS, FIELD_KEYS, FIELDS, SETTINGS_NAMESPACE } from '../lib/settings.js'
import { ROOT, loadBundle } from '../test/helpers/load-bundle.mjs'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as hostIndex from '../lib/index.js'

/**
 * Consistency gate for the browser bundle.
 *
 * The client half cannot import the host's settings module — the client bundle
 * purity gate forbids cross-plugin value imports — so the field table and the
 * settings namespace are written twice. This script is the check that keeps the
 * two copies identical, plus the structural checks a host-side test cannot make
 * about a file the browser evaluates on its own.
 *
 * The invariants that read the bundle's exports are pure functions, exported so
 * the test suite can exercise them against fixtures. The gate itself only runs
 * when this file is the process entry point: importing it must not run the
 * whole gate as a side effect.
 *
 * Run with `pnpm run check`.
 */

const failures = []

/** Record one failed invariant. */
function fail(message) {
  failures.push(message)
}

/** Whether the value is a plain object usable as a dictionary. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The slot a bundle registers its own configuration page into.
 *
 * The Plugins page owns this key; a plugin page anywhere else is a page nothing
 * renders.
 */
export const PLUGIN_PAGE_SLOT = 'plugins.bundle.config'

/**
 * Check that every kind in the exported list is one the page actually renders.
 *
 * `FIELD_KINDS` is derived from the client's `RENDERERS` map, which makes the
 * two the same object *inside* the bundle — but the gate reads the exported list
 * across the realm boundary, where "derived from the renderer map" is only a
 * claim. A kind appended to the export (the audit's reproduction: `slider`
 * pushed onto `FIELD_KINDS` and the matching kind added to both field tables)
 * would pass every host↔client comparison and every existing test while the page
 * rendered a text box, because `RENDERERS` had no entry for it.
 *
 * The check therefore reads the map's own keys out of the source and requires
 * the exported list to be exactly that set — no kind may be added to the list
 * without a renderer behind it.
 *
 * @param {string[]} kinds - the kinds the bundle exports.
 * @param {string} source - `lib/client.js`.
 * @returns {string[]} failure messages; empty when the invariant holds.
 */
export function checkKindsAreRendered(kinds, source) {
  const text = String(source ?? '')
  const body = /const\s+RENDERERS\s*=\s*\{([\s\S]{0,4000}?)\n\t\t\};/.exec(text)?.[1]
  if (body === undefined) {
    return ['lib/client.js must declare a RENDERERS map: the field kinds and the renderers must be one object']
  }
  // Top-level keys of the map literal: `text: {...}`, `number: {...}`, ...
  const rendered = [...body.matchAll(/(?:^|\n)\t\t\t([A-Za-z][\w$]*)\s*:/g)].map((match) => match[1])
  if (rendered.length === 0) {
    return ['the RENDERERS map in lib/client.js must declare at least one kind']
  }
  const problems = []
  for (const kind of kinds ?? []) {
    if (!rendered.includes(kind)) {
      problems.push(
        `the bundle exports kind ${JSON.stringify(kind)} but RENDERERS has no renderer for it (it renders: ${rendered.join(', ')})`,
      )
    }
  }
  for (const kind of rendered) {
    if (!(kinds ?? []).includes(kind)) {
      problems.push(`RENDERERS declares kind ${JSON.stringify(kind)} but FIELD_KINDS does not export it`)
    }
  }
  return problems
}

/**
 * Check that the client registers into the slot it exports.
 *
 * `PLUGIN_SURFACE` is only a claim unless the registration actually uses it.
 * The failure this catches was live: renaming the string literal passed to
 * `ctx.slots.register` moved the page to a slot nothing renders while
 * `PLUGIN_SURFACE` — the only thing the gate compared — stayed correct, so the
 * gate stayed green.
 *
 * @param {string} source - `lib/client.js`.
 * @returns {string[]} failure messages; empty when the invariant holds.
 */
export function checkRegistrationUsesSurface(source) {
  const problems = []
  const text = String(source ?? '')
  const entries = [...text.matchAll(/slots\s*\.\s*register\s*\(\s*\{([\s\S]{0,600}?)\}\s*,/g)]
  if (entries.length === 0) {
    problems.push('lib/client.js must register its page through ctx.slots.register({ ... })')
    return problems
  }
  for (const entry of entries) {
    const body = entry[1] ?? ''
    const name = /(?:^|[\s,{])name\s*:\s*([^,\n]+)/.exec(body)?.[1]?.trim()
    const key = /(?:^|[\s,{])key\s*:\s*([^,\n]+)/.exec(body)?.[1]?.trim()
    // The registration has to read the exported object rather than repeat a
    // literal, so the two cannot disagree.
    if (name !== 'PLUGIN_SURFACE.slot') {
      problems.push(
        `the page registration must take its slot from PLUGIN_SURFACE.slot, not ${JSON.stringify(name ?? 'nothing')}`,
      )
    }
    if (key !== 'PLUGIN_SURFACE.key') {
      problems.push(
        `the page registration must take its key from PLUGIN_SURFACE.key, not ${JSON.stringify(key ?? 'nothing')}`,
      )
    }
  }
  return problems
}

/**
 * Check that the bundle never registers into the Settings dialog.
 *
 * `settings.section` still exists in the harness and still renders third-party
 * entries, so registering there is not a type error — it just gives the plugin a
 * second configuration page, which is the thing this migration removed. Both
 * quote styles are matched: the old check only looked for the double-quoted
 * string, so a single-quoted registration slipped through.
 *
 * @param {string} source - `lib/client.js`.
 * @returns {string[]} failure messages; empty when the invariant holds.
 */
export function checkNoSettingsSection(source) {
  const text = String(source ?? '')
  const quoted = /["'`]\s*settings\s*\.\s*section\s*["'`]/.test(text)
  const bracket = /\[\s*["'`]settings["'`]\s*\+\s*["'`]\.section["'`]\s*\]/.test(text)
  const bare = /(?:^|[^\w.$])settings\s*\.\s*section(?!\s*["'`])/.test(text)
  if (quoted || bracket || bare) {
    return ['lib/client.js must not register into the Settings dialog: plugin pages live on the Plugins page']
  }
  return []
}

/**
 * Every field kind must be one the halves actually handle.
 *
 * Both `lib/settings.js` and `lib/client.js` switch on `field.kind` with a
 * `default:` branch that falls through to a plain text input, so a kind only
 * one side knows does not fail — it degrades: the page renders a text box
 * where a number was expected and the value is staged as a string.
 *
 * @param {Array<{key: string, kind: string}>} fields - field descriptors.
 * @param {string[]} kinds - the kind names the client half handles.
 * @returns {string[]} failure messages; empty when the invariant holds.
 */
export function checkFieldKinds(fields, kinds) {
  if (!Array.isArray(kinds) || kinds.length === 0) {
    return ['the client bundle must export FIELD_KINDS']
  }
  const problems = []
  for (const field of fields ?? []) {
    if (!kinds.includes(field.kind)) {
      problems.push(
        `field "${field.key}": kind ${JSON.stringify(field.kind)} is not one of the kinds the client handles (${kinds.join(', ')})`,
      )
    }
  }
  return problems
}

/**
 * Every suggestion source a field names must be one the client provides.
 *
 * `suggest` is a client-only concept: it indexes the suggestions object the
 * client builds from the discovery route, and a typo yields `undefined`, which
 * becomes an empty list. The datalist then simply disappears, with no error
 * anywhere — the field still renders, just without its suggestions.
 *
 * @param {Array<{key: string, suggest?: string}>} fields - field descriptors.
 * @param {string[]} sources - the suggestion-source names the client provides.
 * @returns {string[]} failure messages; empty when the invariant holds.
 */
export function checkSuggestSources(fields, sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return ['the client bundle must export SUGGEST_SOURCES']
  }
  const problems = []
  for (const field of fields ?? []) {
    const source = field.suggest
    if (source === undefined || source === null || source === '') continue
    if (!sources.includes(source)) {
      problems.push(
        `field "${field.key}": suggests ${JSON.stringify(source)}, which the client does not provide (${sources.join(', ')})`,
      )
    }
  }
  return problems
}

/**
 * The two languages must declare the same dictionary keys.
 *
 * The client holds two hand-written literals, `en` and `zh`. The group and
 * field keys are generated symmetrically, but the fixed ones are not: drop one
 * and the page renders that key as a literal string, because the locale
 * binding returns the key itself for a missing entry.
 *
 * @param {{en: Record<string, unknown>, zh: Record<string, unknown>}} dictionary - the dictionary.
 * @returns {string[]} failure messages; empty when the invariant holds.
 */
export function checkDictionarySymmetry(dictionary) {
  const en = dictionary?.en
  const zh = dictionary?.zh
  if (!isRecord(en) || !isRecord(zh)) {
    return ['the client bundle must export FIXED_DICTIONARY']
  }
  const problems = []
  for (const key of Object.keys(en)) {
    if (!(key in zh)) {
      problems.push(`the zh dictionary does not declare ${JSON.stringify(key)}, which the en dictionary declares`)
    }
  }
  for (const key of Object.keys(zh)) {
    if (!(key in en)) {
      problems.push(`the en dictionary does not declare ${JSON.stringify(key)}, which the zh dictionary declares`)
    }
  }
  return problems
}

/**
 * Every declared option label must exist as a dictionary entry in both languages.
 *
 * A field's `optionLabel` map gives a readable name to an option value. The
 * client generates one dictionary entry per declared label and looks the entry
 * up by key, so a label without a generated entry is a silent no-op: the select
 * falls back to the raw option value.
 *
 * @param {Array<{key: string, optionLabel?: Record<string, {en: string, zh: string}>}>} fields - field descriptors.
 * @param {{en: Record<string, string>, zh: Record<string, string>}} dictionary - the dictionary the page renders from.
 * @returns {string[]} failure messages; empty when the invariant holds.
 */
export function checkOptionLabels(fields, dictionary) {
  const en = dictionary?.en
  const zh = dictionary?.zh
  if (!isRecord(en) || !isRecord(zh)) {
    return ['the client bundle must export DICTIONARY']
  }
  const problems = []
  for (const field of fields ?? []) {
    const labels = field.optionLabel
    if (labels === undefined || labels === null) continue
    if (!isRecord(labels)) {
      problems.push(`field "${field.key}": optionLabel must be a map of option values to {en, zh} labels`)
      continue
    }
    // The page does not look a label up by its text: `optionLabel()` builds
    // `field.<key>.option.<optionKey(value)>` and reads that exact key, so the
    // gate has to look up the same key. Matching on the text instead was both
    // too weak and too strict — it missed a drifted lookup key (the entry
    // existed under a different key and the page rendered the raw value) and it
    // reported a false positive when two options shared EN text but differed in
    // ZH.
    for (const [value, label] of Object.entries(labels)) {
      const key = `field.${field.key}.option.${optionKey(value)}`
      for (const lang of ['en', 'zh']) {
        const text = label?.[lang]
        if (typeof text !== 'string' || text.length === 0) {
          problems.push(`field "${field.key}": the option ${JSON.stringify(value)} declares no ${lang} label`)
          continue
        }
        if (dictionary[lang][key] === undefined) {
          problems.push(
            `field "${field.key}": the option ${JSON.stringify(value)} has no ${lang} dictionary entry under ${JSON.stringify(key)} (expected ${JSON.stringify(text)})`,
          )
        } else if (dictionary[lang][key] !== text) {
          problems.push(
            `field "${field.key}": the ${lang} entry ${JSON.stringify(key)} reads ${JSON.stringify(dictionary[lang][key])} but the field declares ${JSON.stringify(text)}`,
          )
        }
      }
    }
  }
  return problems
}

/**
 * The dictionary key suffix one option value is stored under.
 *
 * Mirrors `optionKey()` in `lib/client.js`: the empty option reserves the word
 * `empty`, and every other value is percent-encoded behind a `v.` marker so a
 * literal `"empty"` cannot collide with it. The client builds the key and reads
 * it back through one function, so the gate has to reproduce that rule to check
 * the entry the page will actually look up.
 *
 * @param {string} value - one option's value.
 * @returns {string} the key suffix.
 */
export function optionKey(value) {
  return value === '' ? 'empty' : `v.${encodeURIComponent(value)}`
}

/**
 * Check that the render-time option-label lookup goes through `optionKey()`.
 *
 * The dictionary and the field table are both derived from the same `GROUPS`
 * literal, so every entry the gate can see is generated by the same
 * `optionKey()` the builder uses — which means a drift inside `optionKey()`
 * cannot be observed through the exports at all: change it and both sides move
 * together. What *can* drift is the lookup, because it is a separate call site.
 * Replacing `${optionKey(value)}` with `${value}` in `optionLabel()` leaves every
 * exported value correct and makes the page read a key that does not exist, so
 * the select renders the raw value; this check is what catches that.
 *
 * @param {string} source - `lib/client.js`.
 * @returns {string[]} failure messages; empty when the invariant holds.
 */
export function checkOptionLabelLookup(source) {
  const text = String(source ?? '')
  const body = /function\s+optionLabel\s*\([\s\S]{0,1200}?\n\t\t\}/.exec(text)?.[0]
  if (body === undefined) {
    return ['lib/client.js must define optionLabel(field, value, t) for the select labels']
  }
  const problems = []
  if (!/`field\.\$\{field\.key\}\.option\.\$\{optionKey\(value\)\}`/.test(body)) {
    problems.push(
      'optionLabel() must look its dictionary entry up as `field.${field.key}.option.${optionKey(value)}` — the same key the dictionary builder emits',
    )
  }
  return problems
}

/**
 * Run every invariant and report the ones that failed.
 *
 * Split out of the module body so that importing this file — as the test suite
 * does — does not run the gate.
 */
function main() {
  // The bundle is evaluated the way the shell evaluates it, so a syntax error
  // in it lands here. Report it rather than dying with a stack trace.
  let bundle
  try {
    bundle = loadBundle()
  } catch (error) {
    fail(`lib/client.js must load as a classic script: ${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`)
    report('')
    return
  }
  const { registration, exported, required } = bundle

  // --- bundle identity -----------------------------------------------------
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  if (registration.id !== manifest.name) {
    fail(`bundle id ${JSON.stringify(registration.id)} must equal the package name ${JSON.stringify(manifest.name)}`)
  }
  if (!Array.isArray(exported.inject) || exported.inject.length === 0) {
    fail('the client bundle must export a non-empty inject list')
  }
  for (const name of ['apply', 'inject', 'NS', 'FIELD_META', 'GROUP_META', 'PLUGIN_SURFACE']) {
    if (exported[name] === undefined) fail(`the client bundle must export ${name}`)
  }

  // --- namespace agreement -------------------------------------------------
  if (exported.NS !== SETTINGS_NAMESPACE) {
    fail(`client namespace ${JSON.stringify(exported.NS)} must equal SETTINGS_NAMESPACE ${JSON.stringify(SETTINGS_NAMESPACE)}`)
  }
  const patch = readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8')
  if (!patch.includes(`id: ${SETTINGS_NAMESPACE}`)) {
    fail(`cordis.patch.yml must mount a row whose id is ${SETTINGS_NAMESPACE}`)
  }

  // --- plugin surface agreement ---------------------------------------------
  // The form is not a Settings dialog section any more: it is a bundle's own
  // configuration on the Plugins page, in the `plugins.bundle.config` keyed slot.
  // That slot is keyed by the BUNDLE's package name — the value the plugin
  // manager's inventory compares against — so the key is the package name and
  // never the settings namespace above. The namespace is separately load-bearing:
  // it is the patch row id whose live form the page binds to.
  const clientSource = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  const surface = exported.PLUGIN_SURFACE
  if (surface === undefined) {
    fail('the client bundle must export PLUGIN_SURFACE')
  } else {
    if (surface.slot !== 'plugins.bundle.config') {
      fail(`the form must register into plugins.bundle.config, not ${JSON.stringify(surface.slot)}`)
    }
    // The exported key IS the client's `PACKAGE_NAME`, so the exported value
    // pins the constant without grepping the source for it.
    if (surface.key !== manifest.name) {
      fail(
        `the plugins.bundle.config key ${JSON.stringify(surface.key)} must equal the package name ${JSON.stringify(manifest.name)}`,
      )
    }
  }
  // The exported surface is a claim; the registration is the fact. Both are
  // checked, because a page can be registered somewhere nothing renders while
  // every exported value still reads correctly.
  failures.push(...checkRegistrationUsesSurface(clientSource))
  failures.push(...checkNoSettingsSection(clientSource))

  // --- field table agreement -------------------------------------------------
  const clientFields = exported.FIELD_META ?? []
  if (clientFields.length !== FIELD_KEYS.length) {
    fail(`client declares ${clientFields.length} fields but the host schema declares ${FIELD_KEYS.length}`)
  }
  const hostOrder = [...FIELDS.keys()]
  const clientOrder = clientFields.map((field) => field.key)
  if (hostOrder.join(',') !== clientOrder.join(',')) {
    fail(`field order differs:\n  host:   ${hostOrder.join(', ')}\n  client: ${clientOrder.join(', ')}`)
  }
  for (const field of clientFields) {
    const host = FIELDS.get(field.key)
    if (host === undefined) {
      fail(`client declares unknown field "${field.key}"`)
      continue
    }
    if (host.kind !== field.kind) {
      fail(`field "${field.key}": host kind ${host.kind} != client kind ${field.kind}`)
    }
    if (host.options !== undefined) {
      const hostOptions = host.options.join('|')
      const clientOptions = (field.options ?? []).join('|')
      if (hostOptions !== clientOptions) {
        fail(`field "${field.key}": host options [${hostOptions}] != client options [${clientOptions}]`)
      }
    }
  }

  // --- field kinds the halves actually handle --------------------------------
  // Both halves switch on `field.kind` with a `default:` branch that falls
  // through to a text input, so a kind that only one side knows does not fail
  // — it degrades, and the page stages a number as a string. The client lists
  // the kinds it handles; the host's own switches have the same shape, so the
  // host's kinds are held to the same list.
  const kinds = exported.FIELD_KINDS
  failures.push(...checkFieldKinds(clientFields, kinds))
  if (Array.isArray(kinds) && kinds.length > 0) {
    failures.push(...checkFieldKinds([...FIELDS.values()], kinds).map((message) => `host ${message}`))
  }
  // Comparing host and client only proves the two lists agree. It says nothing
  // about whether the client can actually draw what it lists, which is the half
  // the audit's `slider` reproduction slipped through.
  failures.push(...checkKindsAreRendered(/** @type {string[]} */ (kinds), clientSource))

  // --- suggestion sources ----------------------------------------------------
  // A mistyped `suggest` name yields `undefined`, which becomes an empty list:
  // the datalist disappears with no error anywhere.
  const sources = exported.SUGGEST_SOURCES
  failures.push(...checkSuggestSources(clientFields, sources))

  // --- dictionaries ----------------------------------------------------------
  // The two hand-written literals must declare the same keys, or the page
  // renders the missing one as a literal string.
  failures.push(...checkDictionarySymmetry(exported.FIXED_DICTIONARY))
  // Every label a field declares must exist as an entry in both languages, or
  // the select falls back to the raw option value without saying so.
  failures.push(...checkOptionLabels(clientFields, exported.DICTIONARY))
  failures.push(...checkOptionLabelLookup(clientSource))

  // --- group agreement -------------------------------------------------------
  // The page draws one card per group and reads its heading from `group.<id>`.
  // The two tables are written twice, so they have to agree key by key, in order.
  const clientGroups = exported.GROUP_META ?? []
  const hostGroupIds = FIELD_GROUPS.map((group) => group.id)
  const clientGroupIds = clientGroups.map((group) => group.id)
  if (hostGroupIds.join(',') !== clientGroupIds.join(',')) {
    fail(`group order differs:\n  host:   ${hostGroupIds.join(', ')}\n  client: ${clientGroupIds.join(', ')}`)
  }
  const clientFieldsByKey = new Map((exported.FIELD_META ?? []).map((field) => [field.key, field]))
  for (const group of clientGroups) {
    const hostGroup = FIELD_GROUPS.find((item) => item.id === group.id)
    if (hostGroup === undefined) {
      fail(`client declares unknown group "${group.id}"`)
      continue
    }
    const hostFields = hostGroup.fields.map((field) => field.key).join(',')
    if (hostFields !== group.fields.join(',')) {
      fail(`group "${group.id}" holds different fields:\n  host:   ${hostFields}\n  client: ${group.fields.join(',')}`)
    }
  }

  // --- user-visible text agreement -------------------------------------------
  // Every heading, hint and label the page can render is written twice. Comparing
  // only the keys would let a reworded or mistranslated label ship: the form
  // would still render, just with text that no longer matches the host. Compare
  // the text itself, in both languages.
  /** Compare two `{en, zh}` text objects, reporting every difference. */
  function compareText(what, hostText, clientText) {
    for (const lang of ['en', 'zh']) {
      const host = hostText?.[lang]
      const client = clientText?.[lang]
      if (typeof host !== 'string' || host.length === 0) fail(`${what}: the host declares no ${lang} text`)
      else if (host !== client) {
        fail(`${what}: ${lang} text differs\n  host:   ${host}\n  client: ${client === undefined ? '(missing)' : client}`)
      }
    }
  }
  for (const group of FIELD_GROUPS) {
    const client = clientGroups.find((item) => item.id === group.id)
    if (client === undefined) continue
    compareText(`group "${group.id}" title`, group.title, client.title)
    compareText(`group "${group.id}" hint`, group.hint, client.hint)
    for (const field of group.fields) {
      const clientField = clientFieldsByKey.get(field.key)
      if (clientField === undefined) continue
      compareText(`field "${field.key}" label`, field.label, clientField.label)
      compareText(`field "${field.key}" hint`, field.hint, clientField.hint)
      if ((field.placeholder ?? '') !== (clientField.placeholder ?? '')) {
        fail(`field "${field.key}": placeholder differs\n  host:   ${field.placeholder ?? '(none)'}\n  client: ${clientField.placeholder ?? '(none)'}`)
      }
    }
  }
  // `locale/*.json` carries the package metadata the plugin list reads, so both
  // languages must describe the same package with the same keys.
  const localeFiles = {}
  for (const name of ['en', 'zh']) {
    localeFiles[name] = JSON.parse(readFileSync(path.join(ROOT, 'locale', `${name}.json`), 'utf8'))
  }
  for (const key of new Set([...Object.keys(localeFiles.en), ...Object.keys(localeFiles.zh)])) {
    if (!(key in localeFiles.en)) fail(`locale/zh.json declares "${key}" but locale/en.json does not`)
    if (!(key in localeFiles.zh)) fail(`locale/en.json declares "${key}" but locale/zh.json does not`)
  }
  for (const name of ['en', 'zh']) {
    if (typeof localeFiles[name].meta?.title !== 'string' || localeFiles[name].meta.title.length === 0) {
      fail(`locale/${name}.json must declare meta.title`)
    }
    if (typeof localeFiles[name].meta?.description !== 'string' || localeFiles[name].meta.description.length === 0) {
      fail(`locale/${name}.json must declare meta.description`)
    }
  }
  // The plugin's display name has exactly one source: `locale/*.json`, which the
  // plugin list and the plugin detail page both read. The bundle used to draw its
  // own heading and register a Settings nav label, which is why this gate used to
  // compare a second copy; that copy is gone with the Settings section.

  // --- route agreement -------------------------------------------------------
  // The host owns the prefix and the two routes; the client calls them by
  // absolute path. Both sides export the paths now — the host's `ROUTES` and
  // the browser half's `ROUTES` — so the gate compares two values instead of
  // grepping two source files for the same literal.
  const hostRoutes = hostIndex.ROUTES
  const clientRoutes = exported.ROUTES
  if (hostRoutes === undefined) {
    fail('lib/index.js must export ROUTES')
  }
  if (clientRoutes === undefined) {
    fail('the client bundle must export ROUTES')
  }
  if (hostRoutes !== undefined && clientRoutes !== undefined) {
    for (const name of ['status', 'inventory']) {
      const route = hostRoutes[name]
      if (route === undefined) {
        fail(`lib/index.js must export the ${name} route in ROUTES`)
        continue
      }
      if (clientRoutes[name] !== route) {
        fail(`the client route ${name} ${JSON.stringify(clientRoutes[name])} must equal ${JSON.stringify(route)}`)
      }
    }
  }

  // --- client bundle hygiene -------------------------------------------------
  if (/^\s*(import|export)\s/m.test(clientSource)) {
    fail('the client bundle must be a classic script: no import/export statements')
  }
  for (const specifier of new Set(required)) {
    if (!['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'].includes(specifier)) {
      console.warn(`note: the bundle requires ${specifier}; confirm it is a shell static module or declared in dsh.client.external`)
    }
  }

  report(
    `check-bundle: OK — bundle id, namespace, plugin surface, ${clientFields.length} fields, ${kinds?.length ?? 0} field kinds, ${sources?.length ?? 0} suggestion sources, both dictionaries, 2 routes and script hygiene all agree.`,
  )
}

/**
 * Print the failures and exit non-zero, or print the summary and exit zero.
 *
 * @param {string} summary - the line printed when nothing failed.
 */
function report(summary) {
  if (failures.length > 0) {
    console.error(`check-bundle: ${failures.length} problem(s)\n`)
    for (const message of failures) console.error(`  - ${message}`)
    process.exit(1)
  }
  console.log(summary)
}

// Only when this file is the entry point: the test suite imports the checks
// above, and running the whole gate as an import side effect would exit the
// test process on the first failure.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
