#!/usr/bin/env node
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as primitives from './primitives-double.mjs'
import { loadBundle } from './load-bundle.mjs'

/**
 * Render the plugin's Plugins-page configuration form and print a JSON report.
 *
 * React is real (`react-dom/server`, so hooks and the element tree are the real
 * thing); the primitives are the double documented in `primitives-double.mjs`,
 * because the shipped ones are a browser bundler input. Run through
 * `test/client-render.test.js`.
 */

const report = { failures: [], markup: '', registered: null }

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

/**
 * The Cordis-like browser context the bundle's `apply` expects.
 *
 * @param {{served?: boolean}} [options] - `served: false` models a host that does
 *   not serve the settings namespace: `whileServed` then never calls back.
 * @returns {{ctx: object, registered: object}} the context and its registration record.
 */
function fakeContext(options = {}) {
  const served = options.served ?? true
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
        if (!served) return () => {}
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

// A host that does not serve the namespace must render no trace of the form.
const unserved = fakeContext({ served: false })
try {
  exported.apply(unserved.ctx)
} catch (error) {
  report.failures.push(`apply() threw without a served namespace: ${error.message}`)
}
report.unserved = {
  component: unserved.registered.component !== undefined,
  slots: [...new Set(unserved.registered.slots)],
}

/**
 * Project an `inject()` face into component props the way the slot renderer
 * does: an entry in `hooks` named `foo` becomes a `useFoo(selector)` prop, and
 * the rest of the face is spread through as business props. The real renderer
 * builds those hooks on `useSyncExternalStore`; a server render observes one
 * snapshot, so reading it directly is equivalent here.
 *
 * @param {object} face - the injected face.
 * @returns {object} the props the slot renderer composes.
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

if (registered.component === undefined) {
  report.failures.push('apply() registered no plugin-page configuration component')
} else {
  const { component, options } = registered
  report.registered = { slot: options.name, key: options.key, locale: options.locale }

  // The plugin detail page keys a bundle's configuration by the BUNDLE's
  // package name and draws the title, icon and crumb itself — so the entry
  // carries neither the settings navigation's label nor its order.
  for (const [key, expected] of [
    ['name', 'plugins.bundle.config'],
    ['key', '@zhz8888/dsh-android-emulator-helper'],
    ['locale', 'settings.androidEmulatorHelper'],
  ]) {
    if (options[key] !== expected) {
      report.failures.push(`slot option ${key}=${JSON.stringify(options[key])} (want ${JSON.stringify(expected)})`)
    }
  }
  if (options.label !== undefined) report.failures.push('the plugin detail page draws its own title; the entry must not register a label')

  let props
  try {
    props = { t: ctx.locale.bind(options.locale), view: 'page', ...faceToProps(options.inject()) }
  } catch (error) {
    report.failures.push(`inject() threw: ${error.message}`)
  }

  if (props !== undefined) {
    try {
      report.markup = renderToStaticMarkup(React.createElement(component, props))
      report.registered.injectKeys = Object.keys(props).sort()
      report.registered.slots = [...new Set(registered.slots)]
    } catch (error) {
      report.failures.push(`render threw: ${error.stack ?? error.message}`)
    }
  }
}

process.stdout.write(`${JSON.stringify(report)}\n`)
