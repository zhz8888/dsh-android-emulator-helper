import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ROOT, loadBundle } from './helpers/load-bundle.mjs'

/**
 * Render the plugin's configuration page with real React.
 *
 * The form is the artifact a port most easily gets wrong: a missing dictionary
 * key, a field the host never sends, an `inject` face that does not match what
 * the slot renderer calls, or an uncontrolled input. Rendering it through
 * `react-dom/server` turns all of those into a failing test instead of a broken
 * plugin detail page.
 *
 * The same suite covers the optional Settings entry: with the page's own switch
 * off the mount must touch the Settings surface not at all, and with it on the
 * bundle must register a `settings.section` entry and its
 * `settings.section.icon` contribution, then dispose both when it goes off
 * again.
 *
 * React is real. `@deepseek-ai/dsh-client-ui-primitives` is doubled, because the
 * shipped package is a browser bundler input (`*.module.css`, `simple-icons`,
 * `zustand/vanilla`) that plain Node cannot import; the double mirrors the
 * documented contract. See `test/helpers/primitives-double.mjs`.
 *
 * The render runs in a child process so the JSON report is not polluted by
 * anything else the module graph prints.
 */

const run = promisify(execFile)

/** Render once; the form is deterministic for a fixed host snapshot. */
async function renderPage() {
  const { stdout } = await run(process.execPath, [path.join(ROOT, 'test', 'helpers', 'render-page.mjs')], {
    cwd: ROOT,
    maxBuffer: 8 * 1024 * 1024,
  })
  return JSON.parse(stdout.trim().split('\n').at(-1))
}

const report = await renderPage()

test('the configuration form renders without throwing', () => {
  assert.deepEqual(report.failures, [])
  assert.ok(report.markup.length > 1000, 'the form must render real markup')
})

test('the plugin page is registered unconditionally, and the Settings entry only when asked for', () => {
  // A plugin's own configuration belongs on the Plugins page: the
  // `plugins.bundle.config` slot is keyed by the BUNDLE's package name, and the
  // page renders the entry inside the plugin detail. The Settings dialog's
  // `settings.section` is opt-in, so the default mount must not touch it at
  // all — one injected slot, one registration, and no label or id on the entry
  // the Plugins page draws the chrome for.
  assert.equal(report.registered.slot, 'plugins.bundle.config')
  assert.equal(report.registered.key, '@zhz8888/dsh-android-emulator-helper')
  assert.equal(report.registered.locale, 'settings.androidEmulatorHelper')
  assert.deepEqual(report.registered.slots, ['plugins.bundle.config'])
  assert.deepEqual(report.disabled.slots, ['plugins.bundle.config'], 'no Settings slot is injected while the switch is off')
  assert.deepEqual(report.disabled.registered, ['plugins.bundle.config'], 'and no Settings entry is registered')
})

test('the injected face carries the form actions and the view the page asks for', () => {
  // The page asks for `view: 'page'`; there is no summary view for a bundle's
  // own configuration, and the form needs no `label` of its own because the
  // page draws the title.
  assert.deepEqual(report.registered.injectKeys, [
    'discard',
    'edit',
    'loadInventory',
    'loadStatus',
    'resetField',
    'save',
    't',
    'useAndroidEmulatorSettings',
    'view',
  ])
})

test('with the switch saved on, the form is also a Settings section', () => {
  // The switch is a live setting, so publishing it is what a landed save does:
  // both registrations must appear, and the section must describe itself the
  // way the Settings navigation needs it — same id as the icon, its own order,
  // the page's dictionary namespace and a resolved nav label.
  const { section, icon } = report.settings
  assert.equal(section.name, 'settings.section')
  assert.equal(section.id, 'android-emulator-helper')
  assert.equal(section.order, 100)
  assert.equal(section.locale, 'settings.androidEmulatorHelper')
  assert.equal(section.label, 'Android emulator', 'the nav label comes from the bundle dictionary')
  assert.equal(icon.name, 'settings.section.icon')
  assert.equal(icon.id, section.id, 'the shell pairs a section with its icon by id')
  assert.deepEqual(
    report.settings.injected,
    ['plugins.bundle.config', 'settings.section.icon', 'settings.section'],
    'the plugin page keeps its slot, and both Settings contributions are injected',
  )
})

test('the Settings section renders the same form and the same face as the plugin page', () => {
  // The section is not a second form: it is the same component over the same
  // controller, so a save made from Settings is staged and written exactly as
  // one made from the plugin detail page.
  assert.equal(report.settings.sameComponent, true, 'the section renders the plugin page component')
  assert.equal(report.settings.sameHookStore, true, 'and reads the same snapshot store')
  assert.deepEqual(report.settings.section.injectKeys, report.settings.pluginPageInjectKeys)
  for (const heading of [
    'SDK and toolchain',
    'Emulator and devices',
    'API level and system image',
    'Build',
    'Output and logs',
    'Interface',
    'Diagnostics and discovery',
  ]) {
    assert.ok(report.settingsMarkup.includes(heading), `the Settings section is missing the group heading: ${heading}`)
  }
  assert.match(report.settingsMarkup, /Show in Settings/)
  assert.match(report.settingsMarkup, /Changes are saved to this profile and take effect on the next tool call\./)
  assert.equal(
    report.settingsMarkup,
    report.markupEnabled,
    'the same component over the same live value renders the same form',
  )
})

test('the Settings icon is the supplied Android glyph, published as a package asset', () => {
  // The rail paints a section's `settings.section.icon` contribution in the nav
  // item's own colour, and a client bundle cannot read its own package: the
  // artwork is a file the Host serves at the asset route, referenced through
  // `require.asset` and drawn as a mask so it takes that colour. No glyph
  // geometry may live in the bundle — that is the point of publishing it.
  const { inactive, active } = report.icon
  assert.equal(report.icon.registered, true, 'the registered contribution is the exported component')

  for (const markup of [inactive, active]) {
    assert.match(markup, /^<span /, 'the icon is a masked box, not an inline glyph')
    assert.match(markup, /background-color:currentColor/, 'the mark takes the nav item colour')
    assert.match(markup, /-webkit-mask:/, 'the prefixed mask reaches older renderers')
    assert.match(markup, /mask:/, 'and the standard property is present too')
    assert.match(
      markup,
      /plugins\/@zhz8888\/dsh-android-emulator-helper\/assets\/android-head\.svg/,
      'the artwork is a package asset, referenced by its published path',
    )
    assert.match(markup, /width:16px;height:16px/, 'the rail size is honoured')
    assert.match(markup, /aria-hidden="true"/, 'the mark is decoration')
    assert.ok(!/<path d="/.test(markup), 'no glyph geometry lives in the bundle')
  }

  // The active state is the rail's own colour on the same mask, so the component
  // deliberately renders one mark rather than two.
  assert.equal(active, inactive, 'both states are the same masked artwork')
})

test('the Settings entry follows the switch without a reload', () => {
  // Publishing the switch back off is what a saved-off value looks like to a
  // subscriber: both contributions dispose, and the plugin page is untouched.
  assert.equal(report.toggled.sectionDisposed, true, 'the section disposer runs')
  assert.equal(report.toggled.iconDisposed, true, 'the icon disposer runs')
  assert.deepEqual(report.toggled.remaining, ['plugins.bundle.config'], 'only the plugin page stays registered')
})

test('every field group is rendered with its heading and hint', () => {
  for (const heading of [
    'SDK and toolchain',
    'Emulator and devices',
    'API level and system image',
    'Build',
    'Output and logs',
    'Interface',
  ]) {
    assert.ok(report.markup.includes(heading), `missing group heading: ${heading}`)
  }
})

test('a switch does not repeat its state as on/off text', () => {
  // The track already shows the state; a neighbouring label only says it twice.
  assert.ok(!/>on<\/span>/.test(report.markup), 'the track already shows the state')
  assert.ok(!/>off<\/span>/.test(report.markup))
})

test('the switch sits in a right-hand column, with its label and hint on the left', () => {
  // A switch reads as a settings row, like the host's own General page: the
  // title and description stay in the left text column, and the track is pinned
  // to the right edge by its own column. Keep this a structural assertion, not
  // one over the Switch primitive's internal DOM (which the primitives package
  // owns and may restyle), so a future restyle of the track cannot break it.
  const row = report.markup.match(/<div class="aemh_field aemh_fieldRow">([\s\S]*?)<\/div><\/div>/)
  assert.ok(row, 'the boolean field must use the row layout')
  const text = row[1]
  assert.match(text, /<div class="aemh_fieldRowText">/, 'the left column holds the text')
  assert.match(text, /<div class="aemh_fieldRowControl">/, 'the right column holds the control')
  assert.match(text, /Start an emulator automatically<\/label>/, 'the row still renders its label')
  assert.match(text, /When off, tools fail/, 'the row still renders its hint')
  assert.match(text, /role="switch"/, 'the switch is inside the row')
  // Left before right: the text column precedes the control column in DOM
  // order, which is what puts the switch on the right-hand edge of the card.
  assert.ok(text.indexOf('aemh_fieldRowText') < text.indexOf('aemh_fieldRowControl'))
  assert.ok(text.indexOf('aemh_fieldRowText') < text.indexOf('role="switch"'))

  // The two boolean fields (`autoStartEmulator` and `showInSettings`) are rows;
  // every text input, select and textarea keeps the full-width stacked frame so
  // a 100%-wide control still reads naturally under its label.
  assert.equal((report.markup.match(/aemh_fieldRow"/g) ?? []).length, 2, 'two switch rows')
  assert.ok(
    (report.markup.match(/<div class="aemh_field">/g) ?? []).length >= 16,
    'the other sixteen fields keep the stacked frame',
  )
})

test('every dropdown shares one chevron, including the SDK suggestion inputs', () => {
  // Three kinds of control offer a list: the two fixed selects, the
  // discovery AVD dropdown and the four suggestion-backed text inputs. They
  // all render through one wrapper, so the SDK group's datalist inputs can
  // no longer look different from the selects in the other groups.
  const wrappers = report.markup.match(/<span class="aemh_selectWrap">/g) ?? []
  const chevrons = report.markup.match(/<svg class="aemh_chevron"/g) ?? []
  assert.equal(wrappers.length, 7, 'two selects, one discovery dropdown, four suggestion inputs')
  assert.equal(chevrons.length, wrappers.length, 'one chevron per framed control')
  assert.match(report.markup, /<path d="M4 6l4 4 4-4"><\/path>/, 'the chevron is a stroked inline SVG path')

  // The four suggestion fields keep their free-text input and datalist, but
  // now carry the same chevron. Before discovery answers their option lists
  // are empty, so the arrow must follow the declared `suggest` source rather
  // than the live suggestion count.
  assert.equal((report.markup.match(/aemh_hasSuggest/g) ?? []).length, 4)
  assert.equal((report.markup.match(/<datalist/g) ?? []).length, 4)
  for (const label of ['JDK major version', 'Build-tools version', 'Android API level', 'Default device serial']) {
    const field = fieldMarkup(report.markup, label)
    assert.ok(field, `missing field frame for ${label}`)
    assert.match(field, /aemh_hasSuggest/, `${label} keeps its suggestion input`)
    assert.match(field, /<svg class="aemh_chevron"/, `${label} shows the shared chevron`)
    assert.match(field, /<datalist/, `${label} still owns a datalist`)
  }
})

/** The markup of one labelled field, cut at the next field's frame. */
function fieldMarkup(markup, label) {
  const at = markup.indexOf(label)
  if (at < 0) return ''
  const start = markup.lastIndexOf('<div class="aemh_field', at)
  const end = markup.indexOf('<div class="aemh_field', at + label.length)
  return end < 0 ? markup.slice(start) : markup.slice(start, end)
}

test('the controls carry the values the host serves, not placeholders', () => {
  // A controlled input renders its live value; the checked switch proves the
  // boolean path; the selected option proves the enum path is not blank.
  assert.match(report.markup, /value="35"/)
  assert.match(report.markup, /value="17"/)
  assert.match(report.markup, /role="switch" aria-checked="true"/)
  assert.match(report.markup, /<option value="default" selected="">/)
  assert.match(report.markup, /Automatic \(from the host\)/)
})

test('the diagnostics and discovery controls are present', () => {
  assert.match(report.markup, /Run diagnostic/)
  assert.match(report.markup, /Refresh devices and AVDs/)
  assert.match(report.markup, /Diagnostics and discovery/)
})

test('the default AVD is a dropdown, and the saved value is one of its options', () => {
  // The field is a `discovery` kind: a real `<select>` fed by the discovery
  // route, not a text box with a datalist. Before discovery has answered, the
  // only option is the value the host serves — and it must render as selected
  // rather than as a blank control that would commit an empty value on save.
  assert.match(
    report.markup,
    /<option value="medium_phone" selected="">medium_phone<\/option>/,
    'the saved AVD must be a selected option of the dropdown',
  )
})

test('an overridden value shows the badge and its reset control', () => {
  // The fake host stores a user override for one field, so the shared form
  // marks it and offers the reset. Both are harness behaviour, but the page is
  // what has to place them inside the field frame.
  assert.match(report.markup, />Overridden</)
  assert.match(report.markup, />Reset to default</)
})

test('the page binds only the namespace it owns', () => {
  // The fake host records what it was asked for; answering any namespace made
  // the old render test blind to a page bound to the package name or a typo.
  assert.deepEqual(report.registered.namespaceCalls, ['android-emulator-helper'])
  for (const namespaces of report.registered.servedNamespaces) {
    assert.deepEqual(namespaces, ['android-emulator-helper'])
  }
  assert.equal(report.registered.boundNamespace, 'settings.androidEmulatorHelper')
  assert.deepEqual(report.registered.dictionaryNamespaces, ['settings.androidEmulatorHelper'])
})

test('a host that does not serve the namespace renders no form at all', () => {
  // The registration hangs off `whileServed`, so a deployment without the host
  // half must not leave a slot entry behind — and it cannot reach a Settings
  // entry either.
  assert.equal(report.unserved.component, false, 'no component when the namespace is not served')
  assert.deepEqual(report.unserved.slots, [], 'no slot may be injected when the namespace is not served')
})

test('the staged and non-ready states render their own copy, not raw keys', () => {
  assert.match(report.invalidMarkup, /Enter a positive whole number/)
  assert.match(report.invalidMarkup, /One value is invalid; fix it before saving/)
  assert.match(report.zeroMarkup, /Enter a positive whole number/)
  assert.match(report.dirtyMarkup, /Unsaved changes/)
  assert.match(report.dirtyMarkup, />Save</)
  // A draft whose parsed value equals the served one but whose text differs is
  // still a staged write in the shared model; hiding the bar would strand it.
  assert.match(report.noopishMarkup, /Unsaved changes/)
  assert.match(report.noopishMarkup, />Save</)
  assert.match(report.readOnlyMarkup, /stores settings read-only/)
  assert.match(report.unavailableMarkup, /not served, so it cannot be configured right now/)
  for (const markup of [report.invalidMarkup, report.dirtyMarkup, report.readOnlyMarkup, report.unavailableMarkup]) {
    assert.ok(!/field\.[A-Za-z]+/.test(markup), 'an unresolved field key leaked into the markup')
    assert.ok(!/group\.[A-Za-z]+/.test(markup), 'an unresolved group key leaked into the markup')
    assert.ok(!/\bwriteFailed\b|\bwriteBlocked\b|\bstatusFailed\b/.test(markup), 'a fixed dictionary key leaked')
  }
})

test('the form draws no title of its own; the host page owns the chrome', () => {
  // The page draws the plugin's title, icon, crumb and description above this
  // section — and the Settings shell draws the section's own chrome — so the
  // form repeats none of it: it contributes an effect note and the cards.
  assert.ok(!report.markup.includes('Android Emulator Helper'), 'the form must not repeat the plugin title')
  assert.ok(!/<h[12]\b/.test(report.markup), 'the form must start at section headings')
  assert.match(report.markup, /Changes are saved to this profile and take effect on the next tool call\./)
  assert.equal((report.markup.match(/aemh_group"/g) ?? []).length >= 7, true, 'six field cards plus the tools card')
})

test('the action bar stays out of the form while nothing is staged', () => {
  // The bar is the only place a save starts and it appears only when it has
  // something to act on — a staged edit, a write in flight, or a failure. A
  // clean form must render neither it nor its labels.
  assert.ok(!report.markup.includes('aemh_actions'), 'a clean form must not render the action bar')
  assert.ok(!/>Save</.test(report.markup), 'a clean form must not offer a save')
  assert.ok(!/>Discard changes</.test(report.markup), 'a clean form must not offer a discard')
})

test('no unresolved dictionary key leaks into the markup', () => {
  // `ctx.locale.bind` returns the key itself for a missing entry, which is what
  // a typo in one of the generated keys would look like.
  assert.ok(!/field\.[A-Za-z]+/.test(report.markup), 'an unresolved field key leaked into the markup')
  assert.ok(!/group\.[A-Za-z]+/.test(report.markup), 'an unresolved group key leaked into the markup')
  assert.ok(!/field\.[A-Za-z]+/.test(report.settingsMarkup), 'an unresolved field key leaked into the Settings section')
  assert.ok(!/group\.[A-Za-z]+/.test(report.settingsMarkup), 'an unresolved group key leaked into the Settings section')
})

/**
 * The two states the markup assertions above cannot see.
 *
 * `render-page.mjs` doubles the primitives faithfully, which is what a page has
 * to render against. These mounts need the opposite: a shared model carrying only
 * the documented API (the shipped class keeps its helpers private), and a model
 * that cannot be built at all.
 */

/** The shared form scope the page binds to; the client reads only its public snapshot. */
function fakeScope() {
  const snapshot = { status: 'ready', value: {}, base: {}, user: {}, writable: true, revision: 1 }
  return { getSnapshot: () => snapshot, subscribe: () => () => {}, mutate: async () => true }
}

/**
 * A `SettingsFormModel` carrying only the documented API.
 *
 * The shipped class declares `stored` and `sectionValue` private, so this double
 * is what a primitives release that renamed them would look like — and the page
 * used to read them anyway, through an `unknown` assertion the type gate cannot
 * follow.
 */
class PublicOnlyModel {
  constructor(scope, specs) {
    this.scope = scope
    this.specs = specs
  }

  bind(project) {
    const snapshot = project()
    return { getSnapshot: () => snapshot, subscribe: () => () => {} }
  }

  shell() {
    return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }
  }

  field(key) {
    void key
    return { text: '', overridden: false, invalid: false }
  }

  actions() {
    return { edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {} }
  }

  dispose() {}
}

/** A primitives module whose shared model cannot be constructed at all. */
class ThrowingModel {
  constructor() {
    throw new Error('the shared model changed')
  }
}

/** The text-field spec the client's `text` kind asks the primitives for. */
function settingsTextField(field) {
  return {
    field,
    format: (value) => (typeof value === 'string' ? value : ''),
    parse: (text) => (text.trim() === '' ? { kind: 'clear' } : { kind: 'set', value: text.trim() }),
  }
}

/**
 * Mount the real `apply` over a browser context that records its registrations.
 *
 * Every service is the minimum the half touches; the shared model comes from
 * `primitives`, which is what the test varies. The registrations are held as a
 * list because a mount makes more than one once the optional Settings entry is
 * enabled, so the plugin-page entry is looked up by its slot name.
 */
function mountWith(primitives) {
  const record = { registrations: [], pluginPage: undefined, warnings: [], applyError: undefined }
  const { exported } = loadBundle({
    resolve: (specifier) => {
      if (specifier === 'react') return React
      if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
      throw new Error('unexpected require: ' + specifier)
    },
  })
  const scope = fakeScope()
  const ctx = {
    configForms: {
      get: () => scope,
      whileServed: (namespaces, register) => {
        const disposer = register(new Set(namespaces))
        return typeof disposer === 'function' ? disposer : () => {}
      },
    },
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: {
      inject: (name, callback) => {
        void name
        return callback()
      },
      register: (entry, component) => {
        record.registrations.push({ entry, component })
        return () => {}
      },
    },
    effect: (callback) => {
      const disposer = callback()
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
    logger: { warn: (message) => record.warnings.push(message) },
  }
  try {
    exported.apply(ctx)
  } catch (error) {
    record.applyError = error
  }
  record.pluginPage = record.registrations.find((registration) => registration.entry.name === 'plugins.bundle.config')
  return record
}

test('the override state comes from the public snapshot, not the model internals', () => {
  // `stored`/`sectionValue` are private: the type gate cannot see a call to them
  // (the old code asserted the model into a local shape) and a primitives release
  // may rename them. A model without them must still produce a working page.
  const record = mountWith({ SettingsFormModel: PublicOnlyModel, settingsTextField })
  assert.equal(record.applyError, undefined, 'apply must survive a model with only the public API')
  assert.ok(record.pluginPage !== undefined, 'the page must still be registered')
  const face = record.pluginPage.entry.inject()
  assert.deepEqual(Object.keys(face).sort(), [
    'discard',
    'edit',
    'hooks',
    'loadInventory',
    'loadStatus',
    'resetField',
    'save',
  ])
  const projection = face.hooks.androidEmulatorSettings.getSnapshot()
  assert.equal(Object.keys(projection.fields).length, 18, 'the projection carries every declared field')
})

test('a model that cannot be built leaves a readable page instead of no page', () => {
  // The constructor takes the first projection, so it is the one step a
  // primitives release can break. Failing it must not take the client half — and
  // with it the whole plugin page — down.
  const record = mountWith({ SettingsFormModel: ThrowingModel })
  assert.equal(record.applyError, undefined, 'apply must not throw when the shared model cannot be built')
  assert.equal(record.warnings.length, 1, 'the failure is logged')
  assert.ok(record.pluginPage !== undefined, 'a page must still be registered')
  assert.deepEqual(Object.keys(record.pluginPage.entry.inject()), ['hooks'], 'the failed page injects no form face')
  const t = (key) => (key === 'formFailed' ? 'FORM FAILED' : key)
  const markup = renderToStaticMarkup(React.createElement(record.pluginPage.component, { t, view: 'page' }))
  assert.match(markup, /FORM FAILED/, 'the page says the form could not be loaded')
})

test('the save confirmation only flashes for a write this page saw land', () => {
  // `savedCount` is cumulative for the controller's life while the toast lives
  // with the page, so a page mounted after an earlier save must not repeat that
  // save's confirmation; only growth is a write to announce.
  const { exported } = loadBundle()
  const flash = exported.SAVED_TOAST_TICK
  assert.equal(typeof flash, 'function', 'the bundle must export the toast rule')
  assert.equal(flash(1, 1), 0, 'mounting after a save is not a new save')
  assert.equal(flash(3, 3), 0)
  assert.equal(flash(0, 1), 1, 'the first write lands')
  assert.equal(flash(1, 2), 2, 'a write that lands while the page is open flashes')
  assert.equal(flash(2, 1), 0, 'a counter that went backwards flashes nothing')
})
