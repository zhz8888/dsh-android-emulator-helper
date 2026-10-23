import { spawn as spawnChild } from 'node:child_process'
import { open, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { brief, callTimeoutMs, ok, run, splitArgumentLines } from '../util/run.js'
import { systemImagePackage } from '../settings.js'
import { NoReadyDeviceError, adbShell, isBootComplete, listDevices, pickDevice, validSerial } from './device.js'
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

/**
 * The runtime the provider reads.
 *
 * @typedef {import('../runtime.js').Runtime} Runtime
 */

/**
 * One device or emulator, as `adb devices -l` reports it.
 *
 * @typedef {import('./device.js').DeviceRecord} DeviceRecord
 */

/**
 * A device this provider started, with the two report flags set.
 *
 * @typedef {DeviceRecord & {
 *   reused: boolean,
 *   started: boolean,
 *   avd: string,
 *   pid: number|undefined,
 *   logPath: string|undefined,
 * }} StartedDevice
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
 * @param {Runtime} rt - the call runtime.
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
 * @param {Runtime} rt - the call runtime.
 * @param {{serial?: string, avd?: string, timeoutMs?: number}} [input] - the tool arguments.
 * @returns {Promise<DeviceRecord>} the device record, with `reused`/`started` set.
 * @throws When nothing is ready and `autoStartEmulator` is off.
 */
export async function ensureDevice(rt, input = {}) {
  // The page edits seconds; every spawn below wants milliseconds.
  const timeoutMs = bootTimeoutMs(input.timeoutMs, rt.settings.bootTimeoutSeconds)
  if (input.serial) return waitForReadyTarget(rt, await pickDevice(rt, { serial: input.serial }), timeoutMs)
  /** @type {import('./device.js').DeviceRecord | undefined} */
  let ready
  try {
    ready = await pickDevice(rt)
  } catch (error) {
    // Only "nothing is ready" may fall through to starting an emulator. A
    // stale defaultSerial, an unreadable device list or a missing adb is a real
    // failure: swallowing it retargets the call to a newly booted emulator while
    // a ready device sits there.
    if (!(error instanceof NoReadyDeviceError)) throw error
  }
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
 * `serial` is part of the input type only so that it can be refused with a
 * helpful message. It is not one of the tool's arguments, and a caller who
 * passes one deserves to be told where to reuse an emulator instead of being
 * quietly handed a second one.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{avd?: string, timeoutMs?: number, serial?: string}} [input] - the tool arguments.
 * @returns {Promise<StartedDevice>} the started device record.
 * @throws When the AVD is already running, or the boot times out.
 */
export async function startEmulator(rt, input = {}) {
  const timeoutMs = bootTimeoutMs(input.timeoutMs, rt.settings.bootTimeoutSeconds)
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
  /** @type {import('node:child_process').ChildProcess} */
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

  /** @type {DeviceRecord} */
  let device
  try {
    device = await waitForStartedDevice(rt, before, avd.name, timeoutMs, {
      child,
      logFile,
      logPath: path.relative(rt.cwd, logFile),
    })
  } catch (error) {
    // A boot wait that gives up must not leave the emulator it started running:
    // the next call would then report "already running" for an AVD the caller
    // believes was never started.
    stopChild(child)
    throw error
  }
  return {
    ...device,
    reused: false,
    started: true,
    avd: avd.name,
    pid: child.pid,
    logPath: path.relative(rt.cwd, logFile),
  }
}

/**
 * Terminate a started child, escalating after a short grace period.
 *
 * @param {import('node:child_process').ChildProcess} child - the process to stop.
 * @returns {void}
 */
function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, 1_000)
  timer.unref()
}

/**
 * Resolve the boot deadline from the setting and the call's override.
 *
 * Kept as a named export because the seconds/milliseconds split is pinned by
 * `test/device-tools.test.js`, but the rule itself now lives in
 * {@link callTimeoutMs} so the build path cannot drift from the device path.
 *
 * @param {number | undefined} overrideMs - `timeoutMs` from the tool arguments.
 * @param {number} settingSeconds - `bootTimeoutSeconds` from the live settings.
 * @returns {number} the deadline in milliseconds.
 * @throws When the override is not a positive number.
 */
export function bootTimeoutMs(overrideMs, settingSeconds) {
  return callTimeoutMs(overrideMs, settingSeconds)
}

/**
 * Stop one emulator through the ADB console.
 *
 * @param {Runtime} rt - the call runtime.
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
 * @param {Runtime} rt - the call runtime.
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
 * Only the *fallback* (nothing asked for, or the configured default is gone) may
 * pick an AVD the caller did not name. An explicitly requested AVD that does not
 * exist must fail: silently starting a different emulator turns a typo into a
 * wrong device, and the caller never learns which AVD it is actually talking to.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} [name] - the requested AVD name.
 * @returns {Promise<{name: string}>} the chosen AVD.
 */
async function pickAvd(rt, name) {
  if (name && !AVD.test(name)) throw new Error(`Invalid Android AVD name: ${name}`)
  const avds = await listAvds(rt)
  if (name) {
    // An explicitly requested AVD must exist: falling back to a substring match
    // starts a different emulator without the caller ever learning which one.
    const hit = avds.find((item) => item.name === name) ?? avds.find((item) => item.name.toLowerCase() === name.toLowerCase())
    if (hit) return hit
    throw new Error(
      `Android AVD "${name}" not found. Available AVDs: ${avds.map((item) => item.name).join(', ') || 'none'}.`,
    )
  }
  const want = rt.settings.defaultAvd
  if (want) {
    const hit =
      avds.find((item) => item.name === want) ??
      avds.find((item) => item.name.toLowerCase().includes(want.toLowerCase()))
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
 * @param {Runtime} rt - the call runtime.
 * @param {Set<string>} before - serials seen before the start.
 * @param {string} avdName - the AVD that was started.
 * @param {number} timeoutMs - how long to wait.
 * @param {{child: import('node:child_process').ChildProcess, logFile: string, logPath: string}} watch - the spawned process and its log.
 * @returns {Promise<DeviceRecord>} the booted device record.
 */
async function waitForStartedDevice(rt, before, avdName, timeoutMs, watch) {
  const deadline = Date.now() + timeoutMs
  /** @type {DeviceRecord[]} */
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
    // A device that is still booting when the deadline passes is a different
    // situation from one that never appeared, and the old wording claimed the
    // emulator had failed to boot in both cases. The emulator keeps booting
    // after this call returns, so say that instead of implying it died.
    `Emulator boot deadline reached before Android finished booting (${detail}).\n` +
      `The emulator may still finish booting after this call returns; retry with a larger bootTimeoutSeconds, or pass its serial to the other tools once it is ready.\n` +
      blockerHint(last) +
      `Log: ${watch.logPath}\n${await logTail(watch.logFile)}`,
  )
}

/**
 * Explain the device states that stop a boot poll from ever succeeding.
 *
 * `startedEmulatorCandidates` only accepts a serial in `device` state, so an
 * emulator sitting in `unauthorized` (an adb key handshake that never
 * completed) or `offline` is invisible to the loop above: it polls until the
 * timeout and reports only the boot timeout. Naming the real blocker turns an
 * opaque timeout into something a caller can act on.
 *
 * @param {DeviceRecord[]} devices - the devices seen on the last poll.
 * @returns {string} a hint line, or an empty string when nothing was blocked.
 */
export function blockerHint(devices) {
  const blocked = devices.filter((item) => item.state !== 'device')
  if (blocked.length === 0) return ''
  const unauthorized = blocked.filter((item) => item.state === 'unauthorized')
  const lines = [`Blocking devices: ${blocked.map((item) => `${item.serial}:${item.state}`).join(', ')}.\n`]
  if (unauthorized.length > 0) {
    lines.push(
      `An unauthorized emulator never accepts adb commands. Accept the RSA prompt on screen, ` +
        `or wipe and restart the AVD with \`emulator -avd <name> -no-snapshot-load\`; ` +
        `ADB_VENDOR_KEYS=${path.join(os.homedir(), '.android', 'adbkey')} must be readable by the adb server.\n`,
    )
  }
  lines.push('')
  return lines.join('')
}

/**
 * Human-readable description of how a child process ended.
 *
 * @param {import('node:child_process').ChildProcess} child - the exited process.
 * @returns {string} the signal or exit code.
 */
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

/**
 * Filesystem-safe timestamp for log names.
 *
 * @returns {string} the timestamp.
 */
function stamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-')
}

/**
 * Emulators present now but absent before the start, in `device` state.
 *
 * @param {DeviceRecord[]} devices - current device records.
 * @param {Set<string>} before - serials seen before the start.
 * @returns {DeviceRecord[]} the fresh candidates.
 */
export function startedEmulatorCandidates(devices, before) {
  return devices.filter((item) => item.kind === 'emulator' && item.state === 'device' && !before.has(item.serial))
}

/**
 * Wait for one already-selected emulator to finish booting.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {DeviceRecord} device - the selected target.
 * @param {number} timeoutMs - how long to wait.
 * @returns {Promise<DeviceRecord>} the ready device.
 */
async function waitForReadyTarget(rt, device, timeoutMs) {
  if (device.kind !== 'emulator') return device
  const deadline = Date.now() + timeoutMs
  // Reaching here means `adb` already reports the device in `device` state, so
  // "the device has not appeared" is not the possible failure any more. What
  // differs is whether its shell answers at all:
  //
  //   - `getprop` succeeds (even with `0` or nothing): the device is still
  //     finishing its boot, which is normal and only needs more time.
  //   - `getprop` times out or fails: the shell is wedged — a hung
  //     `uiautomator dump` does this — so waiting longer barely helps and the
  //     advice is to retry once it settles.
  let wedged = false
  while (Date.now() < deadline) {
    const probe = await bootProbe(rt, device.serial)
    if (probe.complete) return device
    if (probe.wedged) wedged = true
    await sleep(EMULATOR_BOOT_POLL_MS)
  }
  throw new Error(
    wedged
      ? `Emulator boot deadline reached while ${device.serial} was not answering: the device is attached but its shell stopped responding, which a wedged UI Automator dump does. ` +
        `Retry once it settles rather than raising bootTimeoutMs.`
      : `Emulator boot deadline reached before ${device.serial} finished booting. ` +
        `The emulator may still finish booting after this call returns; retry with a larger bootTimeoutMs once it is ready.`,
  )
}

/**
 * Ask one emulator whether it finished booting, and whether its shell answered.
 *
 * The two answers are separate because a wedged shell fails the probe the same
 * way a device that has not started does; only the kind of failure tells them
 * apart. A device that vanished mid-poll is a different failure again and is
 * rethrown rather than folded into "busy", so the caller is not told to retry
 * something that will never answer.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} serial - the emulator serial.
 * @returns {Promise<{complete: boolean, wedged: boolean}>} the probe result; `wedged` means the shell timed out or reported a failure.
 * @throws When the device is gone or adb itself could not run.
 */
async function bootProbe(rt, serial) {
  try {
    const out = await adbShell(rt, serial, ['getprop', 'sys.boot_completed'], 10_000)
    return { complete: out.stdout.trim() === '1', wedged: false }
  } catch (error) {
    // `adbShell` sets `timed` for a timeout and `code` for a non-zero exit;
    // both mean the device answered the transport but its shell did not answer
    // the command. Anything else (no such device, adb missing) is a real error.
    const marked = /** @type {{timed?: boolean, code?: number}} */ (error)
    if (marked.timed === true || typeof marked.code === 'number') return { complete: false, wedged: true }
    throw error
  }
}

/**
 * The running emulator hosting `name`, when there is one.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} name - the AVD name to look for.
 * @returns {Promise<DeviceRecord|undefined>} the running emulator, when there is one.
 */
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

/**
 * Ask one emulator which AVD it is running.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} serial - the emulator's serial.
 * @returns {Promise<string|undefined>} the AVD name it runs.
 */
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

/**
 * Sleep helper for the boot poll loops.
 *
 * @param {number} ms - how long to wait.
 * @returns {Promise<void>} resolves after the delay.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Resolve on spawn, reject on spawn failure.
 *
 * @param {import('node:child_process').ChildProcess} child - the spawned process.
 * @returns {Promise<unknown>} resolves when the process spawned.
 */
function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('spawn', resolve)
  })
}

/**
 * Validate and trim an AVD name.
 *
 * @param {string} value - the candidate name.
 * @returns {string} the validated name.
 */
function cleanAvd(value) {
  if (!AVD.test(value)) throw new Error(`Invalid Android AVD name: ${value}`)
  return value.trim()
}
