/**
 * Model-facing content projection for the plugin's tools.
 *
 * A DSH tool body returns a JSON *value*; the model sees what the tool's
 * `output.render(args, value)` returns. Every Android operation produces the
 * same shape of answer — a structured record the user can also read — so one
 * helper renders them all and a second one adds an image block when a
 * screenshot could be admitted.
 *
 * @module @zhz8888/dsh-android-emulator-helper/util/content
 */

/** Hard cap on one rendered tool result, so a runaway logcat cannot flood the model. */
export const DEFAULT_TEXT_LIMIT = 24_000

/**
 * Render a JSON value as one pretty-printed text block.
 *
 * @param {unknown} value - any lossless JSON value.
 * @param {number} [limit] - maximum rendered characters.
 * @returns {Array<{type: 'text', text: string}>} a one-block content array.
 */
export function textContent(value, limit = DEFAULT_TEXT_LIMIT) {
  return [{ type: 'text', text: truncate(JSON.stringify(value, null, 2), limit) }]
}

/**
 * Render a value plus a durable image attachment reference.
 *
 * The attachment service is the only supported source of a canonical image
 * block, so the caller saves the bytes first and passes the returned reference
 * here. When the deployment admitted no image, callers fall back to
 * {@link textContent} and the on-disk path stays in the value.
 *
 * @param {unknown} value - the structured record, minus the base64 payload.
 * @param {unknown} attachment - a durable reference from `attachments.saveImages`.
 * @returns {Array<{type: 'text'|'image', [key: string]: unknown}>} content blocks.
 */
export function imageContent(value, attachment) {
  return [...textContent(value), { type: 'image', attachment }]
}

/**
 * Project a provider result into the harness' lossless-JSON value domain.
 *
 * A tool body returns a *value*, and the registry snapshots it with
 * `snapshotJsonValue`, which rejects `undefined` outright. Every ported
 * provider models an absent field as `undefined` — a device without a `model`
 * attribute, a Node without `bounds`, a discovery report with no Gradle root, a
 * build that produced no APK. Without this projection those perfectly ordinary
 * results are reported as "returned invalid output", so the normalization lives
 * on the one path every tool result travels.
 *
 * `undefined` object properties are dropped (rather than nulled) so an absent
 * attribute stays absent in the model's view, and non-finite numbers become
 * `null` because `NaN` and `Infinity` have no JSON representation either.
 *
 * The return type stays `unknown` on purpose. The projection erases exactly
 * the values JSON cannot carry — `undefined`, `NaN`, `Infinity` — and
 * stringifies the ones it cannot represent at all, so the result is a JSON
 * value *by construction* rather than by declaration. Naming a `JsonValue`
 * type here would claim a guarantee the function cannot make statically: the
 * input is `unknown`, so every property it copies is `unknown` too, and the
 * claim would have to be bought with a cast.
 *
 * @param {unknown} value - any provider result.
 * @returns {unknown} a value the registry accepts as lossless JSON.
 */
export function toLosslessJson(value) {
  if (value === undefined) return null
  if (value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((item) => toLosslessJson(item))
  if (typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue
      out[key] = toLosslessJson(item)
    }
    return out
  }
  // Functions, symbols and bigints cannot appear in a provider result; a
  // string keeps the failure visible instead of silently dropping the field.
  return String(value)
}

/**
 * Truncate `value` to `limit` characters with an explicit marker.
 *
 * @param {unknown} value - the text to truncate.
 * @param {number} [limit] - the character budget.
 * @returns {string} the truncated text.
 */
export function truncate(value, limit = DEFAULT_TEXT_LIMIT) {
  const text = String(value)
  if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) return text
  return `${text.slice(0, limit)}\n...[truncated ${text.length - limit} characters]`
}
