import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCALE_GLOBAL } from '../../lib/index.js'

/**
 * Load the browser bundle exactly the way the DSH web shell does.
 *
 * Shared by the test suite and `scripts/check-bundle.mjs`. The shell injects a
 * `window.__ModuleLoader__` facade and evaluates the bundle as a classic
 * script, so this reproduces that: a `window` stand-in, the static module
 * table as the only resolvable `require`, and the factory invoked with the
 * same `require`.
 *
 * @module test/helpers/load-bundle
 */

/** Package root, derived from this file's location. */
export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * The shell's frozen platform seed table.
 *
 * Taken from the shipped DSH web frontend's own module table — the SPA's
 * `staticModules` seed, which the shell hands to `__ModuleLoader__.create(...)`
 * as the only modules a plugin bundle may resolve. It is the shell's table,
 * not this plugin's: a stricter list here would reject a bundle the shell
 * would happily load, and a looser one would let through a bundle the shell
 * cannot resolve at all.
 *
 * Nothing outside this list may be `require`d by a client bundle unless it is
 * declared in `dsh.client.external` and provided by another plugin's row.
 */
export const STATIC_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/**
 * The page-initialization globals a real page carries.
 *
 * The web server renders the plugin's dictionaries into `index.html` as a
 * `global` row before the application bundle runs, so the bundle reads them
 * synchronously at module scope. A loader that evaluated the bundle without
 * them would exercise a deployment that renders no index through the harness'
 * web server — a real shape, but not the one the page ships in.
 *
 * The payload is read from the same two files the host half reads, so a test
 * that renders the page sees the copy a real page shows.
 *
 * @returns {Record<string, unknown>} the globals to install around the factory.
 */
export function pageGlobals() {
  const read = (language) =>
    JSON.parse(readFileSync(path.join(ROOT, 'locale', `${language}.json`), 'utf8')).settings
  return { [LOCALE_GLOBAL]: { en: read('en'), zh: read('zh') } }
}

/** A permissive stand-in for a required module: used only to execute the factory. */
export function stubModule(extra = {}) {
  return new Proxy(extra, {
    get(target, key) {
      if (key in target) return target[key]
      if (typeof key !== 'string') return undefined
      return /^[A-Z]/.test(key) ? (props) => ({ type: key, props }) : () => undefined
    },
  })
}

/**
 * Evaluate `lib/client.js` and return the registration plus the module exports.
 *
 * `globals` reproduces the page-initialization data the web server renders into
 * `index.html` ahead of the bundle: the shell evaluates a plugin bundle only
 * after those `<script>` rows have run, so a bundle that reads one at module
 * scope must find it already installed here too. Each entry is set before the
 * factory runs and removed afterwards, so one load cannot leak into the next.
 *
 * It defaults to {@link pageGlobals}, because the shipped page always carries
 * the copy: a loader that left it out would exercise a deployment that renders
 * no index through the harness' web server. Pass `globals: {}` to load the
 * bundle the way such a deployment would.
 *
 * @param {{resolve?: (specifier: string) => unknown, globals?: Record<string, unknown>}} [options] -
 *   module resolver override and page-initialization globals.
 * @returns {{registration: {id: string, factory: Function}, exported: object, required: string[]}} the outcome.
 */
export function loadBundle(options = {}) {
  const source = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  const required = []
  let registration
  const resolve =
    options.resolve ??
    ((specifier) => {
      assert.ok(
        STATIC_MODULES.includes(specifier),
        `client bundle required "${specifier}", which is not in the shell's static module table`,
      )
      return stubModule({
        useId: () => 'id',
        useRef: (value) => ({ current: value }),
        useCallback: (fn) => fn,
        useState: (value) => [value, () => {}],
      })
    })
  const require = (specifier) => {
    required.push(specifier)
    return resolve(specifier)
  }
  // The shell's asset lookup beside the module table: `require.asset` compiles a
  // package's own `./assets/*` export into a carrier-fetchable URL. The Web page
  // carrier defaults it to identity, which is what the assertions read.
  require.asset = (reference) => reference
  const window = {
    __ModuleLoader__: {
      load(entry) {
        registration = entry
      },
    },
  }
  // A classic script, not a module: no import/export, and `return` is not top-level.
  const run = new Function('window', 'require', `${source}\nreturn undefined`)
  run(window, require)
  assert.ok(registration, 'the bundle did not call window.__ModuleLoader__.load')
  // The factory is the module body: it runs here, so the page-initialization
  // globals have to be in place around this call, not around the script above.
  const installed = Object.entries(options.globals ?? pageGlobals())
  const previous = installed.map(([name]) => [name, Object.hasOwn(globalThis, name), globalThis[name]])
  for (const [name, value] of installed) globalThis[name] = value
  try {
    return { registration, exported: registration.factory(require), required }
  } finally {
    for (const [name, existed, value] of previous) {
      if (existed) globalThis[name] = value
      else delete globalThis[name]
    }
  }
}
