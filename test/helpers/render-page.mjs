#!/usr/bin/env node
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as primitives from './primitives-double.mjs'
import { loadBundle } from './load-bundle.mjs'

/**
 * Render the plugin's configuration page and print a JSON report.
 *
 * React is real (`react-dom/server`, so hooks and the element tree are the real
 * thing); the primitives are the double documented in `primitives-double.mjs`,
 * because the shipped ones are a browser bundler input. Run through
 * `test/client-render.test.js`.
 *
 * The fake services validate the namespace they are called with: a client that
 * bound the wrong namespace used to satisfy every assertion here, because the
 * fake answered any name with the same form and dictionary.
 *
 * The fake host is also where the optional Settings entry is observed: its live
 * value can be published, so one mount can show the switch off, the
 * switched-on registrations, and the disposal that follows a switch-off. That
 * is the only way to prove the registration is live rather than decided once
 * at load time.
 */

/** The namespace the page must bind to (the patch row id). */
const EXPECTED_NS = 'android-emulator-helper'
/** The slot the Plugins page renders a bundle's own configuration through. */
const PLUGIN_PAGE_SLOT = 'plugins.bundle.config'
/** The two optional Settings contributions, by the names the bundle registers. */
const SETTINGS_SECTION_SLOT = 'settings.section'
const SETTINGS_ICON_SLOT = 'settings.section.icon'

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
  showInSettings: false,
}

/**
 * A snapshot store stand-in with the shape `SettingsFormModel` subscribes to,
 * plus `publish`: publishing a snapshot is what a landed save looks like to a
 * subscriber, and it is how the report flips the switch.
 */
function snapshotStore(initial) {
  let snapshot = initial
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish: (patch) => {
      snapshot = { ...snapshot, ...patch }
      for (const listener of [...listeners]) listener()
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
    /** Publish one live-value change, the way a save republishes the section. */
    publishValue: (patch) => {
      const snapshot = store.getSnapshot()
      store.publish({ value: { ...snapshot.value, ...patch } })
    },
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
 * @returns {{ctx: object, registered: object, form: object}} the context, its
 *   registration record and the live form the report publishes to.
 */
function fakeContext(options = {}) {
  const served = options.served ?? true
  const form = fakeConfigForm(options)
  const registered = {
    /** Every `slots.register` call, in call order, with its own disposer state. */
    registrations: [],
    /** Every slot name passed to `slots.inject`, repeats included. */
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
        const record = { name: entry.name, options: entry, component, disposed: false }
        registered.registrations.push(record)
        return () => {
          record.disposed = true
        }
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
  return { ctx, registered, form }
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
 * @returns {{ctx: object, registered: object, form: object}} the mount.
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
 * The registration one slot name was made through.
 *
 * A mount makes more than one: the plugin page always, and the two Settings
 * entries while the page's switch is on. Looking the plugin page up by its slot
 * name is what keeps the props of one from being rendered with another's face.
 *
 * @param {{registered: object}} host - the mount.
 * @param {string} [name] - the slot name to find.
 * @returns {object | undefined} the registration record, or undefined.
 */
function registrationFor(host, name = PLUGIN_PAGE_SLOT) {
  return host.registered.registrations.find((record) => record.name === name)
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
 * @param {string} [name] - the slot name whose entry is rendered.
 * @returns {object | undefined} the props, or undefined when nothing registered.
 */
function propsFor(host, name = PLUGIN_PAGE_SLOT) {
  const record = registrationFor(host, name)
  if (record === undefined) return undefined
  return { t: host.ctx.locale.bind(record.options.locale), view: 'page', ...faceToProps(record.options.inject()) }
}

/** Render one mount's plugin-page component to markup. */
function render(host) {
  const record = registrationFor(host)
  const props = propsFor(host)
  if (record === undefined || props === undefined) return ''
  return renderToStaticMarkup(React.createElement(record.component, props))
}

const main = mount()

// The switch is off by default, so the Settings surface must be untouched: one
// slot injected (the plugin page), one registration, no Settings entry. Capture
// this before anything publishes a change.
report.disabled = {
  slots: [...new Set(main.registered.slots)],
  registered: main.registered.registrations.map((record) => record.name),
}

// A host that does not serve the namespace must render no trace of the form.
const unserved = mount({ served: false })
report.unserved = {
  component: registrationFor(unserved) !== undefined,
  slots: [...new Set(unserved.registered.slots)],
}

if (registrationFor(main) === undefined) {
  report.failures.push('apply() registered no plugin-page configuration component')
} else {
  const record = registrationFor(main)
  const { options } = record
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
  if (options.id !== undefined) report.failures.push('the Plugins page entry is keyed by the package name; it must not carry an id')

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

  // --- the opt-in Settings entry -------------------------------------------
  // Publishing the switch is what a landed save does, and the client watches
  // the form's public snapshot, so both registrations must appear without a
  // reload — and their disposers must run when it is published off again.
  try {
    main.form.publishValue({ showInSettings: true })
    const sectionRecord = registrationFor(main, SETTINGS_SECTION_SLOT)
    const iconRecord = registrationFor(main, SETTINGS_ICON_SLOT)
    if (sectionRecord === undefined || iconRecord === undefined) {
      report.failures.push('a saved showInSettings must register both settings.section and settings.section.icon')
    } else {
      const pageRecord = registrationFor(main)
      const pageFace = pageRecord.options.inject()
      const sectionFace = sectionRecord.options.inject()
      const sectionOptions = sectionRecord.options
      const label = typeof sectionOptions.label === 'function' ? sectionOptions.label() : sectionOptions.label
      report.settings = {
        section: {
          name: sectionOptions.name,
          id: sectionOptions.id,
          order: sectionOptions.order,
          locale: sectionOptions.locale,
          label,
          injectKeys: Object.keys(sectionFace).sort(),
        },
        icon: { name: iconRecord.options.name, id: iconRecord.options.id },
        injected: [...new Set(main.registered.slots)],
        pluginPageInjectKeys: Object.keys(pageFace).sort(),
        sameComponent: sectionRecord.component === pageRecord.component,
        sameHookStore: sectionFace.hooks.androidEmulatorSettings === pageFace.hooks.androidEmulatorSettings,
      }

      // The Settings shell renders the section's component with the same face
      // plus its own `close` business prop; the page must be the same form.
      try {
        report.markupEnabled = render(main)
        report.settingsMarkup = renderToStaticMarkup(
          React.createElement(sectionRecord.component, { ...propsFor(main, SETTINGS_SECTION_SLOT), close: () => {} }),
        )
      } catch (error) {
        report.failures.push(`settings render threw: ${error.stack ?? error.message}`)
      }

      try {
        const icon = exported.AndroidIcon
        if (typeof icon !== 'function') {
          report.failures.push('the bundle must export the icon component it registers')
        } else {
          report.icon = {
            registered: iconRecord.component === icon,
            inactive: renderToStaticMarkup(React.createElement(icon, { size: 16, active: false })),
            active: renderToStaticMarkup(React.createElement(icon, { size: 16, active: true })),
          }
        }
      } catch (error) {
        report.failures.push(`icon render threw: ${error.stack ?? error.message}`)
      }

      main.form.publishValue({ showInSettings: false })
      report.toggled = {
        sectionDisposed: sectionRecord.disposed,
        iconDisposed: iconRecord.disposed,
        remaining: main.registered.registrations.filter((entry) => !entry.disposed).map((entry) => entry.name),
      }
    }
  } catch (error) {
    report.failures.push(`the Settings entry check threw: ${error.stack ?? error.message}`)
  }
}

process.stdout.write(`${JSON.stringify(report)}\n`)
