#!/usr/bin/env node
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as plugin from '../lib/index.js'

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
const pluginFiber = ctx.plugin(plugin, {})
await pluginFiber

const tools = ctx.get('tools')
/** Ask the registry which tool names it publishes, through the real provider path. */
const toolNames = () =>
  published.schemaProviders
    .flatMap((provider) => provider({ scope: undefined })?.schemas ?? [])
    .map((schema) => schema.name)
const visible = toolNames().filter((name) => name.startsWith('android_'))
check('23 android_* tools are registered in the real registry', visible.length === 23, visible.length)

// ── dispatch through the real registry ───────────────────────────────────────
// A caller signal is part of the execution contract; the loop always supplies one.
const signal = new AbortController().signal

// The registry validates each body's value against its declared result schema,
// which is how a mismatch between a provider's shape and a tool's schema is
// caught. These four need no device and no project, so they always run.
let call = 0
for (const name of [
  'android_preflight',
  'android_list_avds',
  'android_list_devices',
  'android_discover_project',
]) {
  const result = await tools.execute({ name, arguments: {}, callId: `verify-${++call}`, signal })
  check(`${name} dispatched through the real registry`, result.isError !== true, result.error?.message?.slice(0, 90))
  const payload = result.content?.find((block) => block.type === 'text')?.text ?? ''
  check(`${name} rendered model-visible JSON`, payload.trimStart().startsWith('{'), payload.slice(0, 50))
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

console.log(failures === 0 ? '\nverify-mount: OK' : `\nverify-mount: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
