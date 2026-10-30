#!/usr/bin/env node
import { rmSync } from 'node:fs'
import path from 'node:path'
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
let failures = 0

/** Run one named step, printing its result and continuing on failure. */
async function step(name, run) {
  process.stdout.write(`\n=== ${name} ===\n`)
  try {
    const value = await run()
    console.log(JSON.stringify(value, null, 2))
    return { ok: true, value }
  } catch (error) {
    failures += 1
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
  // The project this run writes, and the emulator it boots, both outlive the
  // process unless something removes them: a Gradle project under the session
  // workspace would be picked up by every later `android_discover_project`, and a
  // booted emulator makes the next start answer "already running". The cleanup
  // therefore runs in `finally`, so a failed step, a thrown provider or an
  // operator's interrupt cannot leave either behind.
  const projectDir = path.resolve(runtime.cwd, '.tmp-smoke-app')
  try {
    if (started.ok) {
      const serial = started.value.serial
      // The reason this layer exists: prove the project → build → install → launch
      // cycle the plugin is for, not just the discovery calls around it.
      const { create } = await import('../lib/providers/project.js')
      const created = await step('android_create_app', () =>
        create(runtime, { name: 'SmokeApp', dir: '.tmp-smoke-app', overwrite: true }),
      )
      const { buildApp } = await import('../lib/providers/build.js')
      const built = await step('android_build_app', () =>
        buildApp(runtime, { projectDir: '.tmp-smoke-app', timeoutMs: 600_000 }),
      )
      if (created.ok && built.ok && built.value.apkPath && built.value.applicationId) {
        const { install, launch } = await import('../lib/providers/app.js')
        await step('android_install_app', () =>
          install(runtime, { serial, apkPath: built.value.apkPath, timeoutMs: 120_000 }),
        )
        await step('android_launch_app', () =>
          launch(runtime, { serial, applicationId: built.value.applicationId, timeoutMs: 60_000 }),
        )
        const { status } = await import('../lib/providers/ui.js')
        await step('android_ui_status', () => status(runtime))
      }
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
    }
  } finally {
    if (started.ok) {
      const { stopEmulator } = await import('../lib/providers/avd.js')
      await step('android_stop_emulator', () => stopEmulator(runtime, { serial: started.value.serial }))
    }
    rmSync(projectDir, { recursive: true, force: true })
  }
}

const ok = preflightResult.ok
console.log(`\npreflight verdict: ${ok ? 'ready' : 'not ready'}`)
console.log('Checks that need a physical device or an AVD stay red until one is running.')
process.exit(failures === 0 ? 0 : 1)
