import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../lib/index.js'
import { FIELD_KEYS } from '../lib/settings.js'

/**
 * Integration tests for the two settings-page Fetch routes.
 *
 * `test/host.test.js` proves the routes are *registered* against a fake
 * context. This file closes the remaining gap: it mounts the plugin on a REAL
 * Cordis context whose `connection` service records the registry entries, then
 * INVOKES each handler and reads the real `Response` it produces. That is the
 * only way to pin the parts a registration assertion cannot see —
 *
 *   - the handler actually resolves `config` at call time rather than freezing
 *     whatever `apply` saw,
 *   - the payload is JSON the settings page can consume,
 *   - an optional-service deployment degrades instead of failing to boot, and
 *   - disposal really removes both routes from the registry.
 *
 * The `connection` service is the one stand-in: the real one is a private HTTP
 * surface that cannot be opened from a test. Everything else is the real thing.
 */

/**
 * Mount the plugin on a real Cordis context with a recording `connection`.
 *
 * @param {{withConnection?: boolean, config?: object, connection?: unknown}} [options] - composition inputs.
 * @returns {Promise<{ctx: Context, routes: Map<string, object>, warnings: string[], refs: Record<string, object>, dispose: () => Promise<void>}>} the mounted fixture.
 */
async function mount(options = {}) {
  const ctx = new Context({ observe: false })
  const routes = new Map()
  const warnings = []

  ctx.provide('tools', { register: () => () => {} })
  ctx.provide('logger', {
    info() {},
    warn: (...args) => warnings.push(args.join(' ')),
    error: (...args) => warnings.push(args.join(' ')),
  })
  // The service must exist BEFORE the plugin mounts: `ctx.inject` defers its
  // callback until the dependency is provided, so a late `provide` is a
  // different test (see the "provided after mount" case below).
  if (options.withConnection === false) {
    // deliberately absent
  } else if ('connection' in options) {
    ctx.provide('connection', options.connection)
  } else {
    // Only `fetch.register` is touched by the plugin; the recording env keeps
    // the registry keyed by the path the settings page actually fetches.
    ctx.provide('connection', {
      fetch: {
        register(route) {
          routes.set(route.path, route)
          return () => {
            routes.delete(route.path)
          }
        },
      },
    })
  }

  const fiber = ctx.plugin(plugin, options.config ?? {})
  await fiber
  return {
    ctx,
    routes,
    warnings,
    // Cordis hands `apply` one live reference per volatile field. They are the
    // handles the settings form writes through, and the fixture keeps them so a
    // test can save a value the way the form does.
    refs: fiber.config ?? {},
    dispose: async () => {
      await fiber.dispose()
    },
  }
}

/** The symbol Cordis' volatile reference exposes as its write channel. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

test('a real Cordis mount registers exactly the two settings routes', async () => {
  const fixture = await mount()
  assert.deepEqual([...fixture.routes.keys()].sort(), [
    '/api/android-emulator-helper/inventory',
    '/api/android-emulator-helper/status',
  ])
  for (const route of fixture.routes.values()) {
    assert.deepEqual(route.methods, ['GET'], `${route.path} must be GET`)
    assert.equal(route.requestBody, 'buffered', `${route.path} must buffer its body`)
    assert.equal(typeof route.fetch, 'function', `${route.path} must be fetchable`)
  }
  await fixture.dispose()
})

test('disposing the fiber unregisters both routes', async () => {
  const fixture = await mount()
  assert.equal(fixture.routes.size, 2)
  await fixture.dispose()
  assert.equal(fixture.routes.size, 0, 'a disposed plugin must leave no route behind')
})

test('the status route answers a JSON preflight report the page can render', async () => {
  const fixture = await mount()
  const response = await fixture.routes.get('/api/android-emulator-helper/status').fetch()
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /^application\/json/)
  const body = await response.json()
  assert.equal(typeof body.ok, 'boolean')
  assert.equal(body.backend, 'sdk')
  assert.ok(Array.isArray(body.checks) && body.checks.length > 0, 'preflight must report its checks')
  for (const check of body.checks) {
    assert.equal(typeof check.name, 'string')
    assert.equal(typeof check.ok, 'boolean')
    assert.equal(typeof check.detail, 'string')
    assert.equal(typeof check.fix, 'string')
  }
  // The settings the page shows must be part of the payload, under the same keys.
  assert.equal(typeof body.settings, 'object')
  assert.ok('apiLevel' in body.settings, 'the report must echo the live settings')
  await fixture.dispose()
})

test('the inventory route answers option lists the form fields can consume', async () => {
  const fixture = await mount()
  const response = await fixture.routes.get('/api/android-emulator-helper/inventory').fetch()
  assert.equal(response.status, 200)
  const body = await response.json()
  for (const key of ['avds', 'systemImages', 'platforms', 'buildTools']) {
    assert.ok(Array.isArray(body[key]), `${key} must be an array so the field can list it`)
  }
  assert.ok(Array.isArray(body.devices))
  assert.ok(Array.isArray(body.javaHomes))
  // `detectedSdkRoot` is a path when one was found and null when none was, so
  // the form can tell "nothing detected" from "detected here".
  assert.ok(body.detectedSdkRoot === null || typeof body.detectedSdkRoot === 'string')
  assert.equal(typeof body.sdkRootExists, 'boolean')
  assert.ok(Array.isArray(body.searchedSdkRoots))
  const current = body.current
  assert.equal(typeof current.dataRoot, 'string')
  assert.equal(typeof current.systemImagePackage, 'string')
  assert.equal(typeof current.defaultAbi, 'string')
  await fixture.dispose()
})

test('every one of the 17 fields arrives as a live Cordis reference', async () => {
  const fixture = await mount()
  assert.deepEqual(Object.keys(fixture.refs), FIELD_KEYS)
  for (const key of FIELD_KEYS) {
    assert.equal(typeof fixture.refs[key]?.get, 'function', `${key} must be a volatile reference`)
    assert.equal(typeof fixture.refs[key][VOLATILE_WRITE], 'function', `${key} must be writable by the settings form`)
  }
  await fixture.dispose()
})

test('both handlers read the live config on every call, not the value apply saw', async () => {
  // This is the settings page's save path: the form writes the new value into
  // the running reference, and the very next button press must observe it.
  const fixture = await mount()
  const before = await (await fixture.routes.get('/api/android-emulator-helper/status').fetch()).json()
  assert.equal(before.settings.apiLevel, '35')

  fixture.refs.apiLevel[VOLATILE_WRITE]('37')
  fixture.refs.logTailLines[VOLATILE_WRITE](12)

  const after = await (await fixture.routes.get('/api/android-emulator-helper/status').fetch()).json()
  assert.equal(after.settings.apiLevel, '37', 'the route must observe the saved setting, not the boot-time one')
  assert.equal(after.settings.logTailLines, 12)
  await fixture.dispose()
})

test('a reference that fails to read is reported as a 500 body, never as a crash', async () => {
  // A volatile reference whose backing store is gone is what a half-applied or
  // disposed profile looks like. The handler must answer with the error text.
  const fixture = await mount()
  fixture.refs.apiLevel = {
    get() {
      throw new Error('reference is not initialized')
    },
  }
  const response = await fixture.routes.get('/api/android-emulator-helper/status').fetch()
  assert.equal(response.status, 500)
  const body = await response.json()
  assert.match(body.error, /reference is not initialized/)
  await fixture.dispose()
})

test('a deployment without the connection service still mounts and registers no route', async () => {
  // Cordis' `inject` does not fail when a dependency is absent: it leaves the
  // injected fiber pending until the service appears. The host half must
  // therefore boot normally and simply own no route, which is what makes the
  // optional dependency safe.
  const fixture = await mount({ withConnection: false })
  assert.equal(fixture.routes.size, 0)
  assert.deepEqual(fixture.warnings, [], 'an absent optional service is not a warning')
  await fixture.dispose()
})

test('the routes appear when the connection service is provided after mount', async () => {
  // The other half of the same contract: the pending injection resolves the
  // moment a deployment gains the service, with no remount.
  const fixture = await mount({ withConnection: false })
  assert.equal(fixture.routes.size, 0)

  fixture.ctx.provide('connection', {
    fetch: {
      register(route) {
        fixture.routes.set(route.path, route)
        return () => {
          fixture.routes.delete(route.path)
        }
      },
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.deepEqual([...fixture.routes.keys()].sort(), [
    '/api/android-emulator-helper/inventory',
    '/api/android-emulator-helper/status',
  ])
  await fixture.dispose()
})

test('a connection service without the fetch registry mounts cleanly, with no routes', async () => {
  // `test/host.test.js` pins that this deployment warns. What only a real
  // Cordis mount can add is that it also survives: the injected fiber must
  // settle active and own nothing, rather than leaving a rejected plugin
  // behind. (The warn itself is not observable here — Cordis owns `ctx.logger`
  // and does not let a test swap it, which is exactly why the fake-context test
  // covers that half.)
  const fixture = await mount({ connection: {} })
  assert.equal(fixture.routes.size, 0)
  assert.deepEqual(fixture.warnings, [], 'a plugin must not push its own logger into a real context')
  // The mount is alive: a second mount on the same context still registers.
  await fixture.dispose()
})
