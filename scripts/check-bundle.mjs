#!/usr/bin/env node
import process from 'node:process'
import { FIELD_GROUPS, FIELD_KEYS, FIELDS, SETTINGS_NAMESPACE } from '../lib/settings.js'
import { ROOT, loadBundle } from '../test/helpers/load-bundle.mjs'
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as hostIndex from '../lib/index.js'

/**
 * Consistency gate for the browser bundle (run via `pnpm run check`).
 *
 * The client cannot import the host's settings module, so the field table and
 * settings namespace are written twice; this keeps the copies identical and
 * checks the browser-only file's structure.
 *
 * Export-reading invariants are pure functions so tests can run them on fixtures;
 * the gate itself runs only when this file is the entry point (import is side-effect free).
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
 * The dictionaries the host publishes to the page, read from the same files it reads.
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
 * Remove line and block comments before source-text comparisons (so an
 * explanatory comment is not read as a declaration). A `:` before `//` is spared
 * so a URL-shaped string cannot swallow its line.
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
 * The slot a bundle registers its own configuration page into: the Plugins page
 * owns this key, so the form lives on the row's **Configure** page, not inline on
 * the bundle's detail page.
 */
export const PLUGIN_PAGE_SLOT = 'plugins.row.config'

/**
 * Check that every exported kind has a renderer: reads the `RENDERERS` map's keys
 * from source and requires the exported list to match exactly.
 *
 * Across the realm boundary "derived from the renderer map" is only a claim — a
 * kind added to `FIELD_KINDS` without a renderer would pass host↔client checks
 * yet render a text box.
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
 * Check the three registrations (row page, Settings section, section icon) take
 * their slot/key/id from `PLUGIN_SURFACE` / `SETTINGS_SURFACE`, not literals.
 *
 * A live failure this caught: a renamed registration literal moved the page to a
 * slot nothing renders while the exported surface stayed correct. The two Settings
 * entries must share `SETTINGS_SURFACE.id` or the icon detaches and the shell
 * silently draws its default glyph.
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
 * Check the Settings slot names have one source: `settings.section` and
 * `settings.section.icon` may appear only inside `SETTINGS_SURFACE`. A repeated
 * literal anywhere else is a second source that can drift. Comments are stripped
 * first, so this checks code, not prose.
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
 * Mount the browser half over a minimal host and record its registrations.
 *
 * Registration must be observed, not just read: the opt-in switch means the
 * Settings entry does not exist while off. Shared primitives are stubbed so only
 * registrations are tested; `loadBundle` already installed the locale global.
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
 * Check the Settings entry follows `showInSettings` by mounting real `apply`
 * with the switch off → on → off: no Settings entry when off, section + icon
 * (one shared id) when on, both disposed when saved off without a reload.
 *
 * A structural check cannot prove the gate works — a registration moved out of
 * the guard still reads the surface and names the right slot.
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
    // The section renders the same form as the row's page, so its entry has to
    // inject the same face: the component reads `useAndroidEmulatorSettings`
    // and the four actions off its props before it draws anything, and an entry
    // without a face throws there with the type gate none the wiser. The row's
    // entry is the reference rather than a list of names hard-coded here,
    // because the two placements must render the one form.
    const row = byName.get(PLUGIN_PAGE_SLOT)
    if (row === undefined) {
      problems.push(`with the switch on the bundle must keep ${JSON.stringify(PLUGIN_PAGE_SLOT)} registered`)
    } else if (typeof row.entry.inject !== 'function') {
      problems.push('the row page entry must inject the form face its component reads')
    } else if (typeof section.entry.inject !== 'function') {
      problems.push('the Settings section entry must inject the form face its component reads')
    } else {
      const rowFace = Object.keys(row.entry.inject() ?? {}).sort()
      const sectionFace = Object.keys(section.entry.inject() ?? {}).sort()
      if (rowFace.join(',') !== sectionFace.join(',')) {
        problems.push(
          `the Settings section must inject the same form face as the row page (row: [${rowFace.join(', ')}], section: [${sectionFace.join(', ')}])`,
        )
      }
    }
    // The icon and the form are two registrations; the section must carry the
    // form, or the Settings dialog would draw the glyph where the page belongs.
    if (typeof section.component !== 'function') {
      problems.push('the Settings section registration must pass its component')
    } else if (section.component === icon.component) {
      problems.push('the Settings section must render the form, not the rail icon')
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
 * Every field kind must be one the halves handle: both switch on `field.kind`
 * with a `default:` text-input fallback, so an unknown kind degrades silently
 * (a number staged as a string) rather than failing.
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
 * A mistyped `suggest` yields `undefined` → an empty list: the datalist vanishes
 * with no error. A `discovery` field needs `suggest` — it carries no `options`,
 * so without it the dropdown has only the saved value and looks like an empty
 * machine, not a broken field.
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
 * The two locale files must declare the same keys: a key in one but not the other
 * renders as the key itself there (the locale binding answers the key when missing).
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
 * Every string the page can render must exist in both locale files (a missing
 * key is a raw key on the page, not a compile error). Walks the page's keys:
 * chrome, group/field headings and hints, placeholders and option labels.
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
 * Every declared option label must exist in both dictionaries: the page looks it
 * up by key, so a missing entry silently shows the raw option value.
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
 * The dictionary key suffix one option value is stored under: mirrors the
 * client's `optionKey()` — empty reserves `empty`, others are percent-encoded
 * behind `v.` so a literal `"empty"` cannot collide.
 *
 * @param {string} value - one option's value.
 * @returns {string} the key suffix.
 */
export function optionKey(value) {
  return value === '' ? 'empty' : `v.${encodeURIComponent(value)}`
}

/**
 * Check the render-time option-label lookup goes through `optionKey()`, not
 * `${value}`: a drift inside `optionKey()` moves both export sides together and
 * is unobservable, but the lookup is a separate call site that can read a
 * non-existent key and silently render the raw value.
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
 * The bundle must carry no copy of its own: every rendered string lives in the
 * locale files. Two shapes are refused — a `{zh: …, en: …}` literal (the old
 * inline dictionary) and a CJK character in a string literal (a pasted label).
 * Comments are exempt; they render nothing.
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
 * Run every invariant and report failures. Split from the module body so
 * importing this file (as tests do) does not run the gate.
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
  for (const name of ['apply', 'inject', 'NS', 'FIELD_META', 'GROUP_META', 'PLUGIN_SURFACE', 'SETTINGS_SURFACE', 'FIXED_KEYS']) {
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
  //
  // The chrome half is the only one of those written by hand at its call sites
  // rather than derived from a table, so its export is required to be a
  // non-empty array: substituting `[]` for an export that went missing would
  // turn this walk into a loop over nothing and leave the page free to render a
  // raw key with the gate green.
  const fixedKeys = exported.FIXED_KEYS
  if (!Array.isArray(fixedKeys) || fixedKeys.length === 0) {
    fail('the client bundle must export a non-empty FIXED_KEYS list: the page-chrome keys are what the dictionary coverage walk checks')
  }
  failures.push(
    ...checkDictionaryCoverage(
      clientGroups.map((group) => ({
        id: group.id,
        fields: group.fields.map((key) => clientFieldsByKey.get(key) ?? { key }),
      })),
      Array.isArray(fixedKeys) ? fixedKeys : [],
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
 * Print failures and exit non-zero, or print `summary` and exit zero.
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
//
// The comparison is made on resolved paths rather than on the URL strings.
// macOS resolves the temporary directory to `/private/var/...` while the path
// the caller typed is `/var/...`, so `import.meta.url` (already resolved by
// the loader) and `pathToFileURL(process.argv[1])` (not resolved) name the
// same file with two different strings. A string comparison then answers "not
// the entry point" and the gate exits 0 having printed nothing at all — which
// is exactly how a copy of the repository under `$TMPDIR` reported success
// without running a single check.
if (process.argv[1] !== undefined && isEntryPoint(process.argv[1])) {
  main()
}

/**
 * Whether `candidate` names this module, comparing resolved filesystem paths.
 *
 * @param {string} candidate - the path the process was started with.
 * @returns {boolean} true when it is this file.
 */
function isEntryPoint(candidate) {
  const self = fileURLToPath(import.meta.url)
  try {
    return realpathSync(self) === realpathSync(candidate)
  } catch {
    // A path that cannot be resolved (a deleted file, a permission error) is
    // compared as text, which is the old behaviour and still correct for the
    // ordinary case.
    return self === candidate
  }
}
