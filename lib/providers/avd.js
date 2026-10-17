import { spawn as spawnChild } from 'node:child_process'
import { open, readFile } from 'node:fs/promises'
import path from 'node:path'
import { brief, ok, run, splitArgumentLines } from '../util/run.js'
import { systemImagePackage } from '../settings.js'
import { isBootComplete, listDevices, pickDevice, validSerial } from './device.js'
import { androidEnv, requireTool } from './sdk.js'

/**
 * Android Virtual Device lifecycle.
 *
 * Ported from the ZCode plugin's `providers/avd.ts`. Behaviour is unchanged
 * except that the extra `emulatorArgs` setting is appended to the emulator
 * command line, and `autoStartEmulator` can turn the implicit start into a
 * refusal instead — a headless CI host usually wants the error, not a GUI.
 *
 * @module @zhz8888/dsh-android-emulator-helper/providers/avd
 */

/** AVD names accepted by `avdmanager` and `emulator -avd`. */
const AVD = /^[A-Za-z0-9_. -]+$/

/** How often a boot wait re-polls `adb`. */
const EMULATOR_BOOT_POLL_MS = 2_000

/** Timeout for the `adb emu avd name` probe. */
const AVD_NAME_TIMEOUT_MS = 5_000

/**
 * List the AVDs `emulator -list-avds` reports.
 *
 * @param {object} rt - the call runtime.
 * @returns {Promise<Array<{name: string}>>} the AVDs.
 */
export async function listAvds(rt) {
  const emulator = await requireTool(rt, 'emulator')
  const out = await run([emulator, '-list-avds'], { timeout: 20_000, env: await androidEnv(rt) })
  if (!ok(out)) throw new Error(brief(out))
  return parseAvds(out.stdout)
}

/**
 * Parse `emulator -list-avds` output.
 *
 * @param {string} value - the command's stdout.
 * @returns {Array<{name: string}>} one record per non-blank line.
 */
export function parseAvds(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((name) => ({ name }))
}

/**
 * Resolve a usable target, starting an emulator when the plugin is allowed to.
 *
 * @param {object} rt - the call runtime.
 * @param {{serial?: string, avd?: string, timeoutMs?: number}} [input] - the tool arguments.
 * @returns {Promise<object>} the device record, with `reused`/`started` set.
 * @throws When nothing is ready and `autoStartEmulator` is off.
 */
export async function ensureDevice(rt, input = {}) {
  // The page edits seconds; every spawn below wants milliseconds.
  const timeoutMs = input.timeoutMs ?? rt.settings.bootTimeoutSeconds * 1000
  if (input.serial) return waitForReadyTarget(rt, await pickDevice(rt, { serial: input.serial }), timeoutMs)
  const ready = await pickDevice(rt).catch(() => undefined)
  if (ready) return ready.kind === 'emulator' ? waitForReadyTarget(rt, ready, timeoutMs) : ready
  if (!rt.settings.autoStartEmulator) {
    throw new Error(
      'No ready Android device or emulator found, and autoStartEmulator is disabled in the Android emulator settings.',
    )
  }
  return startEmulator(rt, input)
}

/**
 * Start a new GUI emulator for one AVD and wait until it has booted.
 *
 * The original contract is preserved deliberately: this tool never reuses a
 * running target. Reuse is expressed by passing a serial to the other tools, so
 * "start" has exactly one meaning and cannot silently return someone else's
 * emulator.
 *
 * @param {object} rt - the call runtime.
 * @param {{avd?: string, timeoutMs?: number}} [input] - the tool arguments.
 * @returns {Promise<object>} the started device record.
 * @throws When the AVD is already running, or the boot times out.
 */
export async function startEmulator(rt, input = {}) {
  const timeoutMs = input.timeoutMs ?? rt.settings.bootTimeoutSeconds * 1000
  if (input.serial) {
    throw new Error(
      'android_start_emulator always starts a new emulator. Reuse an existing target by passing serial to build, install, launch, screenshot, log, or UI tools.',
    )
  }
  const avd = await pickAvd(rt, input.avd)
  const running = await runningAvd(rt, avd.name)
  if (running) {
    throw new Error(
      `Android AVD "${avd.name}" is already running as ${running.serial}. Reuse it by passing serial "${running.serial}" to target tools, or choose another AVD.`,
    )
  }
  const before = new Set((await listDevices(rt).catch(() => [])).map((item) => item.serial))
  const emulator = await requireTool(rt, 'emulator')
  const env = await androidEnv(rt)
  const extra = splitArgumentLines(rt.settings.emulatorArgs)

  // The emulator writes its diagnosis to stdout/stderr and then exits — a bad
  // AVD, a pending snapshot, a host without write access to the AVD directory.
  // The original plugin discarded that stream, so every such failure surfaced
  // as an unexplained boot timeout. Redirecting it to a log file keeps the
  // failure actionable and costs nothing on the happy path.
  const logFile = path.join(await rt.buildLogs(), `${stamp()}-emulator-${avd.name}.log`)
  const handle = await open(logFile, 'w')
  let child
  try {
    child = spawnChild(emulator, ['-avd', avd.name, ...extra], {
      env: Object.fromEntries(Object.entries({ ...rt.env, ...env }).filter((item) => typeof item[1] === 'string')),
      shell: false,
      stdio: ['ignore', handle.fd, handle.fd],
    })
    await waitForSpawn(child)
  } finally {
    // The child holds its own descriptor; ours only existed to hand it over.
    await handle.close().catch(() => {})
  }
  child.unref()

  const device = await waitForStartedDevice(rt, before, avd.name, timeoutMs, {
    child,
    logFile,
    logPath: path.relative(rt.cwd, logFile),
  })
  return { ...device, reused: false, started: true, pid: child.pid, logPath: path.relative(rt.cwd, logFile) }
}

/**
 * Stop one emulator through the ADB console.
 *
 * @param {object} rt - the call runtime.
 * @param {{serial: string}} input - the target serial.
 * @returns {Promise<{stopped: boolean, serial: string}>} the outcome.
 */
export async function stopEmulator(rt, input) {
  if (!validSerial(input.serial)) throw new Error(`Invalid Android device serial: ${input.serial}`)
  const adb = await requireTool(rt, 'adb')
  const out = await run([adb, '-s', input.serial, 'emu', 'kill'], { timeout: 20_000, env: await androidEnv(rt) })
  if (!ok(out)) throw new Error(brief(out))
  return { stopped: true, serial: input.serial }
}

/**
 * Create an AVD with `avdmanager`.
 *
 * `avdmanager` prompts for confirmation when the named system image is not yet
 * installed, so `no` is always written to stdin: creating an AVD must never
 * silently trigger a multi-gigabyte SDK download.
 *
 * @param {object} rt - the call runtime.
 * @param {{name?: string, packageId?: string, device?: string, force?: boolean}} [input] - the tool arguments.
 * @returns {Promise<object>} the created AVD summary.
 */
export async function createAvd(rt, input = {}) {
  const name = cleanAvd(input.name || rt.settings.defaultAvd || 'medium_phone')
  const pkg = input.packageId || systemImagePackage(rt.settings)
  const avdmanager = await requireTool(rt, 'avdmanager')
  const args = ['create', 'avd', '--name', name, '--package', pkg]
  if (input.device) args.push('--device', input.device)
  if (input.force) args.push('--force')
  const out = await run([avdmanager, ...args], {
    input: 'no\n',
    timeout: 120_000,
    env: await androidEnv(rt),
  })
  if (!ok(out)) throw new Error(brief(out))
  return { created: true, name, packageId: pkg, output: brief(out) }
}

/**
 * Choose the AVD to start: the requested one, the configured default, else the first.
 *
 * @param {object} rt - the call runtime.
 * @param {string} [name] - the requested AVD name.
 * @returns {Promise<{name: string}>} the chosen AVD.
 */
async function pickAvd(rt, name) {
  if (name && !AVD.test(name)) throw new Error(`Invalid Android AVD name: ${name}`)
  const avds = await listAvds(rt)
  const want = name || rt.settings.defaultAvd
  if (want) {
    const hit = avds.find((item) => item.name === want || item.name.toLowerCase().includes(want.toLowerCase()))
    if (hit) return hit
  }
  const first = avds[0]
  if (first) return first
  throw new Error('No Android AVDs found. Create one in Android Studio or call android_create_avd after confirming setup.')
}

/**
 * Poll until a newly appeared emulator matching `avdName` has booted.
 *
 * Two failure modes are distinguished rather than collapsed into one timeout:
 * the process exiting on its own is reported immediately with the tail of its
 * own log, and only a still-running emulator that never appears falls through
 * to the timeout message.
 *
 * @param {object} rt - the call runtime.
 * @param {Set<string>} before - serials seen before the start.
 * @param {string} avdName - the AVD that was started.
 * @param {number} timeoutMs - how long to wait.
 * @param {{child: import('node:child_process').ChildProcess, logFile: string, logPath: string}} watch - the spawned process and its log.
 * @returns {Promise<object>} the booted device record.
 */
async function waitForStartedDevice(rt, before, avdName, timeoutMs, watch) {
  const deadline = Date.now() + timeoutMs
  let last = []
  while (Date.now() < deadline) {
    if (watch.child.exitCode !== null || watch.child.signalCode !== null) {
      throw new Error(
        `Android Emulator for AVD "${avdName}" exited during startup (${exitDescription(watch.child)}).\n` +
          `Log: ${watch.logPath}\n${await logTail(watch.logFile)}`,
      )
    }
    last = await listDevices(rt).catch(() => [])
    for (const fresh of startedEmulatorCandidates(last, before)) {
      if (!(await isBootComplete(rt, fresh.serial))) continue
      const name = await avdNameFor(rt, fresh.serial).catch(() => undefined)
      if (name === avdName) return fresh
    }
    await sleep(EMULATOR_BOOT_POLL_MS)
  }
  const detail = last.length ? last.map((item) => `${item.serial}:${item.state}`).join(', ') : 'no adb devices'
  throw new Error(
    `Timed out waiting for Android Emulator to boot (${detail}).\n` +
      `Log: ${watch.logPath}\n${await logTail(watch.logFile)}`,
  )
}

/** Human-readable description of how a child process ended. */
function exitDescription(child) {
  if (child.signalCode !== null && child.signalCode !== undefined) return `signal ${child.signalCode}`
  return `exit code ${child.exitCode}`
}

/**
 * The last few meaningful lines of the emulator's log.
 *
 * @param {string} file - the log path.
 * @param {number} [maxLines] - how many trailing lines to keep.
 * @returns {Promise<string>} the tail, or a placeholder when the log is empty.
 */
async function logTail(file, maxLines = 25) {
  const text = await readFile(file, 'utf8').catch(() => '')
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
  if (lines.length === 0) return '(the emulator wrote no output)'
  return lines.slice(-maxLines).join('\n')
}

/** Filesystem-safe timestamp for log names. */
function stamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-')
}

/**
 * Emulators present now but absent before the start, in `device` state.
 *
 * @param {Array<object>} devices - current device records.
 * @param {Set<string>} before - serials seen before the start.
 * @returns {Array<object>} the fresh candidates.
 */
export function startedEmulatorCandidates(devices, before) {
  return devices.filter((item) => item.kind === 'emulator' && item.state === 'device' && !before.has(item.serial))
}

/** Wait for one already-selected emulator to finish booting. */
async function waitForReadyTarget(rt, device, timeoutMs) {
  if (device.kind !== 'emulator') return device
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isBootComplete(rt, device.serial)) return device
    await sleep(EMULATOR_BOOT_POLL_MS)
  }
  throw new Error(`Timed out waiting for Android Emulator to boot (${device.serial}).`)
}

/** The running emulator hosting `name`, when there is one. */
async function runningAvd(rt, name) {
  const emulators = (await listDevices(rt).catch(() => [])).filter(
    (item) => item.kind === 'emulator' && item.state === 'device',
  )
  for (const device of emulators) {
    const avdName = await avdNameFor(rt, device.serial).catch(() => undefined)
    if (avdName === name) return device
  }
  return undefined
}

/** Ask one emulator which AVD it is running. */
async function avdNameFor(rt, serial) {
  const adb = await requireTool(rt, 'adb')
  const out = await run([adb, '-s', serial, 'emu', 'avd', 'name'], {
    timeout: AVD_NAME_TIMEOUT_MS,
    env: await androidEnv(rt),
  })
  if (!ok(out)) return undefined
  return out.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line !== 'OK')
}

/** Sleep helper for the boot poll loops. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Resolve on spawn, reject on spawn failure. */
function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('spawn', resolve)
  })
}

/** Validate and trim an AVD name. */
function cleanAvd(value) {
  if (!AVD.test(value)) throw new Error(`Invalid Android AVD name: ${value}`)
  return value.trim()
}
