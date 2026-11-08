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
 * The dictionaries the host half publishes to the page.
 *
 * Read from the same two files the host half reads, so a mount in this gate
 * installs the shipped copy as the page-initialization global.
 *
 * @returns {{en: Record<string, string>, zh: Record<string, string>}} the dictionaries.
 */
function localePayload() {
  const read = (language) =>
    JSON.parse(readFileSync(path.join(ROOT, 'locale', `${language}.json`), 'utf8')).settings
  return { en: read('en'), zh: read('zh') }
}

/**
 * Read one `field: value` property of a slot registration entry.
 *
 * @param {string} body - the text between the entry's braces.
 * @param {string} field - the property to read.
 * @returns {string | undefined} the trimmed value expression, when present.
 */
function entryField(body, field) {
  return new RegExp(`(?:^|[\\s,{])${field}\\s*:\\s*([^,\\n]+)`).exec(String(body ?? ''))?.[1]?.trim()
}

/**
 * Remove line and block comments before the gate reads code.
 *
 * These checks compare source text, and a comment that explains the Settings
 * slots must not read as a second declaration of them. A `:` before `//` is
 * left alone, so a URL-shaped string cannot swallow the rest of its line.
 *
 * @param {string} source - any source text.
 * @returns {string} the text without comments.
 */
function stripComments(source) {
  return String(source ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * The slot a bundle registers its own configuration page into.
 *
 * The Plugins page owns this key; a plugin page anywhere else is a page nothing
 * renders. A row's page is the one that opens from the row's **Configure**
 * control, so the form lives one click below the bundle's detail page rather
 * than inline on it.
 */
export const PLUGIN_PAGE_SLOT = 'plugins.row.config'

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
 * The bundle now owns three registrations: the row's configuration page, the
 * optional Settings section and that section's navigation icon. The two Settings
 * entries must share one id, so both take it from `SETTINGS_SURFACE.id`; a
 * literal id on either side would let the icon detach from its section, and the
 * shell simply renders its default glyph for an unmatched icon, which looks like
 * a styling choice rather than a bug.
 *
 * @param {string} source - `lib/client.js`.
 * @returns {string[]} failure messages; empty when the invariant holds.
 */
export function checkRegistrationUsesSurface(source) {
  const problems = []
  const text = stripComments(source)
  const entries = [...text.matchAll(/slots\s*\.\s*register\s*\(\s*\{([\s\S]{0,900}?)\}\s*,/g)]
  if (entries.length !== 3) {
    problems.push(
      `lib/client.js must register exactly three slot entries (the row's configuration page, the Settings section and its icon); found ${entries.length}`,
    )
    return problems
  }
  for (const entry of entries) {
    const body = entry[1] ?? ''
    const name = entryField(body, 'name')
    const key = entryField(body, 'key')
    const id = entryField(body, 'id')
    if (name === 'PLUGIN_SURFACE.slot') {
      if (key !== 'PLUGIN_SURFACE.key') {
        problems.push(
          `the page registration must take its key from PLUGIN_SURFACE.key, not ${JSON.stringify(key ?? 'nothing')}`,
        )
      }
      if (id !== undefined) problems.push('the row page registration is keyed by <package>#<row id> and carries no id')
      continue
    }
    if (name === 'SETTINGS_SURFACE.section') {
      if (key !== undefined) problems.push('the Settings section is keyed by id, not by the row page key')
      if (id !== 'SETTINGS_SURFACE.id') {
        problems.push(
          `the Settings section registration must take its id from SETTINGS_SURFACE.id, not ${JSON.stringify(id ?? 'nothing')}`,
        )
      }
      if (!/\border\s*:\s*SETTINGS_SURFACE\.order\b/.test(body)) {
        problems.push('the Settings section registration must take its order from SETTINGS_SURFACE.order')
      }
      if (!/\blabel\s*:\s*(?:\(\s*\)|[\w$]+)\s*=>/.test(body)) {
        problems.push('the Settings section registration must declare a locale-following label thunk')
      }
      if (!/\blocale\s*:\s*NS_T\b/.test(body)) {
        problems.push('the Settings section registration must name the dictionary namespace it renders with (locale: NS_T)')
      }
      continue
    }
    if (name === 'SETTINGS_SURFACE.icon') {
      if (key !== undefined) problems.push('the Settings icon is keyed by id, not by the row page key')
      if (id !== 'SETTINGS_SURFACE.id') {
        problems.push(
          `the Settings icon registration must take its id from SETTINGS_SURFACE.id, not ${JSON.stringify(id ?? 'nothing')}`,
        )
      }
      continue
    }
    problems.push(
      `slot registrations must take their slot from PLUGIN_SURFACE or SETTINGS_SURFACE, not ${JSON.stringify(name ?? 'nothing')}`,
    )
  }
  return problems
}

/**
 * Check that the Settings slot names have exactly one source.
 *
 * `settings.section` and `settings.section.icon` may appear only inside the
 * exported `SETTINGS_SURFACE`. Anywhere else — a registration, an inject call,
 * a helper — a repeated literal is a second source that can drift, which is the
 * failure the old "never register into the Settings dialog" rule was written
 * for. The rule changed with the opt-in switch; the one-source property did
 * not. Comments are stripped first, so this covers code, not prose.
 *
 * @param {string} source - `lib/client.js`.
 * @returns {string[]} failure messages; empty when the invariant holds.
 */
export function checkSettingsSlotLiterals(source) {
  const text = String(source ?? '')
  const surface = /const\s+SETTINGS_SURFACE\s*=\s*Object\.freeze\(\{[\s\S]{0,400}?\}\)/.exec(text)?.[0]
  if (surface === undefined) {
    return ['lib/client.js must declare SETTINGS_SURFACE: the Settings slot names must have one source']
  }
  const rest = stripComments(text.replace(surface, ''))
  const quoted = /["'`]\s*settings\s*\.\s*section(?:\s*\.\s*icon)?\s*["'`]/.test(rest)
  const bare = /(?:^|[^\w.$])settings\s*\.\s*section(?!\s*["'`])/.test(rest)
  if (quoted || bare) {
    return [
      'the settings.section and settings.section.icon names may only appear inside SETTINGS_SURFACE; a stray literal is a second source that can drift',
    ]
  }
  return []
}

/**
 * Mount the browser half over a minimal host and record what it registers.
 *
 * The gate has to observe the registration, not merely read it: the whole point
 * of the opt-in switch is that the Settings entry does not exist while the
 * setting is off. The shared primitives are stubbed, so the form's controller
 * degrades to the empty face — the registrations are what this observes, and a
 * gating rule that only worked through the controller would fail here.
 *
 * The page's copy is already in the bundle's dictionaries: `loadBundle`
 * installs the page-initialization global around the factory, which is what
 * the web server does when it renders `index.html`. Nothing has to be stubbed
 * here, and nothing has to be restored.
 *
 * @param {Record<string, any>} exported - the bundle's exports.
 * @param {boolean} enabled - the value the host resolves for the switch.
 * @returns {{apply: () => void, injected: string[], live: () => Array<{entry: Record<string, any>, component: unknown, disposed: boolean}>, publish: (next: boolean) => void}} the mount.
 */
function mountClientHalf(exported, enabled) {
  const surface = exported?.SETTINGS_SURFACE ?? {}
  const field = typeof surface.field === 'string' && surface.field.length > 0 ? surface.field : 'showInSettings'
  const section = { [field]: enabled }
  const listeners = new Set()
  const scope = {
    getSnapshot: () => ({ status: 'ready', value: { ...section }, base: {}, user: {}, writable: true, revision: 1 }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    mutate: async () => true,
  }
  /** @type {Array<{entry: Record<string, any>, component: unknown, disposed: boolean}>} */
  const registrations = []
  /** @type {string[]} */
  const injected = []
  const host = {
    configForms: {
      get: () => scope,
      whileServed: (namespaces, register) => {
        const disposer = register(new Set(namespaces))
        return typeof disposer === 'function' ? disposer : () => {}
      },
    },
    locale: {
      register: () => () => {},
      // The label thunk must return a dictionary KEY, not the text it resolves
      // to, so this binding answers the key itself and never reads the bundle's
      // dictionary. Reading it would make the check order-dependent: the locale
      // fetch below fills that dictionary in place, so a second mount in the
      // same process would see text where the first saw a key.
      bind: () => (key) => key,
    },
    slots: {
      inject: (name, callback) => {
        injected.push(name)
        return callback()
      },
      register: (entry, component) => {
        const record = { entry, component, disposed: false }
        registrations.push(record)
        return () => {
          record.disposed = true
        }
      },
    },
    effect: (callback) => {
      const disposer = callback()
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
    logger: { warn: () => {}, error: () => {} },
  }
  return {
    apply: () => exported.apply(host),
    injected,
    live: () => registrations.filter((record) => !record.disposed),
    publish: (next) => {
      section[field] = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/**
 * Check that the Settings entry follows the `showInSettings` switch.
 *
 * A structural check cannot prove the opt-in gates anything: a registration
 * moved out of the visibility guard still reads the exported surface and still
 * names the right slot. This mounts the real `apply` against a host that serves
 * the form with the switch off, then on, then off again, and requires the three
 * observations the feature promises — no Settings entry while the switch is
 * off, both entries (section and icon, one shared id) while it is on, and both
 * disposed again when it is saved off, without a reload.
 *
 * @param {Record<string, any>} exported - the bundle's exports.
 * @param {{en: Record<string, string>, zh: Record<string, string>}} [localeSettings] - the dictionaries the locale files declare.
 * @returns {string[]} failure messages; empty when the invariant holds.
 */
export function checkSettingsSectionGated(exported, localeSettings = { en: {}, zh: {} }) {
  const problems = []
  const surface = exported?.SETTINGS_SURFACE
  if (!isRecord(surface)) {
    return ['the client bundle must export SETTINGS_SURFACE']
  }
  if (surface.section !== 'settings.section') {
    problems.push(`SETTINGS_SURFACE.section must be "settings.section", not ${JSON.stringify(surface.section)}`)
  }
  if (surface.icon !== 'settings.section.icon') {
    problems.push(`SETTINGS_SURFACE.icon must be "settings.section.icon", not ${JSON.stringify(surface.icon)}`)
  }
  if (surface.id !== exported.NS) {
    problems.push(
      `SETTINGS_SURFACE.id ${JSON.stringify(surface.id)} must be the settings namespace ${JSON.stringify(exported.NS)}`,
    )
  }
  const hostField = FIELDS.get(surface.field)
  if (hostField === undefined) {
    problems.push(`SETTINGS_SURFACE.field ${JSON.stringify(surface.field)} must name a declared settings field`)
  } else if (hostField.kind !== 'boolean') {
    problems.push(
      `SETTINGS_SURFACE.field ${JSON.stringify(surface.field)} must be a boolean field; it is ${JSON.stringify(hostField.kind)}`,
    )
  }
  if (typeof exported.apply !== 'function') {
    return [...problems, 'the client bundle must export apply()']
  }
  if (problems.length > 0) return problems

  const off = mountClientHalf(exported, false)
  try {
    off.apply()
  } catch (error) {
    return [...problems, `apply() must survive a host that serves the form: ${String(error?.message ?? error)}`]
  }
  const offNames = off.live().map((record) => record.entry.name)
  if (offNames.length !== 1 || offNames[0] !== PLUGIN_PAGE_SLOT) {
    problems.push(
      `with the switch off the bundle must register only ${JSON.stringify(PLUGIN_PAGE_SLOT)}; it registered [${offNames.join(', ')}]`,
    )
  }
  if (off.injected.some((name) => name === surface.section || name === surface.icon)) {
    problems.push('with the switch off the bundle must not wait on a Settings slot')
  }

  const on = mountClientHalf(exported, true)
  try {
    on.apply()
  } catch (error) {
    return [...problems, `apply() must survive a host that serves the form: ${String(error?.message ?? error)}`]
  }
  const byName = new Map(on.live().map((record) => [record.entry.name, record]))
  const section = byName.get(surface.section)
  const icon = byName.get(surface.icon)
  if (section === undefined) problems.push(`with the switch on the bundle must register ${JSON.stringify(surface.section)}`)
  if (icon === undefined) problems.push(`with the switch on the bundle must register ${JSON.stringify(surface.icon)}`)
  if (section !== undefined && icon !== undefined) {
    if (section.entry.id !== surface.id) {
      problems.push(
        `the Settings section id must be ${JSON.stringify(surface.id)}, not ${JSON.stringify(section.entry.id)}`,
      )
    }
    if (icon.entry.id !== section.entry.id) {
      problems.push(
        `the Settings icon id ${JSON.stringify(icon.entry.id)} must equal its section id ${JSON.stringify(section.entry.id)}`,
      )
    }
    if (section.entry.order !== surface.order) {
      problems.push(`the Settings section order must be SETTINGS_SURFACE.order (${JSON.stringify(surface.order)})`)
    }
    if (typeof icon.component !== 'function') {
      problems.push('the Settings icon registration must pass its component')
    }
    if (section.entry.key !== undefined) {
      problems.push('the Settings section is keyed by id; it must not carry the row page key')
    }
    if (typeof section.entry.label !== 'function') {
      problems.push('the Settings section label must be a thunk so it follows the active locale')
    } else {
      const label = section.entry.label()
      // The label is a dictionary key resolved through the shell's `t`. The
      // dictionaries are fetched at run time, so at gate time the bundle's own
      // dictionary is still empty and `t` answers the key itself — which makes
      // the thunk's return value the key to check. Requiring that key in both
      // locale files is what proves the label renders as text on a real page
      // rather than as a raw key in the navigation rail.
      if (typeof label !== 'string' || label.length === 0) {
        problems.push('the Settings section label must resolve to a non-empty string')
      } else {
        for (const lang of ['en', 'zh']) {
          const declared = localeSettings[lang]?.[label]
          if (typeof declared !== 'string' || declared.length === 0) {
            problems.push(
              `the Settings section label ${JSON.stringify(label)} is not a key locale/${lang}.json declares`,
            )
          }
        }
      }
    }
    if (section.entry.locale === undefined) {
      problems.push('the Settings section must declare the dictionary namespace it renders with')
    }
  }
  on.publish(false)
  const after = on.live().map((record) => record.entry.name)
  if (after.includes(surface.section) || after.includes(surface.icon)) {
    problems.push('saving the switch off must dispose both Settings entries without a reload')
  }
  return problems
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
 * A `discovery` field has no other source of options: its descriptor carries no
 * `options`, and the dropdown renders only what the discovery list holds plus
 * the saved value. A discovery field without `suggest` therefore renders a
 * control with one option in it, which looks like an empty machine rather than
 * like a broken field — which is why that combination is refused here instead
 * of being left to be noticed on screen.
 *
 * @param {Array<{key: string, kind?: string, suggest?: string}>} fields - field descriptors.
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
    const missing = source === undefined || source === null || source === ''
    if (field.kind === 'discovery' && missing) {
      problems.push(`field "${field.key}": a discovery dropdown must name the suggest source its options come from`)
      continue
    }
    if (missing) continue
    if (!sources.includes(source)) {
      problems.push(
        `field "${field.key}": suggests ${JSON.stringify(source)}, which the client does not provide (${sources.join(', ')})`,
      )
    }
  }
  return problems
}

/**
 * The two locale files must declare the same keys.
 *
 * `locale/en.json` and `locale/zh.json` are the single source of every string
 * this plugin renders: the host half projects them into the field table, and
 * the browser half reads them from the injected global. A key present in one
 * file and missing from the other renders as the key itself in that language,
 * because the locale binding answers the key for a missing entry.
 *
 * @param {{en: Record<string, unknown>, zh: Record<string, unknown>}} dictionary - the two dictionaries.
 * @returns {string[]} failure messages; empty when the invariant holds.
 */
export function checkDictionarySymmetry(dictionary) {
  const en = dictionary?.en
  const zh = dictionary?.zh
  if (!isRecord(en) || !isRecord(zh)) {
    return ['the locale files must both declare a "settings" object']
  }
  const problems = []
  for (const key of Object.keys(en)) {
    if (!(key in zh)) {
      problems.push(`locale/zh.json does not declare ${JSON.stringify(key)}, which locale/en.json declares`)
    }
  }
  for (const key of Object.keys(zh)) {
    if (!(key in en)) {
      problems.push(`locale/en.json does not declare ${JSON.stringify(key)}, which locale/zh.json declares`)
    }
  }
  return problems
}

/**
 * Every string the page can render must exist in both locale files.
 *
 * The field table names its copy by key rather than carrying it, so a key the
 * locale files do not declare is not a compile error anywhere — it is a raw key
 * on the page. This walks the same keys the page looks up: the fixed page
 * chrome, every group heading and hint, every field label and hint, every
 * placeholder, and every declared option label.
 *
 * @param {Array<{id: string, fields: Array<{key: string, placeholder?: boolean, optionLabel?: string[]}>}>} groups - the client's group table.
 * @param {string[]} fixedKeys - the page-chrome keys the bundle declares.
 * @param {{en: Record<string, string>, zh: Record<string, string>}} dictionary - the two dictionaries.
 * @returns {string[]} failure messages; empty when the invariant holds.
 */
export function checkDictionaryCoverage(groups, fixedKeys, dictionary) {
  const en = dictionary?.en
  const zh = dictionary?.zh
  if (!isRecord(en) || !isRecord(zh)) {
    return ['the locale files must both declare a "settings" object']
  }
  const problems = []
  /** Require one key in both languages, with a non-empty string in each. */
  const require = (key, what) => {
    for (const lang of ['en', 'zh']) {
      const value = dictionary[lang][key]
      if (typeof value !== 'string' || value.length === 0) {
        problems.push(`${what}: locale/${lang}.json declares no ${JSON.stringify(key)}`)
      }
    }
  }
  for (const key of fixedKeys ?? []) require(key, 'the page chrome')
  for (const group of groups ?? []) {
    require(`group.${group.id}`, `group "${group.id}"`)
    require(`group.${group.id}.hint`, `group "${group.id}"`)
    for (const field of group.fields ?? []) {
      require(`field.${field.key}`, `field "${field.key}"`)
      require(`field.${field.key}.hint`, `field "${field.key}"`)
      if (field.placeholder === true) require(`field.${field.key}.placeholder`, `field "${field.key}"`)
      for (const value of field.optionLabel ?? []) {
        require(`field.${field.key}.option.${optionKey(value)}`, `field "${field.key}" option ${JSON.stringify(value)}`)
      }
    }
  }
  return problems
}

/**
 * Every declared option label must exist as a dictionary entry in both languages.
 *
 * A field's `optionLabel` list names the option values that carry a readable
 * name. The page looks the entry up by key, so a label without an entry is a
 * silent no-op: the select falls back to the raw option value.
 *
 * @param {Array<{key: string, optionLabel?: string[]}>} fields - field descriptors.
 * @param {{en: Record<string, string>, zh: Record<string, string>}} dictionary - the dictionaries the page renders from.
 * @returns {string[]} failure messages; empty when the invariant holds.
 */
export function checkOptionLabels(fields, dictionary) {
  const en = dictionary?.en
  const zh = dictionary?.zh
  if (!isRecord(en) || !isRecord(zh)) {
    return ['the locale files must both declare a "settings" object']
  }
  const problems = []
  for (const field of fields ?? []) {
    const labels = field.optionLabel
    if (labels === undefined || labels === null) continue
    if (!Array.isArray(labels)) {
      problems.push(`field "${field.key}": optionLabel must be a list of the option values that carry a label`)
      continue
    }
    // The page does not look a label up by its text: `optionLabel()` builds
    // `field.<key>.option.<optionKey(value)>` and reads that exact key, so the
    // gate has to look up the same key. Matching on the text instead was both
    // too weak and too strict — it missed a drifted lookup key (the entry
    // existed under a different key and the page rendered the raw value) and it
    // reported a false positive when two options shared EN text but differed in
    // ZH.
    for (const value of labels) {
      const key = `field.${field.key}.option.${optionKey(value)}`
      for (const lang of ['en', 'zh']) {
        const text = dictionary[lang][key]
        if (typeof text !== 'string' || text.length === 0) {
          problems.push(
            `field "${field.key}": the option ${JSON.stringify(value)} has no ${lang} dictionary entry under ${JSON.stringify(key)}`,
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
 * The bundle must carry no copy of its own.
 *
 * This is the invariant the whole arrangement exists for. Every string the page
 * renders lives in `locale/en.json` and `locale/zh.json`; the bundle looks each
 * one up by key. A string written into `lib/client.js` is a second source, and
 * the two drift the moment one is edited — which is exactly what this
 * repository used to do, with the same table spelled twice and a gate comparing
 * the copies word for word.
 *
 * Two shapes are refused, because both are how copy creeps back in:
 *
 *   - a `{zh: …, en: …}` literal, which is the old inline dictionary shape;
 *   - a non-ASCII character in a string literal, which is what a Chinese label
 *     pasted into the bundle looks like. Comments are exempt: this file's own
 *     prose quotes the Chinese button names, and a comment renders nothing.
 *
 * @param {string} source - `lib/client.js`.
 * @returns {string[]} failure messages; empty when the invariant holds.
 */
export function checkNoInlineCopy(source) {
  const text = String(source ?? '')
  const problems = []
  // Strip comments before looking for copy: a comment is not rendered, and the
  // bundle's own prose names the Chinese labels it used to carry.
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  if (/\bzh\s*:\s*["'`]/.test(code)) {
    problems.push(
      'lib/client.js must not carry inline copy: a `{zh: …, en: …}` literal belongs in locale/en.json and locale/zh.json',
    )
  }
  // A CJK character inside a string literal is copy that escaped the locale
  // files. The bundle's identifiers and keys are ASCII, so any hit is a string.
  const cjk = /["'`][^"'`\n]*[\u4e00-\u9fff][^"'`\n]*["'`]/.exec(code)
  if (cjk !== null) {
    problems.push(
      `lib/client.js must not carry inline copy: found ${JSON.stringify(cjk[0].slice(0, 60))} — it belongs in locale/en.json and locale/zh.json`,
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

  const localeFiles = {}
  for (const name of ['en', 'zh']) {
    localeFiles[name] = JSON.parse(readFileSync(path.join(ROOT, 'locale', `${name}.json`), 'utf8'))
  }
  const localeSettings = { en: localeFiles.en.settings, zh: localeFiles.zh.settings }

  // --- bundle identity -----------------------------------------------------
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  if (registration.id !== manifest.name) {
    fail(`bundle id ${JSON.stringify(registration.id)} must equal the package name ${JSON.stringify(manifest.name)}`)
  }
  if (!Array.isArray(exported.inject) || exported.inject.length === 0) {
    fail('the client bundle must export a non-empty inject list')
  }
  for (const name of ['apply', 'inject', 'NS', 'FIELD_META', 'GROUP_META', 'PLUGIN_SURFACE', 'SETTINGS_SURFACE']) {
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
  // The form's home is the row's own page: it registers into the
  // `plugins.row.config` keyed slot, keyed by `<package name>#<row id>`. The
  // package name is the value the plugin manager's inventory compares against,
  // and the row id must be the patch row this plugin mounts — the same string as
  // the settings namespace — or the row gets no Configure control and the page
  // has nowhere to render. The bundle detail page's own inline slot,
  // `plugins.bundle.config`, is deliberately not used: the whole point of the
  // placement is that the parameters are a page of their own, one click below it.
  // The opt-in Settings entry is the exception, and it is checked below: it must
  // stay behind the `showInSettings` switch and take both its slots from the
  // exported `SETTINGS_SURFACE`.
  const clientSource = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  const surface = exported.PLUGIN_SURFACE
  if (surface === undefined) {
    fail('the client bundle must export PLUGIN_SURFACE')
  } else {
    if (surface.slot !== PLUGIN_PAGE_SLOT) {
      fail(`the form must register into ${PLUGIN_PAGE_SLOT}, not ${JSON.stringify(surface.slot)}`)
    }
    // The exported key IS the client's `PACKAGE_NAME` and `NS`, so the exported
    // value pins both constants without grepping the source for them.
    const rowKey = `${manifest.name}#${SETTINGS_NAMESPACE}`
    if (surface.key !== rowKey) {
      fail(
        `the ${PLUGIN_PAGE_SLOT} key ${JSON.stringify(surface.key)} must be <package name>#<row id> = ${JSON.stringify(rowKey)}`,
      )
    }
  }
  // The exported surface is a claim; the registration is the fact. Both are
  // checked, because a page can be registered somewhere nothing renders while
  // every exported value still reads correctly. The Settings entry is checked
  // behaviourally as well: it must not exist while its switch is off.
  failures.push(...checkRegistrationUsesSurface(clientSource))
  failures.push(...checkSettingsSlotLiterals(clientSource))
  failures.push(...checkSettingsSectionGated(exported, localeSettings))

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
    // The host says what the placeholder reads; the client says whether the
    // control shows one. A field that lost `placeholder: true` on one side
    // renders no hint at all, and the locale coverage check cannot see it: it
    // only requires the key when the client still claims the placeholder.
    const hostHasPlaceholder = host.placeholder !== undefined
    const clientHasPlaceholder = field.placeholder === true
    if (hostHasPlaceholder !== clientHasPlaceholder) {
      fail(
        `field "${field.key}": host ${hostHasPlaceholder ? 'declares a placeholder' : 'declares no placeholder'} but the client ${clientHasPlaceholder ? 'shows one' : 'shows none'}`,
      )
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
  // `locale/en.json` and `locale/zh.json` are the single source of every string
  // this plugin renders. The host half projects them into the field table and
  // the browser half reads them from the injected global, so the two halves
  // cannot disagree — but a key missing from one file still renders as itself,
  // and a key the page looks up but neither file declares is a raw key on the
  // page. Both are checked here.
  const clientGroups = exported.GROUP_META ?? []
  const clientFieldsByKey = new Map((exported.FIELD_META ?? []).map((field) => [field.key, field]))
  failures.push(...checkDictionarySymmetry(localeSettings))
  // Every key the page can look up must exist in both files: the fixed chrome,
  // every group heading and hint, every field label and hint, every placeholder
  // and every declared option label. The walk uses the client's own field
  // descriptors, because those are what the page renders from.
  failures.push(
    ...checkDictionaryCoverage(
      clientGroups.map((group) => ({
        id: group.id,
        fields: group.fields.map((key) => clientFieldsByKey.get(key) ?? { key }),
      })),
      exported.FIXED_KEYS ?? [],
      localeSettings,
    ),
  )
  // Every label a field declares must exist as an entry in both languages, or
  // the select falls back to the raw option value without saying so.
  failures.push(...checkOptionLabels(clientFields, localeSettings))
  failures.push(...checkOptionLabelLookup(clientSource))
  // The bundle must carry no copy of its own. This is the invariant the whole
  // arrangement exists for: a string written into `lib/client.js` is a second
  // source, and the two drift the moment one is edited.
  failures.push(...checkNoInlineCopy(clientSource))

  // --- group agreement -------------------------------------------------------
  // The page draws one card per group and reads its heading from `group.<id>`.
  // The two tables are written twice, so they have to agree key by key, in order.
  const hostGroupIds = FIELD_GROUPS.map((group) => group.id)
  const clientGroupIds = clientGroups.map((group) => group.id)
  if (hostGroupIds.join(',') !== clientGroupIds.join(',')) {
    fail(`group order differs:\n  host:   ${hostGroupIds.join(', ')}\n  client: ${clientGroupIds.join(', ')}`)
  }
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

  // --- the locale files are the only source of copy --------------------------
  // The two halves used to carry the same strings twice, and this gate compared
  // them word for word. They no longer carry any: the host projects the locale
  // files into its field table and the browser fetches them through the locale
  // route, so there is nothing left to compare — what is left to check is that
  // the projection is faithful and that the files still describe the package.
  //
  // The host's field table must read exactly what the locale files declare. A
  // projection that silently fell back to a key, or to the wrong language,
  // would render a page that looks translated and is not.
  for (const group of FIELD_GROUPS) {
    const expect = (what, actual, key) => {
      for (const lang of ['en', 'zh']) {
        const declared = localeSettings[lang]?.[key]
        if (typeof declared !== 'string' || declared.length === 0) {
          fail(`${what}: locale/${lang}.json declares no ${JSON.stringify(key)}`)
        } else if (actual?.[lang] !== declared) {
          fail(`${what}: the host projects ${JSON.stringify(actual?.[lang])} for ${lang} but locale/${lang}.json declares ${JSON.stringify(declared)}`)
        }
      }
    }
    expect(`group "${group.id}" title`, group.title, `group.${group.id}`)
    expect(`group "${group.id}" hint`, group.hint, `group.${group.id}.hint`)
    for (const field of group.fields) {
      expect(`field "${field.key}" label`, field.label, `field.${field.key}`)
      expect(`field "${field.key}" hint`, field.hint, `field.${field.key}.hint`)
      if (field.placeholder !== undefined) {
        expect(`field "${field.key}" placeholder`, field.placeholder, `field.${field.key}.placeholder`)
      }
    }
  }
  // `locale/*.json` also carries the package metadata the plugin list reads, so
  // both languages must describe the same package with the same keys.
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
    // The copy is not a route: it is a page-initialization global. The two
    // halves must still agree on the name, because a mismatch leaves the page
    // rendering raw keys with nothing failing anywhere.
    if (hostIndex.LOCALE_GLOBAL === undefined) {
      fail('lib/index.js must export LOCALE_GLOBAL')
    } else if (exported.LOCALE_GLOBAL !== hostIndex.LOCALE_GLOBAL) {
      fail(
        `the client locale global ${JSON.stringify(exported.LOCALE_GLOBAL)} must equal ${JSON.stringify(hostIndex.LOCALE_GLOBAL)}`,
      )
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
    `check-bundle: OK — bundle id, namespace, plugin surface, ${clientFields.length} fields, ${kinds?.length ?? 0} field kinds, ${sources?.length ?? 0} suggestion sources, the locale files, ${Object.keys(hostRoutes ?? {}).length} routes, the locale global, the opt-in Settings entry and script hygiene all agree.`,
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
