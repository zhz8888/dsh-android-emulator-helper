import { brief, ok, run } from '../util/run.js'
import { androidEnv, requireTool } from './sdk.js'

/**
 * ADB device enumeration and device-scoped shell access. Ported from the ZCode
 * plugin's `providers/device.ts`; argument quoting stays on the ADB side, since
 * `adb shell` runs one command string on the device.
 *
 * @module @zhz8888/dsh-android-emulator-helper/providers/device
 */

/**
 * The runtime the provider reads.
 *
 * @typedef {import('../runtime.js').Runtime} Runtime
 */

/**
 * One device or emulator, as `adb devices -l` reports it.
 *
 * @typedef {object} DeviceRecord
 * @property {string} serial - the serial `adb -s` accepts.
 * @property {string} state - `device`, `offline`, `unauthorized`, `no permissions`, and so on.
 * @property {'emulator'|'device'} kind - derived from the serial.
 * @property {string|undefined} model - the `model:` attribute, when present.
 * @property {string|undefined} product - the `product:` attribute, when present.
 * @property {string|undefined} device - the `device:` attribute, when present.
 * @property {string|undefined} transportId - the `transport_id:` attribute, when present.
 * @property {string} raw - the line the record was parsed from.
 */

/** Characters that need no quoting in an `adb shell` command string. */
const SAFE_DEVICE_SHELL_TOKEN = /^[A-Za-z0-9_@%+=:,./-]+$/

/** Device serials `adb` accepts: emulator ports, USB serials, and TCP endpoints. */
const SERIAL = /^[A-Za-z0-9._:-]+$/

/** Raised when no device is ready — the one case `ensureDevice` may start an emulator for; other failures must be rethrown. */
export class NoReadyDeviceError extends Error {}

/**
 * Whether a string is a structurally valid ADB serial.
 *
 * @param {unknown} serial - candidate serial.
 * @returns {boolean} true when safe to pass as an `adb -s` argument.
 */
export function validSerial(serial) {
  return typeof serial === 'string' && SERIAL.test(serial)
}

/**
 * Parse `adb devices -l` output.
 *
 * @param {string} value - the command's stdout.
 * @returns {DeviceRecord[]} one record per device, with `kind` derived from the serial.
 */
export function parseAdbDevices(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices'))
    .map((line) => {
      const serial = line.split(/\s+/, 1)[0] ?? ''
      const { state, rest } = splitAdbState(line.slice(serial.length).trim())
      /** @type {Map<string, string>} */
      const attrs = new Map()
      for (const part of rest.split(/\s+/).filter(Boolean)) {
        const split = part.indexOf(':')
        if (split > 0) attrs.set(part.slice(0, split), part.slice(split + 1))
      }
      return {
        serial,
        state,
        // The kind is one of two values by construction; the cast keeps the
        // literal union the record type promises.
        kind: /** @type {'emulator'|'device'} */ (serial.startsWith('emulator-') ? 'emulator' : 'device'),
        model: attrs.get('model'),
        product: attrs.get('product'),
        device: attrs.get('device'),
        transportId: attrs.get('transport_id'),
        raw: line,
      }
    })
    .filter((item) => item.serial.length > 0)
}

/**
 * Connection states `adb devices` prints, longest spelling first so `no
 * permissions` is read as one state (with its udev explanation) and not split
 * into `no`. `host` is the server's own connection; `connecting`/
 * `authorizing` are TCP transitional states.
 *
 * @type {readonly string[]}
 */
const ADB_STATES = Object.freeze([
  'no permissions',
  'unauthorized',
  'bootloader',
  'authorizing',
  'connecting',
  'recovery',
  'sideload',
  'offline',
  'rescue',
  'device',
  'host',
])

/**
 * Split an `adb devices -l` line into its connection state and the `key:value`
 * attributes that follow. `no permissions` consumes the rest as prose (udev
 * explanation), and an unknown state is passed through as its first word.
 *
 * @param {string} value - the line after the serial.
 * @returns {{state: string, rest: string}} the state and the attributes that follow it.
 */
function splitAdbState(value) {
  for (const state of ADB_STATES) {
    if (value !== state && !value.startsWith(`${state} `) && !value.startsWith(`${state};`)) continue
    // A two-word state consumes the rest of the line: what follows `no
    // permissions` is prose, not `key:value` attributes.
    return { state, rest: state.includes(' ') ? '' : value.slice(state.length).trim() }
  }
  const split = value.search(/\s/)
  if (split < 0) return { state: value.length > 0 ? value : 'unknown', rest: '' }
  return { state: value.slice(0, split), rest: value.slice(split + 1) }
}

/**
 * List every device and emulator `adb` can see.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<DeviceRecord[]>} parsed device records.
 */
export async function listDevices(rt) {
  const adb = await requireTool(rt, 'adb')
  const out = await run([adb, 'devices', '-l'], { timeout: 20_000, env: await androidEnv(rt) })
  if (!ok(out)) throw new Error(brief(out))
  return parseAdbDevices(out.stdout)
}

/**
 * Choose the device a call acts on: explicit serial, then a ready emulator,
 * then any ready device. An absent/offline explicit serial fails loudly rather
 * than silently retargeting.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{serial?: string}} [input] - the tool arguments.
 * @returns {Promise<DeviceRecord>} the chosen device record.
 * @throws When nothing is ready, or the named device is not usable.
 */
export async function pickDevice(rt, input = {}) {
  const devices = await listDevices(rt)
  const wanted = input.serial ?? (rt.settings.defaultSerial || undefined)
  if (wanted) {
    if (!validSerial(wanted)) throw new Error(`Invalid Android device serial: ${wanted}`)
    const hit = devices.find((item) => item.serial === wanted)
    if (!hit) throw new Error(`Android device not found: ${wanted}`)
    if (hit.state !== 'device') throw new Error(`Android device is not ready: ${wanted} (${hit.state})`)
    return hit
  }
  const online = devices.filter((item) => item.state === 'device')
  const emulator = online.find((item) => item.kind === 'emulator')
  if (emulator) return emulator
  const first = online[0]
  if (first) return first
  throw new NoReadyDeviceError('No ready Android device or emulator found.')
}

/**
 * Run one command on a device through `adb shell`.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} serial - the target device serial.
 * @param {string[]} args - already-split command words.
 * @param {number} [timeout] - milliseconds before SIGTERM.
 * @returns {Promise<{cmd: string[], code: number, stdout: string, stderr: string, timed: boolean}>} the result.
 */
export async function adbShell(rt, serial, args, timeout = 30_000) {
  if (!validSerial(serial)) throw new Error(`Invalid Android device serial: ${serial}`)
  const adb = await requireTool(rt, 'adb')
  const out = await run([adb, '-s', serial, 'shell', adbShellCommand(args)], {
    timeout,
    env: await androidEnv(rt),
  })
  if (!ok(out)) throw shellError(out)
  return out
}

/**
 * Build the error for a failed device-shell command. Carries `timed`/`code` as
 * fields so callers (e.g. the UI dump path) can distinguish a timeout from a
 * command failure without matching message text.
 *
 * @param {import('../util/run.js').RunResult} out - the failed command's record.
 * @returns {Error & {timed?: boolean, code?: number}} the error to throw.
 */
function shellError(out) {
  const error = /** @type {Error & {timed?: boolean, code?: number}} */ (new Error(brief(out)))
  if (out.timed) error.timed = true
  error.code = out.code
  return error
}

/**
 * Join command words into the single string `adb shell` consumes.
 *
 * @param {string[]} args - command words.
 * @returns {string} the shell command string.
 */
export function adbShellCommand(args) {
  if (args.length === 0) throw new Error('Missing adb shell command.')
  return args.map(deviceShellQuote).join(' ')
}

/**
 * Whether the device has finished booting.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} serial - the target device serial.
 * @returns {Promise<boolean>} true when `sys.boot_completed` is `1`.
 */
export async function isBootComplete(rt, serial) {
  const out = await adbShell(rt, serial, ['getprop', 'sys.boot_completed'], 10_000).catch(() => undefined)
  return out?.stdout.trim() === '1'
}

/**
 * Quote one word for the device's `sh`, which POSIX single quotes suffice for.
 *
 * @param {string} value - the raw word.
 * @returns {string} a safe word.
 */
function deviceShellQuote(value) {
  if (value.length === 0) return "''"
  if (SAFE_DEVICE_SHELL_TOKEN.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}
