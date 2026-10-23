import { ensureDevice } from './avd.js'
import { packageName } from './app.js'
import { brief, ok, run } from '../util/run.js'
import { androidEnv, requireTool } from './sdk.js'

/**
 * Logcat reads.
 *
 * Ported from the ZCode plugin's `providers/logs.ts`. The line count is clamped
 * to 1..5000 and the rendered text to a configurable ceiling: `logcat -d` on a
 * chatty app can produce tens of megabytes, and a tool result that large would
 * crowd out the conversation it is meant to inform.
 *
 * @module @zhz8888/dsh-android-emulator-helper/providers/logs
 */

/**
 * The runtime the log provider reads.
 *
 * @typedef {import('../runtime.js').Runtime} Runtime
 */

/**
 * One device or emulator, as `adb devices -l` reports it.
 *
 * @typedef {import('./device.js').DeviceRecord} DeviceRecord
 */

/** Upper bound accepted for `lines`, matching `logcat -t`. */
const MAX_LINES = 5000

/**
 * Clamp one requested line count to the range `logcat -t` accepts.
 *
 * A non-finite value falls back to the default tail rather than propagating
 * `NaN` into the command line.
 *
 * @param {number} value - the requested count.
 * @returns {number} an integer between 1 and {@link MAX_LINES}.
 */
function lineCount(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return MAX_LINES
  return Math.max(1, Math.min(Math.trunc(parsed), MAX_LINES))
}

/**
 * Read the most recent logcat output.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{applicationId?: string, lines?: number, limit?: number, serial?: string, avd?: string, timeoutMs?: number}} [input] - the tool arguments.
 * @returns {Promise<{device: DeviceRecord, applicationId: string|undefined, lines: number, output: string}>} the filtered output and the device it came from.
 */
export async function logs(rt, input = {}) {
  const device = await ensureDevice(rt, input)
  const adb = await requireTool(rt, 'adb')
  // `Math.max(1, Math.min(NaN, 5000))` is NaN, and `String(NaN)` reaches adb as
  // `-t NaN`. The registry's `integer` schema already refuses that from the
  // model, so this is defence in depth for a programmatic caller.
  const lines = lineCount(input.lines ?? rt.settings.logTailLines)
  const out = await run([adb, '-s', device.serial, 'logcat', '-d', '-v', 'time', '-t', String(lines)], {
    timeout: 60_000,
    env: await androidEnv(rt),
  })
  if (!ok(out)) throw new Error(brief(out))

  const app = input.applicationId ? packageName(input.applicationId) : undefined
  const value = app
    ? out.stdout
        .split(/\r?\n/)
        .filter(
          (line) =>
            line.includes(app) ||
            line.toLowerCase().includes(app.split('.').at(-1)?.toLowerCase() ?? app),
        )
        .join('\n')
    : out.stdout

  return {
    device,
    applicationId: app,
    lines,
    output: truncate(value, input.limit ?? 20_000),
  }
}

/**
 * Truncate rendered log text with an explicit marker.
 *
 * @param {string} value - the rendered log text.
 * @param {number} limit - how many characters to keep.
 * @returns {string} the text, shortened when it exceeds the limit.
 */
function truncate(value, limit) {
  if (!Number.isFinite(limit) || limit <= 0 || value.length <= limit) return value
  return `${value.slice(0, limit)}\n...[truncated ${value.length - limit} characters]`
}
