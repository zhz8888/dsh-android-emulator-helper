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
 *
 * The fake services validate the namespace they are called with: a client that
 * bound the wrong namespace used to satisfy every assertion here, because the
 * fake answered any name with the same form and dictionary.
 */

/** The namespace the page must bind to (the patch row id). */
const EXPECTED_NS = 'android-emulator-helper'

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
function fakeConfigForm(options = {}) {
  const store = snapshotStore({
    status: options.status ?? 'ready',
    value: { ...LIVE_VALUES },
    base: { ...LIVE_VALUES },
    user: { apiLevel: '35' },
    revision: 3,
    writable: options.writable ?? true,
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
 * @param {{served?: boolean, status?: string, writable?: boolean}} [options] - `served: false`
 *   models a host that does not serve the settings namespace: `whileServed` then
 *   never calls back.
 * @returns {{ctx: object, registered: object}} the context and its registration record.
 */
function fakeContext(options = {}) {
  const served = options.served ?? true
  const form = fakeConfigForm(options)
  const registered = {
    component: undefined,
    options: undefined,
    slots: [],
    dictionaries: [],
    namespaceCalls: [],
    servedNamespaces: [],
    boundNamespace: undefined,
  }
  const dictionaries = new Map()
  const ctx = {
    configForms: {
      get: (namespace) => {
        registered.namespaceCalls.push(namespace)
        return form
      },
      describe: () => ({
        getSnapshot: () => ({ view: { namespaces: [{ ns: EXPECTED_NS }], writable: true } }),
      }),
      whileServed: (namespaces, register) => {
        registered.servedNamespaces.push([...namespaces])
        if (!served || !namespaces.includes(EXPECTED_NS)) return () => {}
        const disposer = register(new Set(namespaces))
        return typeof disposer === 'function' ? disposer : () => {}
      },
    },
    locale: {
      register: (namespace, value) => {
        dictionaries.set(namespace, value)
        registered.dictionaries.push({ ns: namespace, dictionaries: value })
        return () => {}
      },
      bind: (namespace) => {
        registered.boundNamespace = namespace
        return (key, params) => {
          const template = dictionaries.get(namespace)?.en?.[key] ?? key
          return params === undefined ? template : template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
        }
      },
      getSnapshot: () => ({ revision: 1 }),
      subscribe: () => () => {},
    },
    slots: {
      inject: (name, callback) => {
        registered.slots.push(name)
        return callback()
      },
      register: (entry, component) => {
        registered.options = entry
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

const { exported } = loadBundle({
  resolve: (specifier) => {
    if (specifier === 'react') return React
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected require in the render test: ${specifier}`)
  },
})

/**
 * Mount the bundle against one fake host.
 *
 * @param {{served?: boolean, status?: string, writable?: boolean}} [options] - host shape.
 * @returns {{ctx: object, registered: object}} the mount.
 */
function mount(options = {}) {
  const host = fakeContext(options)
  try {
    exported.apply(host.ctx)
  } catch (error) {
    report.failures.push(`apply() threw: ${error.message}`)
  }
  return host
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

/**
 * The props one registered component is rendered with.
 *
 * @param {{ctx: object, registered: object}} host - the mount.
 * @returns {object | undefined} the props, or undefined when nothing registered.
 */
function propsFor(host) {
  const { component, options } = host.registered
  if (component === undefined) return undefined
  return { t: host.ctx.locale.bind(options.locale), view: 'page', ...faceToProps(options.inject()) }
}

/** Render one mount's component to markup. */
function render(host) {
  const props = propsFor(host)
  if (props === undefined) return ''
  return renderToStaticMarkup(React.createElement(host.registered.component, props))
}

const main = mount()

// A host that does not serve the namespace must render no trace of the form.
const unserved = mount({ served: false })
report.unserved = {
  component: unserved.registered.component !== undefined,
  slots: [...new Set(unserved.registered.slots)],
}

if (main.registered.component === undefined) {
  report.failures.push('apply() registered no plugin-page configuration component')
} else {
  const { options } = main.registered
  report.registered = {
    slot: options.name,
    key: options.key,
    locale: options.locale,
    injectKeys: Object.keys(propsFor(main) ?? {}).sort(),
    slots: [...new Set(main.registered.slots)],
    // Every service call the client made, so the test can refuse a wrong
    // namespace instead of accepting whatever the fake was asked for.
    namespaceCalls: [...new Set(main.registered.namespaceCalls)],
    servedNamespaces: main.registered.servedNamespaces,
    boundNamespace: main.registered.boundNamespace,
    dictionaryNamespaces: [...new Set(main.registered.dictionaries.map((entry) => entry.ns))],
  }

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

  try {
    report.markup = render(main)
  } catch (error) {
    report.failures.push(`render threw: ${error.stack ?? error.message}`)
  }

  // The clean/ready state is the one every route button starts in. The states
  // below carry the copy that only appears after an edit, a failure or on a
  // read-only deployment: a missing key there rendered as the raw key and no
  // test saw it.
  const editProps = propsFor(main)
  if (editProps !== undefined) {
    try {
      editProps.edit('minSdk', 'abc')
      report.invalidMarkup = render(main)
      editProps.discard()
      // 0 passes the schema's non-negative rule but the host treats it as
      // "unset"; the form must refuse it rather than persist a value the tools
      // silently replace.
      editProps.edit('minSdk', '0')
      report.zeroMarkup = render(main)
      editProps.discard()
      editProps.edit('apiLevel', '36')
      report.dirtyMarkup = render(main)
      editProps.discard()
      // Parses to the served value but has different draft text: the model's
      // plan still stages a write, so the action bar must stay available.
      editProps.edit('apiLevel', ' 35')
      report.noopishMarkup = render(main)
      editProps.discard()
    } catch (error) {
      report.failures.push(`staged render threw: ${error.stack ?? error.message}`)
    }
  }

  try {
    report.readOnlyMarkup = render(mount({ writable: false }))
    report.unavailableMarkup = render(mount({ status: 'unavailable' }))
  } catch (error) {
    report.failures.push(`state render threw: ${error.stack ?? error.message}`)
  }
}

process.stdout.write(`${JSON.stringify(report)}\n`)
