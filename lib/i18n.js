import { readFileSync } from 'node:fs'

/**
 * The plugin's copy, in both languages, read from `locale/`.
 *
 * Every user-visible string this plugin renders lives in `locale/en.json` and
 * `locale/zh.json` — the two files DSH already resolves for the plugin's name
 * and description. They are the single source: the host half projects them into
 * the field table below, and the browser half fetches the same two dictionaries
 * through the locale route, so neither half carries a copy of its own.
 *
 * The files are read once, at import time. They are package resources, not user
 * data: nothing rewrites them at run time, and a missing one is a packaging
 * bug rather than a state to recover from — which is why {@link text} throws
 * instead of falling back to the key. A silent fallback would ship a page full
 * of raw keys and no error anywhere.
 *
 * @module @zhz8888/dsh-android-emulator-helper/i18n
 */

/** The two languages the plugin ships. `en` is the fallback DSH requires. */
export const LANGUAGES = Object.freeze(['en', 'zh'])

/**
 * Read one locale file's `settings` section.
 *
 * `meta` is the plugin-list metadata DSH reads; `settings` is this plugin's own
 * dictionary. Only the latter is returned, because the two are consumed by
 * different things and mixing them would let a page render `meta.title` as a
 * label.
 *
 * @param {string} language - the language id, which is also the file name.
 * @returns {Record<string, string>} the flat dictionary.
 */
function readSettings(language) {
  const file = new URL(`../locale/${language}.json`, import.meta.url)
  /** @type {unknown} */
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`android-emulator-helper: could not read ${file.pathname}: ${String(error)}`)
  }
  const settings = /** @type {{settings?: unknown}} */ (parsed)?.settings
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    throw new Error(`android-emulator-helper: ${file.pathname} must declare a "settings" object`)
  }
  /** @type {Record<string, string>} */
  const out = {}
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value !== 'string') {
      throw new Error(`android-emulator-helper: ${file.pathname} declares a non-string "${key}"`)
    }
    out[key] = value
  }
  return out
}

/**
 * The complete dictionaries, keyed by language.
 *
 * This is what the locale route serves and what the host half projects from, so
 * the two cannot disagree: there is one object, read once.
 *
 * @type {Readonly<{en: Readonly<Record<string, string>>, zh: Readonly<Record<string, string>>}>}
 */
export const MESSAGES = Object.freeze({
  en: Object.freeze(readSettings('en')),
  zh: Object.freeze(readSettings('zh')),
})

/**
 * One message in both languages.
 *
 * The host's field table is declared as `{zh, en}` pairs — that is the shape
 * `lib/settings.js` has always used and the shape the consistency gate reads —
 * so this is the projection from the flat dictionary into it. A key missing
 * from either language throws here, at import time, rather than rendering as
 * itself on the page.
 *
 * @param {string} key - the dictionary key, e.g. `field.sdkPath`.
 * @returns {{zh: string, en: string}} the message in both languages.
 */
export function text(key) {
  const en = MESSAGES.en[key]
  const zh = MESSAGES.zh[key]
  if (typeof en !== 'string' || en.length === 0) {
    throw new Error(`android-emulator-helper: locale/en.json declares no "${key}"`)
  }
  if (typeof zh !== 'string' || zh.length === 0) {
    throw new Error(`android-emulator-helper: locale/zh.json declares no "${key}"`)
  }
  return { zh, en }
}
