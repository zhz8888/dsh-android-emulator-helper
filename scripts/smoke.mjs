#!/usr/bin/env node
import process from 'node:process'
import { createRuntime } from '../lib/runtime.js'
import { inventory, preflight } from '../lib/providers/preflight.js'
import { listAvds } from '../lib/providers/avd.js'
import { listDevices } from '../lib/providers/device.js'
import { discover } from '../lib/providers/project.js'

/**
 * Integration smoke test: run the ported providers against the real machine.
 *
 * The unit tests cover the parsers; this script covers everything that only a
 * real Android SDK can prove — SDK discovery, `adb`/`emulator` invocation,
 * environment assembly, and the settings projection feeding them. It is not
 * part of `pnpm test`, because it needs an Android SDK and takes seconds.
 *
 *   node scripts/smoke.mjs                 # read-only probes
 *   node scripts/smoke.mjs --with-emulator # also boot an AVD and capture a screen
 */

const withEmulator = process.argv.includes('--with-emulator')
const config = {}

/** Run one named step, printing its result and continuing on failure. */
async function step(name, run) {
  process.stdout.write(`\n=== ${name} ===\n`)
  try {
    const value = await run()
    console.log(JSON.stringify(value, null, 2))
    return { ok: true, value }
  } catch (error) {
    console.log(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
    return { ok: false, error }
  }
}

const runtime = createRuntime({ config, exec: undefined, logger: console })
console.log(`session workspace: ${runtime.cwd}`)
console.log(`data root:         ${runtime.dataRoot}`)

const preflightResult = await step('android_preflight', () => preflight(runtime))
await step('android_list_avds', () => listAvds(runtime))
await step('android_list_devices', () => listDevices(runtime))
await step('android_discover_project', () => discover(runtime, runtime.cwd))
await step('settings inventory (settings-page route)', () => inventory(runtime))

if (withEmulator) {
  const { startEmulator } = await import('../lib/providers/avd.js')
  const started = await step('android_start_emulator', () => startEmulator(runtime, {}))
  if (started.ok) {
    const { shot } = await import('../lib/providers/screenshot.js')
    await step('android_screenshot', async () => {
      const capture = await shot(runtime, {})
      return { device: capture.device.serial, path: capture.path, bytes: capture.bytes }
    })
    const { logs } = await import('../lib/providers/logs.js')
    await step('android_logs', async () => {
      const result = await logs(runtime, { lines: 20 })
      return { lines: result.lines, characters: result.output.length }
    })
    const { stopEmulator } = await import('../lib/providers/avd.js')
    await step('android_stop_emulator', () => stopEmulator(runtime, { serial: started.value.serial }))
  }
}

const ok = preflightResult.ok
console.log(`\npreflight verdict: ${ok ? 'ready' : 'not ready'}`)
console.log('Checks that need a physical device or an AVD stay red until one is running.')
process.exit(0)
