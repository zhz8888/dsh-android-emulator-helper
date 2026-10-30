import { ensureDevice } from './avd.js'
import { adbShell, pickDevice } from './device.js'
import { findTool } from './sdk.js'

/**
 * UI automation through `uiautomator dump` and `adb input`.
 *
 * Ported from the ZCode plugin's `providers/ui.ts`. The UI Automator XML is
 * flattened into one record per node, keeping only the attributes a caller can
 * act on — a full DOM would be far larger than the model can use.
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
 * Named key events the tool exposes.
 *
 * The names are the tool's key-event enum and its order is frozen by the
 * upstream plugin, so neither may be rearranged.
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
 * Report whether the UI automation backend is usable.
 *
 * `adb` being on the host says nothing about the device: UI automation needs a
 * ready device and the device-side `uiautomator` binary, and the reported
 * `available` used to be `Boolean(adb)` — so a host with no device, or a device
 * that does not ship the binary, was told the backend worked until the first
 * `android_ui_describe` failed. The device is therefore selected first and the
 * binary probed on it; the result reports what was actually found and why the
 * backend is unavailable otherwise.
 *
 * `adbInput` stays tied to the ready device: `adb shell input` is the device's
 * own command, so it remains usable when `uiautomator` is missing.
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
 * Whether the device ships one command, as its own shell reports it.
 *
 * `which` is the usual answer, but a minimal or very old shell may not have
 * it; `command -v` is the POSIX fallback and costs one extra round trip only
 * when the first probe found nothing. A non-zero exit and an empty answer are
 * the same "not there" to this caller.
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
 * Dump the current screen's UI Automator tree.
 *
 * `uiautomator dump` reports success by exit code even when it wrote nothing
 * (a null root node is a common cause and still exits 0), and the dump path is
 * persistent. Dumping to one fixed path and reading it back therefore has a
 * silent failure mode: a failed dump leaves the PREVIOUS file in place, and the
 * caller is handed a stale screen as if it were current.
 *
 * The dump therefore goes to a path unique to this call, which both removes the
 * staleness (nothing to read means an empty tree, not the last one) and lets two
 * concurrent callers stop racing on one shared file. The file is removed again
 * so repeated calls do not accumulate on the device.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{serial?: string, avd?: string, timeoutMs?: number}} [input] - the tool arguments.
 * @returns {Promise<{device: DeviceRecord, elements: UiElement[]}>} the device and its flattened elements.
 */
export async function describe(rt, input = {}) {
  const device = await ensureDevice(rt, input)
  const timeout = input.timeoutMs ?? 30_000
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
      if (dumpUnavailable(error)) throw noDumpError(device.serial)
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
      if (missingRemoteFile(error) || dumpUnavailable(error)) throw noDumpError(device.serial)
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

/**
 * Deadline for removing a dump file from the device.
 *
 * Short on purpose: it runs in a `finally`, so when the dump itself wedged the
 * shell is unresponsive and this call would otherwise wait the caller's whole
 * timeout again.
 */
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
  const tree = await describe(rt, input)
  const query = String(input.query ?? '').trim().toLowerCase()
  if (!query) throw new Error('UI query must not be empty.')
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
  const device = await ensureDevice(rt, input)
  const x1 = Math.round(input.x1)
  const y1 = Math.round(input.y1)
  const x2 = Math.round(input.x2)
  const y2 = Math.round(input.y2)
  const durationMs = Math.round(input.durationMs ?? 300)
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
 * Type into the focused control.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{text: string, serial?: string, avd?: string, timeoutMs?: number}} input - the tool arguments.
 * @returns {Promise<object>} the typing report.
 */
export async function typeText(rt, input) {
  const device = await ensureDevice(rt, input)
  const text = inputText(input.text)
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
  const device = await ensureDevice(rt, input)
  const code = KEY_EVENTS[input.key]
  if (!code) throw new Error(`Unsupported Android key: ${input.key}`)
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
 * Whether a dump result is a UI Automator document rather than an error message.
 *
 * @param {string} value - the `cat` result.
 * @returns {boolean} true when the text is a hierarchy document.
 */
function looksLikeDump(value) {
  const text = String(value ?? '').trim()
  if (!text.startsWith('<')) return false
  // An empty hierarchy is still a valid dump; it is the absent document — the
  // `cat` of a file the failed dump never wrote — that must not read as "no UI".
  return /<hierarchy\b/.test(text)
}

/**
 * Whether `uiautomator dump` reported that it did not write a hierarchy.
 *
 * `uiautomator dump` prints its diagnosis to stdout and exits 0 when the screen
 * is not idle ("ERROR: could not get idle state."), so the command's output is
 * the only signal that the dump did not happen. A successful run prints
 * "UI hierchary dumped to: <path>" (the misspelling is the tool's own).
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
 * The one actionable message for every way a UI dump can fail to materialise.
 *
 * @param {string} serial - the device that was asked.
 * @returns {Error} the error to throw.
 */
function noDumpError(serial) {
  return new Error(
    `UI Automator produced no dump for ${serial}. The screen may be mid-transition, or a secure window is in front. Retry once the app has settled.`,
  )
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
 * Whether a device-shell failure means "the dump did not arrive".
 *
 * `adbShell` marks every command failure with the record's exit `code`, and a
 * timeout additionally with `timed`. Any of those answers describes a command
 * that ran and did not produce a dump: the deadline passed, the device-side
 * process exited non-zero, or it was killed by a signal (a `code` of 137 is a
 * device-side SIGKILL, which arrives with no timeout at all).
 *
 * The distinction that matters is the other one: an error *without* either
 * marker is not a failed command but a failure to run one — no such device, adb
 * missing — and retrying the dump cannot fix it, so the caller must see it.
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
 * Escape text for `adb shell input text`, which uses `%s` for spaces.
 *
 * `input text` is a small custom parser, not a URL decoder: the ONLY escape it
 * understands is `%s` for a space. Percent signs pass through unchanged, so
 * replacing them with `%25` does not protect anything — the device types the
 * four literal characters and the caller's text comes back corrupted.
 *
 * The residual limitation is the mirror image: a literal `%s` in the caller's
 * text cannot be represented, because the device reads it as a space. That is
 * documented rather than worked around, since escaping it is impossible.
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
 * Decode the XML entities UI Automator emits.
 *
 * UI Automator's serializer writes non-ASCII and whitespace as numeric
 * character references in attribute values — a multi-line `EditText`'s text
 * arrives as `line one&#10;line two` — so only decoding the five named
 * entities left literal `&#10;` in the text a caller then fails to match. Both
 * decimal (`&#NN;`) and hexadecimal (`&#xHH;`) references are decoded, in that
 * numeric order, with the named entities after them and `&amp;` last: decoding
 * `&amp;` first would turn a literal `&amp;#10;` into a newline.
 *
 * A reference outside Unicode, or one naming a surrogate code point, is left
 * as written rather than replaced with a replacement character, so malformed
 * input is visible instead of silently mangled.
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
