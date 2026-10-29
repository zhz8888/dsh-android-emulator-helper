import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { apply, Config, inject, name, renderCommandReport, splitFrontmatter } from '../lib/index.js'
import { FIELD_KEYS } from '../lib/settings.js'

/**
 * Host-half integration tests over a fake Cordis context.
 *
 * The fake implements only what the plugin actually touches — `tools`,
 * `effect`, `inject`, `get`, `logger` — which is the point: it pins the exact
 * service surface the plugin depends on, so a future refactor that reaches for
 * something else fails here rather than inside a booted profile.
 */

/** The original plugin's 23 tool names, in registration order. */
const EXPECTED_TOOLS = [
  'android_preflight',
  'android_discover_project',
  'android_create_app',
  'android_build_app',
  'android_build_and_run',
  'android_list_devices',
  'android_list_avds',
  'android_start_emulator',
  'android_stop_emulator',
  'android_create_avd',
  'android_install_app',
  'android_launch_app',
  'android_terminate_app',
  'android_open_url',
  'android_screenshot',
  'android_logs',
  'android_ui_status',
  'android_ui_describe',
  'android_ui_resolve',
  'android_ui_tap',
  'android_ui_swipe',
  'android_ui_type_text',
  'android_ui_keyevent',
]

/**
 * Build a Context stand-in that records everything the plugin registers.
 *
 * @param {{services?: Record<string, unknown>, omit?: string[]}} [options] - extra services to publish, and optional services to withhold.
 * @returns {object} the fake context and its recordings.
 */
function fakeContext(options = {}) {
  const record = { tools: [], skills: [], commands: [], routes: [], effects: [], warnings: [], disposals: [] }
  const services = {
    tools: {
      register(definition) {
        record.tools.push(definition)
        return () => {
          record.disposals.push(`tool:${definition.name}`)
        }
      },
    },
    skills: {
      register(skill) {
        record.skills.push(skill)
        return () => {
          record.disposals.push(`skill:${skill.name}`)
        }
      },
    },
    commands: {
      register(command) {
        record.commands.push(command)
        return () => {
          record.disposals.push(`command:${command.name}`)
        }
      },
    },
    connection: {
      fetch: {
        register(route) {
          record.routes.push(route)
          return () => {
            record.disposals.push(`route:${route.path}`)
          }
        },
      },
    },
    ...options.services,
  }
  for (const key of options.omit ?? []) delete services[key]
  const ctx = {
    // Cordis exposes every registered service both through `ctx.get(name)` and
    // as a `ctx.<name>` property; the plugin uses both forms.
    ...services,
    // The settings policy is registered against the plugin's fiber so it is
    // disposed with the entry; the stand-in only has to be identity-stable.
    fiber: { id: 'test-fiber' },
    logger: {
      info() {},
      warn: (...args) => record.warnings.push(args.join(' ')),
      error: (...args) => record.warnings.push(args.join(' ')),
    },
    get: (key) => services[key],
    effect(callback) {
      const disposer = callback()
      record.effects.push(disposer)
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
    inject(names, callback) {
      // The plugin only injects optional services, and the fake always has them,
      // so the callback runs synchronously exactly as Cordis runs it on resolve.
      const available = names.every((serviceName) => services[serviceName] !== undefined)
      if (available) callback(ctx)
      return () => {}
    },
  }
  return { ctx, record }
}

/** A config object shaped like Cordis' live entry config. */
function configWith(values = {}) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { get: () => value }]))
}

test('the plugin declares its Cordis identity and required service', () => {
  assert.equal(name, 'android-emulator-helper')
  assert.deepEqual(inject, ['tools'])
  assert.equal(typeof Config.toJSON, 'function')
})

test('apply registers every tool from the original MCP server, under the same names', () => {
  const { ctx, record } = fakeContext()
  apply(ctx, configWith())
  assert.deepEqual(
    record.tools.map((tool) => tool.name),
    EXPECTED_TOOLS,
  )
})

test('each tool declares a valid argument schema and a renderer', () => {
  const { ctx, record } = fakeContext()
  apply(ctx, configWith())
  for (const tool of record.tools) {
    assert.equal(tool.parameters.type, 'object', `${tool.name} parameters must be an object schema`)
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.description.length > 20, `${tool.name} needs a useful description`)
    assert.equal(tool.output.schema.type, 'object', `${tool.name} result must be an object`)
    assert.equal(typeof tool.output.render, 'function', `${tool.name} needs an output renderer`)
    assert.equal(typeof tool.execute, 'function', `${tool.name} needs a body`)
  }
})

test('argument schemas carry the shared target fields where the original had them', () => {
  const { ctx, record } = fakeContext()
  apply(ctx, configWith())
  const byName = new Map(record.tools.map((tool) => [tool.name, tool]))
  for (const toolName of ['android_build_app', 'android_logs', 'android_ui_tap', 'android_install_app']) {
    const properties = byName.get(toolName).parameters.properties
    assert.ok(properties.serial, `${toolName} must accept serial`)
    assert.ok(properties.avd, `${toolName} must accept avd`)
    assert.ok(properties.timeoutMs, `${toolName} must accept timeoutMs`)
  }
  assert.deepEqual(byName.get('android_start_emulator').parameters.required, undefined)
  assert.deepEqual(byName.get('android_stop_emulator').parameters.required, ['serial'])
  assert.deepEqual(byName.get('android_ui_keyevent').parameters.properties.key.enum, [
    'BACK',
    'HOME',
    'ENTER',
    'APP_SWITCH',
    'MENU',
    'SEARCH',
  ])
})

test('the tool result renderer renders values without leaking undefined', () => {
  const { ctx, record } = fakeContext()
  apply(ctx, configWith())
  for (const tool of record.tools) {
    const blocks = tool.output.render({}, { ok: true, missing: undefined, count: 1 })
    assert.ok(Array.isArray(blocks) && blocks.length >= 1, `${tool.name} renderer must return blocks`)
    assert.equal(blocks[0].type, 'text')
    assert.match(blocks[0].text, /"ok": true/)
    assert.doesNotMatch(blocks[0].text, /undefined/, `${tool.name} must not render undefined`)
  }
})

test('a screenshot result adds an image block only when an attachment was admitted', () => {
  const { ctx, record } = fakeContext()
  apply(ctx, configWith())
  const screenshot = record.tools.find((tool) => tool.name === 'android_screenshot')
  const reference = { attachmentId: 'a', mediaType: 'image/png', bytes: 12, width: 1, height: 1 }
  const withImage = screenshot.output.render({}, { path: 'shot.png', attachment: reference })
  assert.deepEqual(withImage.map((block) => block.type), ['text', 'image'])
  assert.equal(withImage[1].attachment, reference)
  const withoutImage = screenshot.output.render({}, { path: 'shot.png', imageUnavailable: 'no attachment store' })
  assert.deepEqual(withoutImage.map((block) => block.type), ['text'])
})

test('apply registers the embedded skill with the package directory as its resource base', () => {
  const { ctx, record } = fakeContext()
  apply(ctx, configWith())
  assert.equal(record.skills.length, 1)
  const [skill] = record.skills
  assert.equal(skill.name, 'android-dev')
  assert.match(skill.description, /Android/)
  assert.match(skill.content, /android_preflight/)
  assert.equal(skill.resourceBase.kind, 'directory')
  // The separator is the platform's: the resource base is a real directory
  // path, not a URL, so a Windows host reports backslashes.
  assert.ok(
    skill.resourceBase.path.endsWith(path.join('skills', 'android-dev')),
    `expected the package's skill directory, got ${skill.resourceBase.path}`,
  )
})

test('apply registers the android-dev command', () => {
  const { ctx, record } = fakeContext()
  apply(ctx, configWith())
  assert.equal(record.commands.length, 1)
  assert.equal(record.commands[0].name, 'android-dev')
  assert.equal(typeof record.commands[0].handler, 'function')
})

test('apply registers exactly the two settings routes under /api', () => {
  const { ctx, record } = fakeContext()
  apply(ctx, configWith())
  assert.deepEqual(
    record.routes.map((route) => [route.path, route.methods]),
    [
      ['/api/android-emulator-helper/status', ['GET']],
      ['/api/android-emulator-helper/inventory', ['GET']],
    ],
  )
})

test('apply turns the settings service\'s automatic page generation off', () => {
  // Without this policy a deployment that renders pages from the schema shows a
  // second, generated form for the same entry beside the Plugins-page form.
  const calls = []
  const { ctx } = fakeContext({
    services: {
      settings: {
        configure(options, fiber) {
          calls.push({ options, fiber })
          return () => {}
        },
      },
    },
  })
  apply(ctx, configWith())
  assert.deepEqual(calls.map((call) => call.options), [{ auto: false }])
  assert.equal(calls[0]?.fiber, ctx.fiber, 'the policy must be tied to the plugin fiber')
})

test('a deployment without the optional connection service still loads and warns', () => {
  // `connection` is present but exposes no exact Fetch registry: that is the
  // one deployment shape where the plugin must boot and log a warning, and the
  // fake `inject` only runs the callback for services that exist.
  const { ctx, record } = fakeContext({ services: { connection: {} } })
  apply(ctx, configWith())
  assert.equal(record.tools.length, EXPECTED_TOOLS.length)
  assert.equal(record.routes.length, 0)
  assert.ok(
    record.warnings.some((message) => /exposes no exact Fetch route registry/.test(message)),
    'the missing route registry must be reported',
  )
})

test('apply registers every documented tool and the schema declares every field', () => {
  const { ctx, record } = fakeContext()
  apply(ctx, configWith({ apiLevel: '36' }))
  assert.equal(record.tools.length, EXPECTED_TOOLS.length)
  assert.deepEqual(
    record.tools.map((tool) => tool.name),
    EXPECTED_TOOLS,
  )
  // The live config is consumed per call by createRuntime; `runtime.test.js`
  // pins that projection. This test only pins that the schema the entry
  // validates has one node per documented field.
  const json = Config.toJSON()
  assert.equal(Object.keys(json.refs[json.uid].dict).length, FIELD_KEYS.length)
})

test('the /android-dev command report leads with the verdict and lists failures', () => {
  const report = renderCommandReport(
    {
      ok: false,
      settings: {},
      checks: [
        { name: 'Host OS', ok: true, detail: 'darwin arm64' },
        { name: 'Android SDK root', ok: false, detail: 'not found', fix: 'Install Android Studio.' },
      ],
    },
    'build the demo app',
  )
  assert.match(report, /not ready \(1 check\(s\) failed\)/)
  assert.match(report, /\[ok\]\s+Host OS/)
  assert.match(report, /\[FAIL\] Android SDK root/)
  assert.match(report, /Fix: Install Android Studio\./)
  assert.match(report, /build the demo app/)
  // The report's last line used to point at Settings → Android emulator; the
  // page now lives on the plugin's detail view in the Plugins panel.
  assert.match(report, /Environment values are edited on this plugin's page in the Plugins panel/)
  assert.match(report, /Plugins → Installed plugins → Android Emulator Helper/)
})

test('skill frontmatter parsing handles quoted values and a missing block', () => {
  const parsed = splitFrontmatter('---\nname: android-dev\ndescription: "A desc: with a colon"\n---\n# Body\n')
  assert.equal(parsed.front.name, 'android-dev')
  assert.equal(parsed.front.description, 'A desc: with a colon')
  assert.equal(parsed.body.trim(), '# Body')
  assert.deepEqual(splitFrontmatter('# No frontmatter\n'), { front: {}, body: '# No frontmatter\n' })
})

test('the bundled skill declares the fields the loader requires', async () => {
  const { readFileSync } = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  const raw = readFileSync(path.join(root, 'skills', 'android-dev', 'SKILL.md'), 'utf8')
  const { front, body } = splitFrontmatter(raw)
  assert.equal(front.name, 'android-dev')
  assert.ok(front.description.length > 10)
  assert.ok(front.whenToUse.length > 10)
  assert.match(body, /INSTALL_ENVIRONMENT\.md/)
  assert.ok(!/mcp__/.test(body), 'the DSH port must not refer to MCP-prefixed tool names')
})
