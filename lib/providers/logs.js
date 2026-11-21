import { ensureDevice } from './avd.js'
import { packageName } from './app.js'
import { adbShell } from './device.js'
import { brief, ok, run } from '../util/run.js'
import { androidEnv, requireTool } from './sdk.js'

/**
 * Logcat reads. Clamps the tail to 1..5000 lines and the rendered text to a
 * ceiling (max 200000 chars) to keep a chatty `logcat -d` from flooding the
 * conversation. An `applicationId` filter works by PID (`pidof` + `logcat
 * --pid`), since `-v time` lines name only the PID, not the id; text matching
 * is a labelled fallback.
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
 * How lines were selected: `pid` (device `--pid`), `pid-column` (local PID
 * filter), `text` (best-effort id match), `none`.
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
 * Clamp a requested line count to what `logcat -t` accepts; non-finite values
 * fall back to the default tail.
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
 * Clamp a character ceiling to a positive, bounded value. `0`/negative must
 * not mean "no ceiling" (that is how a caller asks for the opposite); such
 * values fall back to the default, larger ones to {@link MAX_RENDER_LIMIT}.
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
 * Read the most recent logcat output. `lines` is the requested tail,
 * `returnedLines` is what the result actually carries after filtering/truncation.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{applicationId?: string, lines?: number, limit?: number, serial?: string, avd?: string, timeoutMs?: number}} [input] - the tool arguments.
 * @returns {Promise<{device: DeviceRecord, applicationId: string|undefined, lines: number, returnedLines: number, output: string, pids?: number[], filter?: LogFilter, note?: string}>} the selected output and the device it came from.
 */
export async function logs(rt, input = {}) {
  // The id is validated before the device is resolved: a malformed id must not
  // start an emulator to carry it, and the validation error is the caller's
  // answer, not a device's.
  const app = input.applicationId ? packageName(input.applicationId) : undefined
  const device = await ensureDevice(rt, input)
  const adb = await requireTool(rt, 'adb')
  // `Math.max(1, Math.min(NaN, 5000))` is NaN, and `String(NaN)` reaches adb as
  // `-t NaN`. The registry's `integer` schema already refuses that from the
  // model, so this is defence in depth for a programmatic caller.
  const lines = lineCount(input.lines ?? rt.settings.logTailLines)
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
 * Read one app's logcat tail by PID. `-v time` lines name only the PID, so
 * text matching missed the app's lines. Tries device `--pid` first, then a
 * local PID-column filter, then labelled text matching if no process runs.
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
 * The PIDs the device reports for one application. `pidof` missing or finding
 * nothing is a fallback condition, not a failure, so it is swallowed here; a
 * real device failure still surfaces from the later `logcat` read.
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
 * Extract plausible PIDs from `pidof` output, ignoring non-PID tokens (a
 * "pidof: not found" shell error must not become `[NaN]` in `--pid`).
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
 * Build the argv of one logcat read. `--pid` goes between `-d` and `-v` —
 * accepted by logcat and visible to the fake-adb tests.
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
 * Keep tail lines whose PID is in `pids`, understanding both `-v time`
 * (`I/Tag( 1234):`) and `-v threadtime` (PID/TID columns) formats.
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
 * Keep tail lines naming the application id — the old best-effort behaviour,
 * used only when no PID is running.
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
 * Count log lines in a rendered result: the truncation marker is excluded, a
 * partial last line counts.
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
 * Truncate rendered log text with an explicit `...[truncated N characters]`
 * marker. `limit` is guaranteed positive by {@link renderLimit}.
 *
 * @param {string} value - the rendered log text.
 * @param {number} limit - how many characters to keep.
 * @returns {string} the text, shortened when it exceeds the limit.
 */
function truncate(value, limit) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n...[truncated ${value.length - limit} characters]`
}
