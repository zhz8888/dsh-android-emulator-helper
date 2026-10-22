/**
 * The globals the browser half runs against.
 *
 * `lib/client.js` is a classic script: it is evaluated by the web shell, not
 * imported by Node, so it has no module scope of its own. Two things exist in
 * that scope that the host half never sees:
 *
 * - `window.__ModuleLoader__`, the shell's registration facade. The bundle
 *   calls `load({ id, factory })` with its package name and a factory that
 *   receives the shell's `require`.
 * - `require`, which the shell resolves against its frozen seed table (see
 *   `test/helpers/load-bundle.mjs`) — the platform's static modules and other
 *   plugins' client bundles. It is a run-time lookup, not a Node resolution,
 *   so the modules it returns are declared here rather than imported.
 */

interface Window {
  __ModuleLoader__: {
    load(entry: {
      id: string
      factory: (require: (specifier: string) => unknown) => unknown
    }): void
  }
}

/**
 * The shell's module-table lookup.
 *
 * Resolves a platform seed word (`react`, `@deepseek-ai/dsh-client-store`,
 * `@deepseek-ai/dsh-client-ui-primitives`, …) or another plugin's client
 * bundle. Anything else throws at load time: the shell has no filesystem
 * fallback, so a client bundle cannot reach a file of its own package.
 *
 * The two seed words this half uses are typed exactly, so the page is checked
 * against the real `react` and the real `dsh-client-ui-primitives` instead of
 * against `any`. The catch-all keeps the door open for a seed word this
 * plugin does not use yet.
 */
declare function require(specifier: 'react'): typeof import('react')
declare function require(specifier: '@deepseek-ai/dsh-client-ui-primitives'): typeof import('@deepseek-ai/dsh-client-ui-primitives')
declare function require(specifier: string): any
