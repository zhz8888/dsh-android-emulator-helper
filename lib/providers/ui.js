import { ensureDevice } from './avd.js'
import { adbShell, pickDevice } from './device.js'
import { findTool } from './sdk.js'

/**
 * UI automation through `uiautomator dump` and `adb input`. Ported from the
 * ZCode plugin's `providers/ui.ts`; XML is flattened to one record per node,
 * keeping only actionable attributes (a full DOM is too large for the model).
 *
 * @module @zhz8888/dsh-android-emulator-helper/providers/ui
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
 * The named key events, with the keycode each one sends.
 *
 * @typedef {{
 *   BACK: 'KEYCODE_BACK',
 *   HOME: 'KEYCODE_HOME',
 *   ENTER: 'KEYCODE_ENTER',
 *   APP_SWITCH: 'KEYCODE_APP_SWITCH',
 *   MENU: 'KEYCODE_MENU',
 *   SEARCH: 'KEYCODE_SEARCH',
 * }} KeyEventMap
 */

/**
 * Named key events. The names and their order are the upstream plugin's frozen
 * enum and may not be rearranged.
 *
 * @type {KeyEventMap}
 */
export const KEY_EVENTS = {
  BACK: 'KEYCODE_BACK',
  HOME: 'KEYCODE_HOME',
  ENTER: 'KEYCODE_ENTER',
  APP_SWITCH: 'KEYCODE_APP_SWITCH',
  MENU: 'KEYCODE_MENU',
  SEARCH: 'KEYCODE_SEARCH',
}

/**
 * The rectangle one UI Automator node occupies.
 *
 * @typedef {object} UiBounds
 * @property {number} left - the left edge, in device pixels.
 * @property {number} top - the top edge, in device pixels.
 * @property {number} right - the right edge, in device pixels.
 * @property {number} bottom - the bottom edge, in device pixels.
 * @property {number} centerX - the horizontal centre, rounded.
 * @property {number} centerY - the vertical centre, rounded.
 */

/**
 * One flattened UI Automator node.
 *
 * @typedef {object} UiElement
 * @property {number} index - the node's position in the flattened tree.
 * @property {string|undefined} text - the visible text, when the node has one.
 * @property {string|undefined} contentDescription - the content description, when set.
 * @property {string|undefined} resourceId - the resource id, when set.
 * @property {string|undefined} className - the widget class, when set.
 * @property {UiBounds|undefined} bounds - the node's rectangle, when the dump carried one.
 * @property {boolean} clickable - whether the node accepts a tap.
 * @property {boolean} enabled - whether the node is enabled.
 */

/** Longest text `adb input text` accepts before the plugin refuses. */
const MAX_INPUT_TEXT_LENGTH = 1000

/**
 * Report whether UI automation is usable. `available` was once just
 * `Boolean(adb)`; it now selects a ready device and probes its `uiautomator`
 * binary. `adbInput` tracks the device's own `input` command, usable even
 * without uiautomator.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<object>} backend availability, named the same way the original reported it.
 */
export async function status(rt) {
  const adb = await findTool(rt, 'adb')
  if (!adb) {
    return {
      backend: 'adb-uiautomator',
      adb: undefined,
      adbInput: false,
      uiAutomator: false,
      available: false,
      implementedBackends: [],
      reason: 'adb is not installed or not on PATH. Run android_preflight for setup details.',
    }
  }
  /** @type {DeviceRecord} */
  let device
  try {
    device = await pickDevice(rt)
  } catch (error) {
    // No device is a reportable state of the backend, not a failure of the
    // report: `android_ui_status` must answer instead of throwing.
    const detail = error instanceof Error ? error.message : String(error)
    return {
      backend: 'adb-uiautomator',
      adb,
      adbInput: false,
      uiAutomator: false,
      available: false,
      implementedBackends: [],
      reason: `No ready Android device, so no device-side UI automation was observed: ${detail}`,
    }
  }
  const uiAutomator = await hasDeviceCommand(rt, device.serial, 'uiautomator')
  return {
    backend: 'adb-uiautomator',
    adb,
    adbInput: true,
    uiAutomator,
    // `available` means the named backend can run a dump, which is what the
    // caller is about to ask for; `adbInput` still says whether plain input
    // commands work on this device.
    available: uiAutomator,
    implementedBackends: uiAutomator ? ['uiautomator', 'adb-input'] : ['adb-input'],
    ...(uiAutomator
      ? {}
      : {
          reason:
            `The device-side uiautomator binary was not found on ${device.serial}. ` +
            'android_ui_describe and android_ui_resolve are unavailable; the adb input tools (tap, swipe, type, key) still work.',
        }),
  }
}

/**
 * Whether the device ships one command. Tries `which`, then the POSIX
 * `command -v` fallback for minimal shells; non-zero or empty means absent.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} serial - the target device serial.
 * @param {string} name - the command to look for.
 * @returns {Promise<boolean>} true when the device resolved the command.
 */
async function hasDeviceCommand(rt, serial, name) {
  for (const args of [['which', name], ['command', '-v', name]]) {
    const probe = await adbShell(rt, serial, args, 10_000).catch(() => undefined)
    if (probe !== undefined && probe.stdout.trim().length > 0) return true
  }
  return false
}

/**
 * Dump the current screen's UI Automator tree. Uses a per-call unique path: a
 * fixed path could leave the previous dump in place (the tool exits 0 even when
 * it writes nothing) and hand back a stale screen.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{serial?: string, avd?: string, timeoutMs?: number}} [input] - the tool arguments.
 * @returns {Promise<{device: DeviceRecord, elements: UiElement[]}>} the device and its flattened elements.
 */
export async function describe(rt, input = {}) {
  const device = await ensureDevice(rt, input)
  const timeout = input.timeoutMs ?? 30_000
  // The device-side dump is a singleton, so two dumps on the same device take
  // turns; the lock is per serial, so a second device is never held up by the
  // first.
  return serialiseDump(device.serial, () => dumpScreen(rt, device, timeout))
}

/**
 * Dumps currently running, one entry per serial. `uiautomator dump` is a
 * device singleton — a second dump ends the first (loser sees adb exit 137) —
 * so same-device dumps are serialised while different devices run in parallel.
 *
 * @type {Map<string, Promise<void>>}
 */
const dumpLocks = new Map()

/**
 * Run one task after the task already running on that device has finished.
 *
 * @template T
 * @param {string} serial - the device serial the task belongs to.
 * @param {() => Promise<T>} task - the work to run.
 * @returns {Promise<T>} the task's result.
 */
async function serialiseDump(serial, task) {
  const previous = dumpLocks.get(serial)
  // The entry never rejects, so the task runs whether the dump before it
  // succeeded or failed.
  const chain = (previous ?? Promise.resolve()).then(task, task)
  const settled = chain.then(
    () => undefined,
    () => undefined,
  )
  dumpLocks.set(serial, settled)
  try {
    return await chain
  } finally {
    // The entry goes with the LAST dump on that device, so the map cannot grow
    // with the serials a long-lived host has ever seen.
    if (dumpLocks.get(serial) === settled) dumpLocks.delete(serial)
  }
}

/**
 * Take one screen dump, and try once more when another dump ended this one.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {DeviceRecord} device - the device to dump.
 * @param {number} timeout - the dump deadline, in milliseconds.
 * @returns {Promise<{device: DeviceRecord, elements: UiElement[]}>} the device and its flattened elements.
 */
async function dumpScreen(rt, device, timeout) {
  try {
    return await dumpOnce(rt, device, timeout)
  } catch (error) {
    // A dump that another dump ended says nothing about the screen, and the
    // dump that ended it has finished by now — the per-serial lock held it —
    // so one more attempt finds the device to itself.
    if (!endedByAnotherDump(error)) throw error
    return await dumpOnce(rt, device, timeout)
  }
}

/**
 * Take one screen dump, on a path of its own.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {DeviceRecord} device - the device to dump.
 * @param {number} timeout - the dump deadline, in milliseconds.
 * @returns {Promise<{device: DeviceRecord, elements: UiElement[]}>} the device and its flattened elements.
 */
async function dumpOnce(rt, device, timeout) {
  const remote = `/sdcard/.dsh-ui-${process.pid}-${Date.now()}-${dumpSeq++}.xml`
  try {
    // Every way the dump command can fail means the same thing to the caller:
    // there is no dump to read. The device-side `uiautomator` has been observed
    // to fail in at least four ways on this image — it wedges until the shell
    // deadline, it exits non-zero, it is SIGKILLed from the device side
    // (`code === 137`, no timeout involved), and it succeeds with an error on
    // stdout while writing nothing. Reporting the raw transport failure for any
    // of them surfaced text like "`<adb> was killed by signal 9`" or "`<adb>
    // timed out with no output`", which names the transport and says nothing
    // about the screen the caller asked for.
    //
    // A failure that is *not* about the dump itself — the device vanished, adb
    // is missing — is still rethrown, because retrying the dump will never make
    // it work and the caller needs the real reason.
    const dump = await adbShell(rt, device.serial, ['uiautomator', 'dump', remote], timeout).catch((error) => {
      if (dumpUnavailable(error)) throw noDumpError(device.serial, error)
      throw error
    })
    // `uiautomator dump` reports its own failure on stdout and still exits 0
    // when the screen is not idle, so the exit code alone cannot be trusted and
    // the dump's output has to be checked before the file is read.
    if (!looksLikeDumpOutput(dump.stdout)) throw noDumpError(device.serial)
    const out = await adbShell(rt, device.serial, ['cat', remote], timeout).catch((error) => {
      // The file is missing whenever the dump did not actually write it. That
      // is the same condition as an unusable dump, and the raw `cat: ...: No
      // such file or directory` names an internal temp path and tells the
      // caller nothing, so it is replaced with the actionable message.
      if (missingRemoteFile(error) || dumpUnavailable(error)) throw noDumpError(device.serial, error)
      throw error
    })
    if (!looksLikeDump(out.stdout)) throw noDumpError(device.serial)
    return { device, elements: parseUiAutomator(out.stdout) }
  } finally {
    // The cleanup gets a short, fixed deadline rather than the caller's: when
    // the dump wedged the shell is unresponsive, and waiting another full
    // `timeout` for a `rm` would double the call's worst case for a file that
    // the next successful dump overwrites anyway.
    await adbShell(rt, device.serial, ['rm', '-f', remote], DUMP_CLEANUP_MS).catch(() => undefined)
  }
}

/** Short cleanup deadline: it runs in `finally`, so a wedged shell does not cost the caller's whole timeout again. */
const DUMP_CLEANUP_MS = 5_000

/** Counter making each dump path unique within this process. */
let dumpSeq = 0

/**
 * Resolve a visible element to tap coordinates.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{query: string, serial?: string, avd?: string, timeoutMs?: number}} input - the tool arguments.
 * @returns {Promise<{device: DeviceRecord, element: UiElement, x: number, y: number}>} the matched element and its centre.
 * @throws When nothing visible matches.
 */
export async function resolve(rt, input) {
  // The query is checked before the screen is dumped: an empty query can never
  // match, so refusing it must not cost a device round trip.
  const query = String(input.query ?? '').trim().toLowerCase()
  if (!query) throw new Error('UI query must not be empty.')
  const tree = await describe(rt, input)
  const hit = tree.elements.find((item) => elementText(item).toLowerCase().includes(query) && item.bounds)
  if (!hit?.bounds) throw new Error(`No visible Android UI element matched: ${input.query}`)
  return { device: tree.device, element: hit, x: hit.bounds.centerX, y: hit.bounds.centerY }
}

/**
 * Tap screen coordinates.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{x: number, y: number, serial?: string, avd?: string, timeoutMs?: number}} input - the tool arguments.
 * @returns {Promise<object>} the tap report.
 */
export async function tap(rt, input) {
  const device = await ensureDevice(rt, input)
  // Report what was sent, not what was asked for: `input tap` takes integers, so
  // a fractional request is rounded on the way out and the caller would
  // otherwise be told a coordinate the device never received.
  const x = Math.round(input.x)
  const y = Math.round(input.y)
  await adbShell(rt, device.serial, ['input', 'tap', String(x), String(y)], input.timeoutMs ?? 30_000)
  return { tapped: true, serial: device.serial, x, y }
}

/**
 * Swipe between two screen coordinates.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{x1: number, y1: number, x2: number, y2: number, durationMs?: number, serial?: string, avd?: string, timeoutMs?: number}} input - the tool arguments.
 * @returns {Promise<object>} the swipe report.
 */
export async function swipe(rt, input) {
  // The duration is refused before the device is contacted: the upstream
  // plugin declared `durationMs` a positive number and refused anything else
  // at its registry, and a zero or negative duration is not a shorter swipe but
  // a different gesture.
  const durationMs = swipeDurationMs(input.durationMs ?? 300)
  const device = await ensureDevice(rt, input)
  const x1 = Math.round(input.x1)
  const y1 = Math.round(input.y1)
  const x2 = Math.round(input.x2)
  const y2 = Math.round(input.y2)
  await adbShell(
    rt,
    device.serial,
    ['input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(durationMs)],
    input.timeoutMs ?? 30_000,
  )
  // `durationMs` is part of the report because it is the one gesture parameter a
  // caller cannot infer from the visible result: a clamped list moves the same
  // distance at every duration, so without it there is no way to confirm which
  // value actually ran.
  return { swiped: true, serial: device.serial, x1, y1, x2, y2, durationMs }
}

/**
 * Validate a swipe duration. The tool schema cannot express a bound, so the
 * provider refuses non-positive values rather than clamp: `0` is a different
 * gesture, not a shorter swipe.
 *
 * @param {number} value - the requested duration.
 * @returns {number} the duration in milliseconds.
 * @throws When the value is not a positive, finite number.
 */
function swipeDurationMs(value) {
  const duration = Math.round(value)
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Swipe durationMs must be a positive number of milliseconds; got ${value}.`)
  }
  return duration
}

/**
 * Type into the focused control.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{text: string, serial?: string, avd?: string, timeoutMs?: number}} input - the tool arguments.
 * @returns {Promise<object>} the typing report.
 */
export async function typeText(rt, input) {
  // The text is escaped and length-checked before the device is resolved: a
  // text this tool cannot type must not start an emulator to carry it.
  const text = inputText(input.text)
  const device = await ensureDevice(rt, input)
  await adbShell(rt, device.serial, ['input', 'text', text], input.timeoutMs ?? 30_000)
  return { typed: true, serial: device.serial, length: input.text.length }
}

/**
 * Press one named key.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{key: keyof typeof KEY_EVENTS, serial?: string, avd?: string, timeoutMs?: number}} input - the tool arguments.
 * @returns {Promise<object>} the key report.
 */
export async function keyevent(rt, input) {
  // The key is resolved to its keycode before the device is resolved, so an
  // unsupported name never starts an emulator to carry it.
  const code = KEY_EVENTS[input.key]
  if (!code) throw new Error(`Unsupported Android key: ${input.key}`)
  const device = await ensureDevice(rt, input)
  await adbShell(rt, device.serial, ['input', 'keyevent', code], input.timeoutMs ?? 30_000)
  return { pressed: true, serial: device.serial, key: input.key }
}

/**
 * Flatten a UI Automator XML dump into actionable elements.
 *
 * @param {string} value - the XML text.
 * @returns {UiElement[]} one record per `<node>`.
 */
export function parseUiAutomator(value) {
  /** @type {UiElement[]} */
  const elements = []
  for (const match of String(value).matchAll(/<node\b([^>]*)\/?>/g)) {
    const attrs = attributes(match[1] ?? '')
    const bounds = parseBounds(attrs.get('bounds') || '')
    elements.push({
      index: elements.length,
      text: empty(attrs.get('text')),
      contentDescription: empty(attrs.get('content-desc')),
      resourceId: empty(attrs.get('resource-id')),
      className: empty(attrs.get('class')),
      bounds,
      clickable: attrs.get('clickable') === 'true',
      enabled: attrs.get('enabled') !== 'false',
    })
  }
  return elements
}

/**
 * Whether a `cat` result is a UI Automator hierarchy document, not an error.
 * An empty hierarchy is valid; a missing document must not read as "no UI".
 *
 * @param {string} value - the `cat` result.
 * @returns {boolean} true when the text is a hierarchy document.
 */
function looksLikeDump(value) {
  const text = String(value ?? '').trim()
  if (!text.startsWith('<')) return false
  // An empty hierarchy is still a valid dump; only an absent document (the
  // cat of a file a failed dump never wrote) must not read as "no UI".
  return /<hierarchy\b/.test(text)
}

/**
 * Whether `uiautomator dump` stdout looks successful. It prints its diagnosis
 * and still exits 0 when the screen is not idle; a success says "UI hierchary
 * dumped to: ..." (the tool's own misspelling).
 *
 * @param {string} value - the dump command's stdout.
 * @returns {boolean} true when the dump looks like it succeeded.
 */
function looksLikeDumpOutput(value) {
  const text = String(value ?? '').trim()
  if (text.length === 0) return true
  return !/^error\b/i.test(text) && !/could not get idle state/i.test(text)
}

/**
 * The actionable error for a dump that did not materialise: a blank/secure
 * screen or another dump ending this one (a mid-transition screen is not a
 * real cause). Attaches `cause` when present.
 *
 * @param {string} serial - the device that was asked.
 * @param {unknown} [cause] - the failure behind it, when there is one.
 * @returns {Error} the error to throw.
 */
function noDumpError(serial, cause) {
  const error = /** @type {Error & {dumpCause?: unknown}} */ (
    new Error(
      `UI Automator produced no dump for ${serial}. ` +
        'The screen may be blank, or a secure window may be in front of it; another dump on the same device can also end the running one. ' +
        'Retry once the app has settled.',
    )
  )
  if (cause !== undefined) error.dumpCause = cause
  return error
}

/**
 * Whether a failed dump was ended by another dump on the device. The victim
 * sees exit 137 with no output (a SIGKILL signature) — a retriable condition
 * that says nothing about the screen.
 *
 * @param {unknown} error - the thrown error.
 * @returns {boolean} true when the failure carries the concurrent-dump signature.
 */
function endedByAnotherDump(error) {
  const cause = /** @type {{dumpCause?: unknown}} */ (error)?.dumpCause
  if (cause === undefined) return false
  const marked = /** @type {{code?: number}} */ (cause)
  // 137 is 128 + SIGKILL: the device killed the dump.
  if (marked?.code === 137) return true
  const message = cause instanceof Error ? cause.message : String(cause)
  // `brief()` describes a record with no output as the process having been
  // killed by a signal, or as an exit that produced nothing at all.
  return /killed by signal/i.test(message) || /exited with code \d+ and no output$/i.test(message)
}

/**
 * Whether a `cat` failure means the remote file was never written.
 *
 * @param {unknown} error - the thrown value from the `cat`.
 * @returns {boolean} true when the device reported a missing file.
 */
function missingRemoteFile(error) {
  const message = error instanceof Error ? error.message : String(error)
  return /No such file or directory|does not exist/i.test(message)
}

/**
 * Whether a device-shell failure means "the dump did not arrive". `adbShell`
 * marks a command that ran with `code` (and `timed` on timeout); an error
 * without either marker is a failure to run one (no device, adb missing) and
 * must reach the caller — retrying cannot fix it.
 *
 * @param {unknown} error - the thrown value from the device shell.
 * @returns {boolean} true when the command ran and failed, rather than not running.
 */
function dumpUnavailable(error) {
  const marked = /** @type {{timed?: boolean, code?: number}} */ (error)
  return marked?.timed === true || typeof marked?.code === 'number'
}

/**
 * Parse the attribute list of one `<node>` tag.
 *
 * @param {string} value - the attribute list.
 * @returns {Map<string, string>} the attributes, decoded.
 */
function attributes(value) {
  /** @type {Map<string, string>} */
  const out = new Map()
  for (const match of String(value).matchAll(/([A-Za-z0-9_-]+)="([^"]*)"/g)) {
    if (match[1]) out.set(match[1], decode(match[2] ?? ''))
  }
  return out
}

/**
 * Parse a UI Automator `[l,t][r,b]` bounds string.
 *
 * @param {string} value - the bounds attribute.
 * @returns {UiBounds|undefined} the rectangle, when the string parsed.
 */
function parseBounds(value) {
  const match = String(value).match(/\[(\d+),(\d+)]\[(\d+),(\d+)]/)
  if (!match) return undefined
  // The pattern has four groups and the match proves it, so every index below
  // is present; `Number` reads them as the digits they are.
  const left = Number(match[1])
  const top = Number(match[2])
  const right = Number(match[3])
  const bottom = Number(match[4])
  return {
    left,
    top,
    right,
    bottom,
    centerX: Math.round((left + right) / 2),
    centerY: Math.round((top + bottom) / 2),
  }
}

/**
 * Escape text for `adb shell input text`, which understands only `%s` for a
 * space. Percent signs pass through unchanged (so `%25` would corrupt text),
 * and a literal `%s` cannot be represented — a documented limitation.
 *
 * @param {string} value - the raw text.
 * @returns {string} the escaped text.
 * @throws When the text is longer than {@link MAX_INPUT_TEXT_LENGTH}.
 */
export function inputText(value) {
  if (typeof value !== 'string') throw new Error('Text input must be a string.')
  if (value.length > MAX_INPUT_TEXT_LENGTH) throw new Error('Text input is too long.')
  return value.replace(/\s/g, '%s')
}

/**
 * Searchable text of one element.
 *
 * @param {UiElement} item - the element.
 * @returns {string} the text a query is matched against.
 */
function elementText(item) {
  return [item.text, item.contentDescription, item.resourceId, item.className].filter(Boolean).join(' ')
}

/**
 * Normalize an empty attribute to `undefined`.
 *
 * @param {string|undefined} value - the attribute value.
 * @returns {string|undefined} the value, or `undefined` when it is empty.
 */
function empty(value) {
  return value && value.length > 0 ? value : undefined
}

/**
 * Decode XML entities in UI Automator attributes. Numeric references
 * (`&#NN;`, `&#xHH;`) come first, named entities next and `&amp;` last (so a
 * literal `&amp;#10;` stays literal); out-of-range/surrogate refs are left as
 * written.
 *
 * @param {string} value - the raw attribute value.
 * @returns {string} the decoded value.
 */
function decode(value) {
  return String(value)
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => numericReference(match, hex, 16))
    .replace(/&#([0-9]+);/g, (match, digits) => numericReference(match, digits, 10))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * Decode one numeric character reference, or leave it alone when unusable.
 *
 * @param {string} match - the whole reference, returned unchanged when invalid.
 * @param {string} digits - the digits of the reference.
 * @param {number} radix - 10 for `&#NN;`, 16 for `&#xHH;`.
 * @returns {string} the decoded character or the original reference.
 */
function numericReference(match, digits, radix) {
  const code = Number.parseInt(digits, radix)
  if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) return match
  if (code >= 0xd800 && code <= 0xdfff) return match
  return String.fromCodePoint(code)
}
