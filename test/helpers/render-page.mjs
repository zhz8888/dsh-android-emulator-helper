#!/usr/bin/env node
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as primitives from './primitives-double.mjs'
import { loadBundle } from './load-bundle.mjs'

/**
 * Render the settings page and print a JSON report.
 *
 * React is real (`react-dom/server`, so hooks and the element tree are the real
 * thing); the primitives are the double documented in `primitives-double.mjs`,
 * because the shipped ones are a browser bundler input. Run through
 * `test/client-render.test.js`.
 */

const report = { failures: [], markup: '', registered: null, navLabel: undefined }

/** The values the fake host serves, matching the plugin's declared defaults. */
const LIVE_VALUES = {
  sdkPath: '',
  jdkMajor: '17',
  buildToolsVersion: '35.0.0',
  defaultAvd: 'medium_phone',
  defaultSerial: '',
  autoStartEmulator: true,
  emulatorArgs: '',
  bootTimeoutSeconds: 180,
  apiLevel: '35',
  systemImageVariant: 'default',
  systemImageAbi: '',
  minSdk: 23,
  buildTimeoutSeconds: 600,
  gradleExtraArgs: '',
  dataDir: '',
  screenshotDir: '',
  logTailLines: 500,
}

/** A snapshot-store stand-in with the shape `SettingsFormModel` subscribes to. */
function snapshotStore(initial) {
  let snapshot = initial
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** The shared config form the host would serve for this namespace. */
function fakeConfigForm() {
  const store = snapshotStore({
    status: 'ready',
    value: { ...LIVE_VALUES },
    base: { ...LIVE_VALUES },
    user: { apiLevel: '35' },
    revision: 3,
    writable: true,
    mode: 'host',
  })
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    set: async () => true,
    unset: async () => true,
    mutate: async () => true,
  }
}

/** The Cordis-like browser context the bundle's `apply` expects. */
function fakeContext() {
  const form = fakeConfigForm()
  const registered = { component: undefined, options: undefined, slots: [], dictionaries: [] }
  const dictionaries = () => registered.dictionaries.at(-1)?.dictionaries
  const ctx = {
    configForms: {
      get: () => form,
      describe: () => ({
        getSnapshot: () => ({ view: { namespaces: [{ ns: 'android-emulator-helper' }], writable: true } }),
      }),
      whileServed: (namespaces, register) => {
        const disposer = register(new Set(namespaces))
        return typeof disposer === 'function' ? disposer : () => {}
      },
    },
    locale: {
      register: (ns, value) => {
        registered.dictionaries.push({ ns, dictionaries: value })
        return () => {}
      },
      bind:
        () =>
        (key, params) => {
          const template = dictionaries()?.en?.[key] ?? key
          return params === undefined ? template : template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
        },
      getSnapshot: () => ({ revision: 1 }),
      subscribe: () => () => {},
    },
    slots: {
      inject: (name, callback) => {
        registered.slots.push(name)
        return callback()
      },
      register: (options, component) => {
        registered.options = options
        registered.component = component
        return () => {}
      },
      getVersion: () => 1,
      entries: () => [],
      subscribe: () => () => {},
    },
    effect: (callback) => {
      const disposer = callback()
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
    get: () => undefined,
    logger: { info() {}, warn() {}, error() {} },
  }
  return { ctx, registered }
}

const { ctx, registered } = fakeContext()
const { exported } = loadBundle({
  resolve: (specifier) => {
    if (specifier === 'react') return React
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected require in the render test: ${specifier}`)
  },
})

try {
  exported.apply(ctx)
} catch (error) {
  report.failures.push(`apply() threw: ${error.message}`)
}

if (registered.component === undefined) {
  report.failures.push('apply() registered no settings section component')
} else {
  const { component, options } = registered
  for (const [key, expected] of [
    ['name', 'settings.section'],
    ['id', 'android-emulator'],
    ['locale', 'settings.androidEmulatorHelper'],
  ]) {
    if (options[key] !== expected) {
      report.failures.push(`slot option ${key}=${JSON.stringify(options[key])} (want ${JSON.stringify(expected)})`)
    }
  }
  if (typeof options.label !== 'function') report.failures.push('slot label must be a thunk so it follows the locale')
  if (options.order !== 16) report.failures.push(`slot order ${options.order} != 16`)

/**
 * Project an `inject()` face into component props the way the slot renderer
 * does: an entry in `hooks` named `foo` becomes a `useFoo(selector)` prop, and
 * the rest of the face is spread through as business props. The real renderer
 * builds those hooks on `useSyncExternalStore`; a server render observes one
 * snapshot, so reading it directly is equivalent here.
 */
function faceToProps(face) {
  const hooks = {}
  for (const [key, store] of Object.entries(face.hooks ?? {})) {
    const name = `use${key.charAt(0).toUpperCase()}${key.slice(1)}`
    hooks[name] = (selector) => selector(store.getSnapshot())
  }
  const { hooks: _hooks, ...rest } = face
  void _hooks
  return { ...hooks, ...rest }
}

  let props
  try {
    props = { t: ctx.locale.bind(options.locale), ...faceToProps(options.inject()), close: () => {} }
  } catch (error) {
    report.failures.push(`inject() threw: ${error.message}`)
  }

  if (props !== undefined) {
    try {
      report.markup = renderToStaticMarkup(React.createElement(component, props))
      report.registered = { id: options.id, order: options.order, injectKeys: Object.keys(props).sort() }
      // The shell re-reads the label on every projection, so it must be a thunk.
      report.navLabel = options.label()
    } catch (error) {
      report.failures.push(`render threw: ${error.stack ?? error.message}`)
    }
  }
}

process.stdout.write(`${JSON.stringify(report)}\n`)
