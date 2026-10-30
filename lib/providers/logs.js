import { ensureDevice } from './avd.js'
import { packageName } from './app.js'
import { adbShell } from './device.js'
import { brief, ok, run } from '../util/run.js'
import { androidEnv, requireTool } from './sdk.js'

/**
 * Logcat reads.
 *
 * Ported from the ZCode plugin's `providers/logs.ts`. The line count is clamped
 * to 1..5000 and the rendered text to a ceiling the caller may raise up to
 * 200000 characters: `logcat -d` on a chatty app can produce tens of megabytes,
 * and a tool result that large would crowd out the conversation it is meant to
 * inform.
 *
 * An `applicationId` filter works from the PID, not from the text. A
 * `logcat -v time` line names its process only in the parenthesised PID after
 * the tag — the application id itself appears on system lines, never on the
 * app's own lines — so matching the tail text by substring missed almost every
 * line the app actually wrote. The provider therefore asks the device for the
 * app's PID first (`pidof`), reads that PID's tail (`logcat --pid`), and only
 * falls back to text matching when no PID is running. The fallback is reported
 * in the result instead of being passed off as a filtered read.
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

/**
 * How the returned lines were selected.
 *
 * - `pid`: the device filtered by PID (`logcat --pid`).
 * - `pid-column`: the device did not accept `--pid`, so the tail was filtered
 *   by the PID column of `-v time` (and `-v threadtime`) lines.
 * - `text`: no PID was available, so the tail was filtered by matching the
 *   application id text — a best effort that misses lines which do not name it.
 * - `none`: no application filter was requested.
 *
 * @typedef {'pid'|'pid-column'|'text'|'none'} LogFilter
 */

/**
 * One logcat read, before the character ceiling is applied.
 *
 * @typedef {object} LogRead
 * @property {string} output - the selected log text.
 * @property {number[]} pids - the app's PIDs, empty when none were found.
 * @property {LogFilter} filter - how the lines were selected.
 * @property {string} [note] - what the caller must know about the selection.
 */

/** Upper bound accepted for `lines`, matching `logcat -t`. */
const MAX_LINES = 5000

/** Rendered-output ceiling when the caller names no `limit`. */
const DEFAULT_RENDER_LIMIT = 20_000

/** Rendered-output ceiling a caller may raise the default to. */
const MAX_RENDER_LIMIT = 200_000

/** The largest PID the Linux kernel hands out; anything above it is not a PID. */
const MAX_PID = 4_194_304

/** Timeout for each logcat or `pidof` spawn. */
const LOGCAT_TIMEOUT_MS = 60_000

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
 * Clamp one requested character ceiling to a positive, bounded value.
 *
 * `logcat` output is unbounded, so a `limit` of `0` or a negative number must
 * not read as "no ceiling": that is the one value a caller supplies when it
 * means the opposite, and it let a megabyte of log text into the conversation
 * while the sibling `lines` argument was clamped. Non-finite and non-positive
 * values fall back to the default ceiling; larger values are raised to
 * {@link MAX_RENDER_LIMIT} rather than refused.
 *
 * @param {number|undefined} value - the requested ceiling.
 * @returns {number} an integer between 1 and {@link MAX_RENDER_LIMIT}.
 */
function renderLimit(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RENDER_LIMIT
  return Math.max(1, Math.min(Math.trunc(parsed), MAX_RENDER_LIMIT))
}

/**
 * Read the most recent logcat output.
 *
 * `lines` is the tail the caller asked the device for; `returnedLines` is how
 * many lines the result actually carries, which is what a caller needs after a
 * filter or the character ceiling removed some of them.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{applicationId?: string, lines?: number, limit?: number, serial?: string, avd?: string, timeoutMs?: number}} [input] - the tool arguments.
 * @returns {Promise<{device: DeviceRecord, applicationId: string|undefined, lines: number, returnedLines: number, output: string, pids?: number[], filter?: LogFilter, note?: string}>} the selected output and the device it came from.
 */
export async function logs(rt, input = {}) {
  const device = await ensureDevice(rt, input)
  const adb = await requireTool(rt, 'adb')
  // `Math.max(1, Math.min(NaN, 5000))` is NaN, and `String(NaN)` reaches adb as
  // `-t NaN`. The registry's `integer` schema already refuses that from the
  // model, so this is defence in depth for a programmatic caller.
  const lines = lineCount(input.lines ?? rt.settings.logTailLines)
  // The id is validated before either spawn: a malformed id must not reach
  // `pidof`, and the validation error is the caller's answer, not a device's.
  const app = input.applicationId ? packageName(input.applicationId) : undefined
  const read =
    app === undefined
      ? await readTail(rt, adb, device.serial, lines)
      : await readApplication(rt, adb, device.serial, app, lines)
  const output = truncate(read.output, renderLimit(input.limit))
  /** @type {{device: DeviceRecord, applicationId: string|undefined, lines: number, returnedLines: number, output: string, pids?: number[], filter?: LogFilter, note?: string}} */
  const report = {
    device,
    applicationId: app,
    // The requested tail and the delivered line count are different facts; a
    // caller that asked for 500 lines and got 3 needs both numbers.
    lines,
    returnedLines: lineTotal(output),
    output,
  }
  // The selection fields describe an application filter, so they are absent
  // from an unfiltered read rather than present and meaningless.
  if (app !== undefined) {
    report.pids = read.pids
    report.filter = read.filter
    if (read.note !== undefined) report.note = read.note
  }
  return report
}

/**
 * Read one unfiltered logcat tail.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} adb - the resolved `adb`.
 * @param {string} serial - the target device serial.
 * @param {number} lines - the tail size.
 * @returns {Promise<LogRead>} the tail.
 */
async function readTail(rt, adb, serial, lines) {
  const out = await run(logcatArgs(adb, serial, lines), {
    timeout: LOGCAT_TIMEOUT_MS,
    env: await androidEnv(rt),
  })
  if (!ok(out)) throw new Error(brief(out))
  return { output: out.stdout, pids: [], filter: 'none' }
}

/**
 * Read the logcat tail of one running application.
 *
 * The PID is the filter that works: a `logcat -v time` line carries its process
 * id in parentheses after the tag and never repeats the application id, so
 * matching the tail text by substring missed the app's own lines. When `pidof`
 * names a process the read asks the device to filter by it; when the device
 * does not accept `--pid` the tail is read unfiltered and filtered by the PID
 * column here; and when no process is running the fallback is the old text
 * match, labelled as such, because buffered history is still useful when the
 * app has already exited.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} adb - the resolved `adb`.
 * @param {string} serial - the target device serial.
 * @param {string} app - the validated application id.
 * @param {number} lines - the tail size.
 * @returns {Promise<LogRead>} the selected lines.
 */
async function readApplication(rt, adb, serial, app, lines) {
  const env = await androidEnv(rt)
  const pids = await applicationPids(rt, serial, app)
  if (pids.length > 0) {
    const filtered = await run(logcatArgs(adb, serial, lines, [`--pid=${pids.join(',')}`]), {
      timeout: LOGCAT_TIMEOUT_MS,
      env,
    })
    if (ok(filtered)) return { output: filtered.stdout, pids, filter: 'pid' }
  }
  const out = await run(logcatArgs(adb, serial, lines), { timeout: LOGCAT_TIMEOUT_MS, env })
  if (!ok(out)) throw new Error(brief(out))
  if (pids.length > 0) {
    return {
      output: filterByPid(out.stdout, pids),
      pids,
      filter: 'pid-column',
      note:
        `The device did not accept logcat --pid for ${pids.join(', ')}; ` +
        'the tail was filtered by the PID column of its time-formatted lines instead.',
    }
  }
  return {
    output: filterByText(out.stdout, app),
    pids,
    filter: 'text',
    note:
      `pidof reported no running process for ${app}, so the application's log lines could not be selected by PID ` +
      '(the app may have exited, or the device may not ship pidof). The tail was filtered by matching the ' +
      'application id text instead; that misses the app lines which do not name it.',
  }
}

/**
 * The PIDs the device reports for one application.
 *
 * `pidof` exits non-zero when nothing matches, and the device may not ship it
 * at all; both cases mean "no PID", which is a fallback condition rather than
 * a tool failure, so the error is not propagated from here. A real device
 * failure still surfaces from the `logcat` read that follows.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} serial - the target device serial.
 * @param {string} app - the validated application id.
 * @returns {Promise<number[]>} the PIDs, deduplicated and in device order.
 */
async function applicationPids(rt, serial, app) {
  const out = await adbShell(rt, serial, ['pidof', app], 15_000).catch(() => undefined)
  return out === undefined ? [] : uniquePids(out.stdout)
}

/**
 * The plausible PIDs named in `pidof` output.
 *
 * `pidof` prints its matches whitespace-separated. Tokens that cannot be PIDs
 * are ignored: a shell error line ("/system/bin/sh: pidof: not found") must
 * not become `[NaN]` and reach the `--pid` argument.
 *
 * @param {string} value - the command's stdout.
 * @returns {number[]} the PIDs.
 */
function uniquePids(value) {
  /** @type {number[]} */
  const pids = []
  for (const match of String(value ?? '').matchAll(/\d+/g)) {
    const pid = Number(match[0])
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid > MAX_PID || pids.includes(pid)) continue
    pids.push(pid)
  }
  return pids
}

/**
 * Build the argv of one logcat read.
 *
 * The array is exposed to the tests only through the fake `adb`, so its word
 * order is part of the provider's contract: a `--pid` filter belongs between
 * `-d` and `-v`, where the tests can see it and `logcat` accepts it.
 *
 * @param {string} adb - the resolved `adb`.
 * @param {string} serial - the target device serial.
 * @param {number} lines - the tail size.
 * @param {string[]} [filters] - extra filters, e.g. `--pid=100`.
 * @returns {string[]} the argv vector.
 */
function logcatArgs(adb, serial, lines, filters = []) {
  return [adb, '-s', serial, 'logcat', '-d', ...filters, '-v', 'time', '-t', String(lines)]
}

/**
 * Keep the tail lines whose `-v time` PID is one of `pids`.
 *
 * `-v time` names the process as `I/Tag( 1234): message`; `-v threadtime`
 * prints the PID and TID as their own columns. Both shapes are understood so
 * the fallback works whichever format the ROM emits.
 *
 * @param {string} value - the unfiltered tail.
 * @param {number[]} pids - the PIDs to keep.
 * @returns {string} the selected lines.
 */
function filterByPid(value, pids) {
  const wanted = new Set(pids)
  return logLines(value)
    .filter((line) => {
      const pid = linePid(line)
      return pid !== undefined && wanted.has(pid)
    })
    .join('\n')
}

/**
 * Keep the tail lines that name the application id.
 *
 * This is the honest old behaviour, kept only for the no-PID case: it finds
 * system lines about the app and the app's own lines only when the app tags
 * them with its id.
 *
 * @param {string} value - the unfiltered tail.
 * @param {string} app - the application id.
 * @returns {string} the selected lines.
 */
function filterByText(value, app) {
  return logLines(value)
    .filter((line) => line.includes(app))
    .join('\n')
}

/**
 * The PID a `logcat` line names, when the line carries one.
 *
 * @param {string} line - one logcat line.
 * @returns {number|undefined} the PID, or `undefined` when the line has none.
 */
function linePid(line) {
  const tagged = /\(\s*(\d+)\s*\)\s*:/.exec(line)
  if (tagged) return Number(tagged[1])
  const threaded = /^\S+\s+\S+\s+(\d+)\s+\d+\s+[A-Z]\s/.exec(line)
  if (threaded) return Number(threaded[1])
  return undefined
}

/**
 * Split rendered log text into lines, without the trailing blank line.
 *
 * @param {string} value - the log text.
 * @returns {string[]} the lines; empty for empty text.
 */
function logLines(value) {
  const text = String(value ?? '')
  if (text.length === 0) return []
  return text.replace(/\r?\n$/, '').split(/\r?\n/)
}

/**
 * How many log lines a rendered result carries.
 *
 * The truncation marker is not a log line, so it does not count; a partial last
 * line does, because it is what the caller received.
 *
 * @param {string} value - the rendered output.
 * @returns {number} the line count.
 */
function lineTotal(value) {
  const body = String(value).replace(/\r?\n\.\.\.\[truncated \d+ characters\]$/, '')
  if (body.length === 0) return 0
  return body.replace(/\r?\n$/, '').split(/\r?\n/).length
}

/**
 * Truncate rendered log text with an explicit marker.
 *
 * `limit` is always a positive integer by the time it arrives here; the
 * clamping lives in {@link renderLimit} so a caller cannot switch the ceiling
 * off with a zero.
 *
 * @param {string} value - the rendered log text.
 * @param {number} limit - how many characters to keep.
 * @returns {string} the text, shortened when it exceeds the limit.
 */
function truncate(value, limit) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n...[truncated ${value.length - limit} characters]`
}
