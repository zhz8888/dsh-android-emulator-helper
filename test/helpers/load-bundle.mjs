import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
 * @param {{resolve?: (specifier: string) => unknown}} [options] - module resolver override.
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
  return { registration, exported: registration.factory(require), required }
}
