import { brief, ok, run } from '../util/run.js'
import { androidEnv, requireTool } from './sdk.js'

/**
 * ADB device enumeration and device-scoped shell access.
 *
 * Ported from the ZCode plugin's `providers/device.ts`. The argument-quoting
 * rules are kept exactly: `adb shell` runs a single command string on the
 * device, so a value containing shell metacharacters (`input text a b`) must be
 * quoted once, on the ADB side, not escaped for the host shell.
 *
 * @module dsh-android-emulator-helper/providers/device
 */

/** Characters that need no quoting in an `adb shell` command string. */
const SAFE_DEVICE_SHELL_TOKEN = /^[A-Za-z0-9_@%+=:,./-]+$/

/** Device serials `adb` accepts: emulator ports, USB serials, and TCP endpoints. */
const SERIAL = /^[A-Za-z0-9._:-]+$/

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
 * @returns {Array<object>} one record per device, with `kind` derived from the serial.
 */
export function parseAdbDevices(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices'))
    .map((line) => {
      const parts = line.split(/\s+/)
      const serial = parts[0] ?? ''
      const state = parts[1] ?? 'unknown'
      const attrs = new Map()
      for (const part of parts.slice(2)) {
        const split = part.indexOf(':')
        if (split > 0) attrs.set(part.slice(0, split), part.slice(split + 1))
      }
      return {
        serial,
        state,
        kind: serial.startsWith('emulator-') ? 'emulator' : 'device',
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
 * List every device and emulator `adb` can see.
 *
 * @param {object} rt - the call runtime.
 * @returns {Promise<Array<object>>} parsed device records.
 */
export async function listDevices(rt) {
  const adb = await requireTool(rt, 'adb')
  const out = await run([adb, 'devices', '-l'], { timeout: 20_000, env: await androidEnv(rt) })
  if (!ok(out)) throw new Error(brief(out))
  return parseAdbDevices(out.stdout)
}

/**
 * Choose the device a call should act on.
 *
 * Selection order implements the plugin's documented promise: an explicit
 * serial wins, then a ready emulator, then any ready device. An explicit serial
 * that is absent or offline fails loudly rather than silently retargeting.
 *
 * @param {object} rt - the call runtime.
 * @param {{serial?: string}} [input] - the tool arguments.
 * @returns {Promise<object>} the chosen device record.
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
  throw new Error('No ready Android device or emulator found.')
}

/**
 * Run one command on a device through `adb shell`.
 *
 * @param {object} rt - the call runtime.
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
  if (!ok(out)) throw new Error(brief(out))
  return out
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
 * @param {object} rt - the call runtime.
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
