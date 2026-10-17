import { ensureDevice } from './avd.js'
import { adbShell } from './device.js'
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

/** Named key events the tool exposes. */
export const KEY_EVENTS = {
  BACK: 'KEYCODE_BACK',
  HOME: 'KEYCODE_HOME',
  ENTER: 'KEYCODE_ENTER',
  APP_SWITCH: 'KEYCODE_APP_SWITCH',
  MENU: 'KEYCODE_MENU',
  SEARCH: 'KEYCODE_SEARCH',
}

/** Longest text `adb input text` accepts before the plugin refuses. */
const MAX_INPUT_TEXT_LENGTH = 1000

/**
 * Report whether the UI automation backend is usable.
 *
 * @param {object} rt - the call runtime.
 * @returns {Promise<object>} backend availability, named the same way the original reported it.
 */
export async function status(rt) {
  const adb = await findTool(rt, 'adb')
  const adbAvailable = Boolean(adb)
  return {
    backend: 'adb-uiautomator',
    adb,
    adbInput: adbAvailable,
    uiAutomator: adbAvailable,
    available: adbAvailable,
    implementedBackends: adbAvailable ? ['uiautomator', 'adb-input'] : [],
  }
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
 * @param {object} rt - the call runtime.
 * @param {{serial?: string, avd?: string, timeoutMs?: number}} [input] - the tool arguments.
 * @returns {Promise<{device: object, elements: Array<object>}>} the device and its flattened elements.
 */
export async function describe(rt, input = {}) {
  const device = await ensureDevice(rt, input)
  const timeout = input.timeoutMs ?? 30_000
  const remote = `/sdcard/.dsh-ui-${process.pid}-${Date.now()}-${dumpSeq++}.xml`
  try {
    await adbShell(rt, device.serial, ['uiautomator', 'dump', remote], timeout)
    const out = await adbShell(rt, device.serial, ['cat', remote], timeout)
    if (!looksLikeDump(out.stdout)) {
      // Reported rather than answered with an empty tree: "no elements" is a
      // legitimate screen, so silently returning it would let a failed dump pass
      // for an empty UI and send the caller looking for a bug in its own query.
      throw new Error(
        `UI Automator produced no dump for ${device.serial}. The screen may be mid-transition, or a secure window is in front. Retry once the app has settled.`,
      )
    }
    return { device, elements: parseUiAutomator(out.stdout) }
  } finally {
    await adbShell(rt, device.serial, ['rm', '-f', remote], timeout).catch(() => undefined)
  }
}

/** Counter making each dump path unique within this process. */
let dumpSeq = 0

/**
 * Resolve a visible element to tap coordinates.
 *
 * @param {object} rt - the call runtime.
 * @param {{query: string, serial?: string, avd?: string, timeoutMs?: number}} input - the tool arguments.
 * @returns {Promise<{device: object, element: object, x: number, y: number}>} the matched element and its centre.
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
 * @param {object} rt - the call runtime.
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
 * @param {object} rt - the call runtime.
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
 * @param {object} rt - the call runtime.
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
 * @param {object} rt - the call runtime.
 * @param {{key: keyof KEY_EVENTS, serial?: string, avd?: string, timeoutMs?: number}} input - the tool arguments.
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
 * @returns {Array<object>} one record per `<node>`.
 */
export function parseUiAutomator(value) {
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

/** Whether a dump result is a UI Automator document rather than an error message. */
function looksLikeDump(value) {
  const text = String(value ?? '').trim()
  if (!text.startsWith('<')) return false
  // An empty hierarchy is still a valid dump; it is the absent document — the
  // `cat` of a file the failed dump never wrote — that must not read as "no UI".
  return /<hierarchy\b/.test(text)
}

/** Parse the attribute list of one `<node>` tag. */
function attributes(value) {
  const out = new Map()
  for (const match of String(value).matchAll(/([A-Za-z0-9_-]+)="([^"]*)"/g)) {
    if (match[1]) out.set(match[1], decode(match[2] ?? ''))
  }
  return out
}

/** Parse a UI Automator `[l,t][r,b]` bounds string. */
function parseBounds(value) {
  const match = String(value).match(/\[(\d+),(\d+)]\[(\d+),(\d+)]/)
  if (!match) return undefined
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

/** Searchable text of one element. */
function elementText(item) {
  return [item.text, item.contentDescription, item.resourceId, item.className].filter(Boolean).join(' ')
}

/** Normalize an empty attribute to `undefined`. */
function empty(value) {
  return value && value.length > 0 ? value : undefined
}

/** Decode the five XML entities UI Automator emits. */
function decode(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
