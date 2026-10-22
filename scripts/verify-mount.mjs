#!/usr/bin/env node
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import * as plugin from '../lib/index.js'

/** Repository root, so the scratch data directory is anchored to the project. */
const ROOT = path.dirname(fileURLToPath(new URL('.', import.meta.url)))

/**
 * Mount the plugin on a REAL Cordis context with the REAL tool registry, then
 * dispatch through it.
 *
 * The unit tests use a hand-written context stand-in, which pins the plugin's
 * own behaviour but not the harness contract. This harness closes that gap: the
 * registry validates the argument and result schemas for real, the fiber owns
 * `tools.register`, and disposal is exercised through the actual lifecycle.
 *
 * Run with `pnpm run verify:mount`.
 */

let failures = 0

/** Report one assertion. */
function check(label, ok, detail) {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`)
}

const ctx = new Context()

// ToolRuntime injects `systemPrompt` and mounts its schema provider into it, so
// the stand-in must accept `tools(provider)` and `section(...)` and be able to
// render. It records what the registry publishes, which is also how this
// harness reads the registered names back.
const published = { schemaProviders: [], sections: [] }
ctx.provide('systemPrompt', {
  tools(provider) {
    published.schemaProviders.push(provider)
    return () => {}
  },
  section(section) {
    published.sections.push(section)
    return () => {}
  },
  async render() {
    return ''
  },
})

const runtimeFiber = ctx.plugin(ToolRuntime, { mode: 'native' })
await runtimeFiber
check('the real ToolRuntime mounted', ctx.get('tools') !== undefined)

// `ctx.plugin` re-validates against Config, so hand it the RAW config (a
// pre-parsed volatile object would fail validation).
//
// Two settings are pinned so the verdict does not depend on the machine:
//
// - `dataDir` into the workspace. The default is `$DSH_HOME/android-emulator-helper`,
//   so any provider that writes a build or emulator log would reach outside the
//   project. That made this gate report failures that were really the
//   environment's — a sandbox denying `~/.dsh`, or a home directory that is not
//   writable — and a gate whose verdict changes with the sandbox is worse than
//   no gate.
// - `autoStartEmulator` off. Two tools reach `ensureDevice` with no target and
//   would otherwise boot a real GUI emulator, making a `pnpm test`-adjacent gate
//   both slow and non-deterministic. Proving that a boot works is `smoke.mjs`'s
//   job, on a machine that has an SDK; here the tools are expected to fail
//   inside their provider, which is exactly what the checks below assert.
const scratch = path.join(ROOT, '.tmp-verify-mount-data')
const pluginFiber = ctx.plugin(plugin, { dataDir: scratch, autoStartEmulator: false })
await pluginFiber

const tools = ctx.get('tools')
/** Ask the registry which tool names it publishes, through the real provider path. */
const toolNames = () =>
  published.schemaProviders
    .flatMap((provider) => provider({ scope: undefined })?.schemas ?? [])
    .map((schema) => schema.name)
const visible = toolNames().filter((name) => name.startsWith('android_'))
check('23 android_* tools are registered in the real registry', visible.length === 23, visible.length)

// Every compiled definition must declare an object result schema. A tool whose
// schema is missing or malformed would otherwise only surface on the call that
// happens to succeed, which is exactly what this hermetic gate cannot produce
// for the device-backed tools.
const schemaProblems = []
for (const name of visible) {
  const definition = tools.get(name)
  const schema = definition?.output?.schema
  if (typeof schema !== 'object' || schema === null) {
    schemaProblems.push(`${name}: no result schema`)
    continue
  }
  const violations = validateJsonSchemaValue(schema, {}, 'value')
  if (violations.length > 0) schemaProblems.push(`${name}: ${violations.join('; ')}`)
}
check(
  'every tool declares an object result schema the registry can validate',
  schemaProblems.length === 0,
  schemaProblems.slice(0, 3),
)

// ── dispatch through the real registry ───────────────────────────────────────
// A caller signal is part of the execution contract; the loop always supplies one.
const signal = new AbortController().signal

// The registry validates each body's value against its declared result schema,
// which is how a mismatch between a provider's shape and a tool's schema is
// caught. These five need neither a device nor a project, so they run always:
// each one must reach its provider, come back without an isError, and render as
// model-visible JSON.
let call = 0
for (const name of [
  'android_preflight',
  'android_list_avds',
  'android_list_devices',
  'android_discover_project',
  'android_ui_status',
]) {
  const result = await tools.execute({ name, arguments: {}, callId: `verify-${++call}`, signal })
  check(`${name} dispatched through the real registry`, result.isError !== true, result.error?.message?.slice(0, 90))
  const payload = result.content?.find((block) => block.type === 'text')?.text ?? ''
  check(`${name} rendered model-visible JSON`, payload.trimStart().startsWith('{'), payload.slice(0, 50))
}

// Every remaining tool must at least survive the registry's argument validation
// and its result schema. Without a device they are expected to fail *inside*
// their provider (no ready target), which still proves the wiring: a schema or
// renderer mismatch would surface as a different, distinctive error. Passing a
// serial that cannot exist keeps the run deterministic and stops it touching a
// real device; the explicit timeouts keep a poll loop from stalling the gate.
const ABSENT = 'emulator-__none__'
const DEVICE_TOOLS = [
  ['android_start_emulator', { avd: '__verify_mount_no_such_avd__', timeoutMs: 5_000 }],
  ['android_stop_emulator', { serial: ABSENT }],
  ['android_create_avd', { name: '__verify_mount_no_such_avd__', packageId: 'system-images;android-99;default;arm64-v8a' }],
  ['android_create_app', { name: 'VerifyMountProbe', dir: '.tmp-verify-mount', overwrite: true }],
  ['android_build_app', { timeoutMs: 10_000 }],
  ['android_build_and_run', { timeoutMs: 10_000 }],
  ['android_install_app', { serial: ABSENT, apkPath: '/nonexistent/verify-mount.apk' }],
  ['android_launch_app', { serial: ABSENT, applicationId: 'com.example.verify' }],
  ['android_terminate_app', { serial: ABSENT, applicationId: 'com.example.verify' }],
  ['android_open_url', { serial: ABSENT, url: 'https://example.com' }],
  ['android_screenshot', { serial: ABSENT }],
  ['android_logs', { serial: ABSENT }],
  ['android_ui_describe', { serial: ABSENT, timeoutMs: 5_000 }],
  ['android_ui_resolve', { serial: ABSENT, query: 'Settings', timeoutMs: 5_000 }],
  ['android_ui_tap', { serial: ABSENT, x: 1, y: 1, timeoutMs: 5_000 }],
  ['android_ui_swipe', { serial: ABSENT, x1: 1, y1: 1, x2: 2, y2: 2, timeoutMs: 5_000 }],
  ['android_ui_type_text', { serial: ABSENT, text: 'x', timeoutMs: 5_000 }],
  ['android_ui_keyevent', { serial: ABSENT, key: 'BACK', timeoutMs: 5_000 }],
]
for (const [name, args] of DEVICE_TOOLS) {
  const result = await tools.execute({ name, arguments: args, callId: `verify-${++call}`, signal })
  // A provider-level refusal is the expected outcome; a registry-level schema
  // rejection is not. The registry's result-schema error message is "returned
  // invalid output", and an argument error is "invalid arguments"; both must
  // fail this check instead of being read as "reached the provider".
  const text = result.content?.find((block) => block.type === 'text')?.text ?? ''
  const schemaRejection = /invalid arguments|invalid result|returned invalid output|INVALID_TOOL_OUTPUT/i.test(
    result.error?.message ?? '',
  )
  check(
    `${name} reached its provider without a schema rejection`,
    !schemaRejection,
    `isError=${result.isError === true} ${(result.error?.message ?? text).slice(0, 80)}`,
  )
}

// Argument validation is the registry's, not ours: a wrong type must be refused
// before the body runs.
const badArgs = await tools.execute({
  name: 'android_ui_tap',
  arguments: { x: 'not-a-number', y: 1 },
  callId: 'verify-2',
  signal,
})
check('a malformed argument is refused by the registry', badArgs.isError === true, badArgs.error?.message?.slice(0, 80))

// A name the plugin never registered must not resolve.
const unknown = await tools.execute({ name: 'android_not_a_tool', arguments: {}, callId: 'verify-3', signal })
check('an unknown tool name does not resolve', unknown.isError === true, unknown.error?.code)

// ── the settings namespace the browser half waits for ────────────────────────
const schema = plugin.Config.toJSON()
const root = schema.refs[schema.uid]
const volatileFields = Object.values(root.dict).filter((ref) => schema.refs[ref].meta.volatile === true)
check('every settings field is volatile (so the settings form can serve it)', volatileFields.length === 17, volatileFields.length)

// ── disposal removes the tools again ─────────────────────────────────────────
await pluginFiber.dispose()
const afterDispose = toolNames().filter((name) => name.startsWith('android_'))
check('disposing the plugin fiber unregisters every tool', afterDispose.length === 0, afterDispose.length)

await runtimeFiber.dispose()

rmSync(scratch, { recursive: true, force: true })
// `android_create_app` generates a real project into the repository; a gate that
// leaves it behind turns a run artifact into something every later command has
// to ignore.
rmSync(path.join(ROOT, '.tmp-verify-mount'), { recursive: true, force: true })

console.log(failures === 0 ? '\nverify-mount: OK' : `\nverify-mount: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
