import { spawn as spawnChild } from 'node:child_process'
import { access, open, readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { brief, callTimeoutMs, ok, platformCommand, run, splitArgumentLines } from '../util/run.js'
import { systemImagePackage } from '../settings.js'
import { NoReadyDeviceError, adbShell, isBootComplete, listDevices, pickDevice, validSerial } from './device.js'
import { androidAvdHome, androidEnv, androidUserHome, installedPackages, requireTool } from './sdk.js'

/**
 * Android Virtual Device lifecycle.
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

/**
 * One AVD name, trimmed and validated, or undefined.
 * @param {unknown} value - the candidate name.
 * @returns {string|undefined} the cleaned name, or undefined when it is not one.
 */
function validAvdName(value) {
  const name = String(value ?? '').trim()
  return name.length > 0 && AVD.test(name) ? name : undefined
}

/**
 * A name reduced to characters every supported filesystem accepts.
 * @param {string} value - the name.
 * @returns {string} a filesystem-safe name fragment.
 */
function fileSafe(value) {
  return String(value).replaceAll(/[^A-Za-z0-9._-]/g, '_')
}

/** How often a boot wait re-polls `adb`. */
const EMULATOR_BOOT_POLL_MS = 2_000

/** Timeout for the `adb emu avd name` probe. */
const AVD_NAME_TIMEOUT_MS = 5_000

/**
 * One AVD read from the AVD directory rather than from the emulator.
 * @typedef {object} ScannedAvd
 * @property {string} name - the AVD name, taken from the record's file name.
 * @property {string} [target] - the `target=` value the `.ini` records, e.g. `android-35`.
 * @property {string} [path] - the AVD's payload directory.
 */

/**
 * List the AVDs on this machine: the AVD directory first, then the emulator.
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<Array<{name: string}>>} the AVDs.
 */
export async function listAvds(rt) {
  const home = await androidAvdHome(rt)
  const scanned = await scanAvds(rt)
  /** @type {{name: string}[] | Error} */
  let listed
  try {
    listed = await emulatorAvds(rt)
  } catch (error) {
    listed = error instanceof Error ? error : new Error(String(error))
  }
  /** @type {Map<string, {name: string}>} */
  const names = new Map(scanned.map((item) => [item.name, { name: item.name }]))
  if (!(listed instanceof Error)) {
    for (const item of listed) {
      // `parseAvds` already drops a line that is not an AVD name; the check is
      // repeated here so the merge has one door no matter how the list was
      // built, because the name is about to become a path and an argv value.
      const name = validAvdName(item.name)
      if (name === undefined || names.has(name)) continue
      // The emulator lists every `.ini` it can read, including one whose payload
      // was deleted, so its names are held to the same payload check the scan
      // makes. A name the AVD directory does not record at all is kept: the
      // emulator found it in a home this scan does not look at, and it can
      // start it.
      const record = await readAvdIni(home, name)
      if (record !== undefined && (await payloadOf(home, name, record.path)) === undefined) continue
      names.set(name, { name })
    }
  }
  if (names.size > 0) return [...names.values()]
  if (listed instanceof Error) throw listed
  return []
}

/**
 * The AVDs `emulator -list-avds` reports.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<Array<{name: string}>>} the AVDs.
 * @throws When the emulator is missing, cannot start, or exits non-zero.
 */
async function emulatorAvds(rt) {
  const emulator = await requireTool(rt, 'emulator')
  const out = await run([emulator, '-list-avds'], { timeout: 20_000, env: await androidEnv(rt) })
  if (!ok(out)) throw new Error(brief(out))
  return parseAvds(out.stdout)
}

/**
 * The AVDs stored in the AVD directory, read without running anything.
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<ScannedAvd[]>} the AVDs, sorted by name.
 */
export async function scanAvds(rt) {
  const home = await androidAvdHome(rt)
  const entries = await readdir(home, { withFileTypes: true }).catch(() => [])
  /** @type {Map<string, ScannedAvd>} */
  const found = new Map()
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.ini')) continue
    const name = validAvdName(entry.name.slice(0, -'.ini'.length))
    if (name === undefined) continue
    const record = await readAvdIni(home, name)
    const payload = await payloadOf(home, name, record?.path)
    if (payload === undefined) continue
    found.set(name, /** @type {ScannedAvd} */ ({ name, path: payload, ...(record?.target ? { target: record.target } : {}) }))
  }
  return [...found.values()].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
}

/**
 * The two fields an AVD's `*.ini` record carries that this plugin reads.
 * @param {string} text - the `.ini` file's content.
 * @returns {{path?: string, target?: string}} the recorded payload directory and target.
 */
export function parseAvdIni(text) {
  /** @type {{path?: string, target?: string}} */
  const record = {}
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_.]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match === null) continue
    const value = match[2] ?? ''
    if (value.length === 0) continue
    if (match[1] === 'path') record.path = value
    if (match[1] === 'target') record.target = value
  }
  return record
}

/**
 * The `.ini` record an AVD directory holds for one name.
 *
 * @param {string} home - the AVD directory.
 * @param {string} name - the AVD name.
 * @returns {Promise<{path?: string, target?: string} | undefined>} the record, or undefined when the directory holds none.
 */
async function readAvdIni(home, name) {
  const text = await readFile(path.join(home, `${name}.ini`), 'utf8').catch(() => undefined)
  return text === undefined ? undefined : parseAvdIni(text)
}

/**
 * The payload directory of one AVD, when it still exists.
 * @param {string} home - the AVD directory.
 * @param {string} name - the AVD name.
 * @param {string | undefined} recorded - the `path=` the record carries, if any.
 * @returns {Promise<string | undefined>} the payload directory, or undefined when it is gone.
 */
async function payloadOf(home, name, recorded) {
  const beside = path.join(home, `${name}.avd`)
  if (await exists(beside)) return beside
  if (recorded) {
    const resolved = path.resolve(home, recorded)
    if (await exists(resolved)) return resolved
  }
  return undefined
}

/**
 * `access` as a boolean.
 *
 * @param {string} file - the path to probe.
 * @returns {Promise<boolean>} whether the path is reachable.
 */
async function exists(file) {
  return access(file).then(() => true).catch(() => false)
}

/**
 * Parse `emulator -list-avds` output.
 * @param {string} value - the command's stdout.
 * @returns {Array<{name: string}>} one record per usable name.
 */
export function parseAvds(value) {
  /** @type {Array<{name: string}>} */
  const avds = []
  for (const line of String(value).split(/\r?\n/)) {
    const name = validAvdName(line)
    if (name === undefined) continue
    avds.push({ name })
  }
  return avds
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
  // adb is how the boot is observed at all, so a start whose device list
  // cannot be read would only burn the whole timeout and then report a boot
  // deadline. Ask before spawning the emulator: a host without `adb` (an SDK
  // with the emulator package but no platform-tools) and an adb server that
  // cannot answer both surface here, as their own errors, while no GUI
  // emulator has been started yet. The list is also the baseline the boot wait
  // diffs against.
  const before = new Set((await listDevices(rt)).map((item) => item.serial))
  const emulator = await requireTool(rt, 'emulator')
  const env = await androidEnv(rt)
  const extra = splitArgumentLines(rt.settings.emulatorArgs)

  // The emulator writes its diagnosis to stdout/stderr and then exits — a bad
  // AVD, a pending snapshot, a host without write access to the AVD directory.
  // The original plugin discarded that stream, so every such failure surfaced
  // as an unexplained boot timeout. Redirecting it to a log file keeps the
  // failure actionable and costs nothing on the happy path.
  const logFile = path.join(await rt.buildLogs(), `${stamp()}-emulator-${fileSafe(avd.name)}.log`)
  const handle = await open(logFile, 'w')
  // The emulator is usually a real executable, but a host that wraps it — a
  // `.bat` that sets an environment variable, say — hands back a batch file,
  // and Windows cannot start one without `cmd.exe`. The same platform routing
  // every other child process gets applies here.
  // The quoting decision needs the environment the child will actually have,
  // not the overlay alone: cmd.exe expands a %NAME% reference for every
  // variable the child defines, and the overlay does not carry the host's.
  const launch = platformCommand([emulator, '-avd', avd.name, ...extra], { ...rt.env, ...env })
  /** @type {import('node:child_process').ChildProcess} */
  let child
  try {
    child = spawnChild(launch.argv[0] ?? emulator, launch.argv.slice(1), {
      env: Object.fromEntries(Object.entries({ ...rt.env, ...env }).filter((item) => typeof item[1] === 'string')),
      shell: false,
      windowsVerbatimArguments: launch.verbatim,
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
    // believes was never started, and on Windows a wrapper would keep the
    // emulator alive while its launcher was killed. The failure therefore says
    // what happened to the process instead of claiming it may still finish
    // booting.
    const failure = error instanceof Error ? error : new Error(String(error))
    if (stopChild(child)) {
      failure.message +=
        '\nThe emulator this call started was terminated, so it is not left running or holding the AVD. ' +
        'Retry with a larger bootTimeoutSeconds to give the next boot more time.'
    }
    throw failure
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
 * @param {import('node:child_process').ChildProcess} child - the process to stop.
 * @returns {boolean} whether a termination was started; false when the process had already ended.
 */
function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return false
  if (process.platform === 'win32' && child.pid !== undefined) {
    try {
      const killer = spawnChild('taskkill', ['/T', '/F', '/PID', String(child.pid)], {
        stdio: 'ignore',
        windowsHide: true,
      })
      // `taskkill` itself may be unavailable (a trimmed-down image); the direct
      // child is still worth terminating then, even if a wrapper stays behind.
      killer.once('error', () => terminate(child))
      killer.unref()
      return true
    } catch {
      // Fall through to the direct termination below.
    }
  }
  terminate(child)
  return true
}

/**
 * SIGTERM a child, escalating to SIGKILL after a short grace period.
 *
 * @param {import('node:child_process').ChildProcess} child - the process to stop.
 * @returns {void}
 */
function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, 1_000)
  timer.unref()
}

/**
 * Resolve the boot deadline from the setting and the call's override.
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
 * @param {Runtime} rt - the call runtime.
 * @param {{name?: string, packageId?: string, device?: string, force?: boolean}} [input] - the tool arguments.
 * @returns {Promise<object>} the created AVD summary.
 */
export async function createAvd(rt, input = {}) {
  const name = cleanAvd(input.name || rt.settings.defaultAvd || 'medium_phone')
  const pkg = input.packageId || systemImagePackage(rt.settings)
  // The settings name a system image by api level, variant and ABI, and the
  // default names one this machine may not have installed — the plugin's own
  // default is `system-images;android-35;default;arm64-v8a`, which a machine
  // carrying only a Play Store image does not have. `avdmanager` answers that
  // with "Package path is not valid. Valid system image paths are: … null",
  // which names no way forward. The installed packages are already known from
  // the SDK tree, so the refusal can name the image that was asked for, the
  // ones that would work, and the setting that chooses it.
  const installed = await installedPackages(rt)
  if (installed.systemImages.length > 0 && !installed.systemImages.includes(pkg)) {
    throw new Error(
      `System image "${pkg}" is not installed. Installed system images: ${installed.systemImages.join(', ')}. ` +
        'Pass packageId, or set apiLevel, systemImageVariant and systemImageAbi on the Android Emulator Helper page to an installed image.',
    )
  }
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
 * @param {Runtime} rt - the call runtime.
 * @param {string} [name] - the requested AVD name.
 * @returns {Promise<{name: string}>} the chosen AVD.
 */
async function pickAvd(rt, name) {
  // The requested name goes through the same trim-then-validate door as every
  // other name: "  Pixel_8  " means Pixel_8, and a name made only of spaces is
  // refused instead of being looked up as an empty string.
  const requested = name === undefined || name === '' ? undefined : cleanAvd(name)
  const avds = await listAvds(rt)
  if (requested !== undefined) {
    // An explicitly requested AVD must exist: falling back to a substring match
    // starts a different emulator without the caller ever learning which one.
    const hit =
      avds.find((item) => item.name === requested) ??
      avds.find((item) => item.name.toLowerCase() === requested.toLowerCase())
    if (hit) return hit
    throw new Error(
      `Android AVD "${requested}" not found. Available AVDs: ${avds.map((item) => item.name).join(', ') || 'none'}.`,
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
  /** The first failure that was not a "not ready yet" answer. */
  /** @type {Error | undefined} */
  let queryError
  while (Date.now() < deadline) {
    if (watch.child.exitCode !== null || watch.child.signalCode !== null) {
      throw new Error(
        `Android Emulator for AVD "${avdName}" exited during startup (${exitDescription(watch.child)}).\n` +
          `Log: ${watch.logPath}\n${await logTail(watch.logFile)}`,
      )
    }
    try {
      last = await listDevices(rt)
    } catch (error) {
      // "cannot see any devices" is a state; "cannot ask" is a failure. Keeping
      // the first failure means the timeout can name the real cause instead of
      // reporting a boot deadline that never had a chance to be met.
      queryError ??= asError(error)
      await sleep(EMULATOR_BOOT_POLL_MS)
      continue
    }
    for (const fresh of startedEmulatorCandidates(last, before)) {
      /** @type {boolean} */
      let booted
      try {
        booted = await strictBootComplete(rt, fresh.serial)
      } catch (error) {
        // `isBootComplete` would answer "not ready" for this too, which is wrong
        // here: a boot that can never be queried would burn the deadline and be
        // reported as a slow boot.
        queryError ??= asError(error)
        continue
      }
      if (!booted) continue
      /** @type {string | undefined} */
      let name
      try {
        name = await avdNameFor(rt, fresh.serial)
      } catch (error) {
        queryError ??= asError(error)
        continue
      }
      if (name === avdName) return fresh
    }
    await sleep(EMULATOR_BOOT_POLL_MS)
  }
  const detail = last.length ? last.map((item) => `${item.serial}:${item.state}`).join(', ') : 'no adb devices'
  // The process is stopped by `startEmulator` as the wait unwinds; this message
  // describes the wait itself, so it neither promises the emulator is still
  // running nor claims that a failed query means no device appeared.
  const cause = queryError
    ? `A device query failed while waiting, so boot progress could not be observed: ${queryError.message}\n`
    : ''
  throw new Error(
    `Emulator boot deadline reached before Android finished booting (${detail}).\n` +
      cause +
      `Retry with a larger bootTimeoutSeconds, or pass the emulator's serial to the other tools once it is ready.\n` +
      blockerHint(last, await androidUserHome(rt)) +
      `Log: ${watch.logPath}\n${await logTail(watch.logFile)}`,
  )
}

/**
 * Whether one emulator has finished booting, with a failed query thrown.
 * @param {Runtime} rt - the call runtime.
 * @param {string} serial - the target serial.
 * @returns {Promise<boolean>} true when `sys.boot_completed` is `1`.
 * @throws When adb cannot run the query or exits non-zero.
 */
async function strictBootComplete(rt, serial) {
  const out = await adbShell(rt, serial, ['getprop', 'sys.boot_completed'], 10_000)
  return out.stdout.trim() === '1'
}

/**
 * The error form of an unknown caught value.
 *
 * @param {unknown} error - what a `catch` caught.
 * @returns {Error} the same error when it already is one.
 */
function asError(error) {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Explain the device states that stop a boot poll from ever succeeding.
 * @param {DeviceRecord[]} devices - the devices seen on the last poll.
 * @param {string} [adbKeyDir] - the directory that holds the adb key files.
 *   `ADB_VENDOR_KEYS` names a *directory* the adb server reads the keys from,
 *   not a key file, and the directory is the one the tools actually look in —
 *   `ANDROID_USER_HOME` moves it. Defaults to the user's `.android` directory
 *   for a caller that has no runtime to resolve it from.
 * @returns {string} a hint line, or an empty string when nothing was blocked.
 */
export function blockerHint(devices, adbKeyDir = path.join(os.homedir(), '.android')) {
  const blocked = devices.filter((item) => item.state !== 'device')
  if (blocked.length === 0) return ''
  const unauthorized = blocked.filter((item) => item.state === 'unauthorized')
  const lines = [`Blocking devices: ${blocked.map((item) => `${item.serial}:${item.state}`).join(', ')}.\n`]
  if (unauthorized.length > 0) {
    lines.push(
      `An unauthorized emulator never accepts adb commands. Accept the RSA prompt on screen, ` +
        `or wipe and restart the AVD with \`emulator -avd <name> -no-snapshot-load\`; ` +
        `ADB_VENDOR_KEYS=${adbKeyDir} must point at a readable directory holding the adb key files (adbkey, adbkey.pub).\n`,
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
 * @throws When the name is empty or carries a character `-avd` cannot take.
 */
function cleanAvd(value) {
  const name = validAvdName(value)
  if (name === undefined) throw new Error(`Invalid Android AVD name: ${String(value)}`)
  return name
}
