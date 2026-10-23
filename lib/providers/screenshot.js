import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { insideForWrite, rel } from '../util/path.js'
import { ok, runBytes } from '../util/run.js'
import { ensureDevice } from './avd.js'
import { androidEnv, requireTool } from './sdk.js'

/**
 * Device screenshots.
 *
 * Ported from the ZCode plugin's `providers/screenshot.ts`. `adb exec-out` is
 * used rather than `adb shell screencap` plus a pull, because `exec-out` streams
 * raw bytes: a shell round-trip would corrupt the PNG through CRLF translation.
 *
 * The provider returns the base64 payload separately from the report so the
 * tool layer can hand the bytes to the attachment service for a canonical image
 * block, instead of putting megabytes of base64 into the model's text.
 *
 * @module @zhz8888/dsh-android-emulator-helper/providers/screenshot
 */

/**
 * The runtime the screenshot provider reads.
 *
 * @typedef {import('../runtime.js').Runtime} Runtime
 */

/**
 * One device or emulator, as `adb devices -l` reports it.
 *
 * @typedef {import('./device.js').DeviceRecord} DeviceRecord
 */

/**
 * The eight bytes every PNG starts with.
 *
 * Used to find where the image begins inside the stream `adb exec-out` hands
 * back, because the device's own chatter is not separated from it.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Capture the device screen to a file.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{path?: string, serial?: string, avd?: string, timeoutMs?: number}} [input] - the tool arguments.
 * @returns {Promise<{device: DeviceRecord, path: string, absolutePath: string, bytes: number, data: string}>} the capture.
 */
export async function shot(rt, input = {}) {
  const device = await ensureDevice(rt, input)
  const file = input.path
    ? await insideForWrite(rt.cwd, input.path)
    : path.join(await rt.screenshots(), `${stamp()}-${fileSafe(device.serial)}.png`)
  await mkdir(path.dirname(file), { recursive: true })
  const bytes = await screencap(rt, device.serial, input.timeoutMs ?? 30_000)
  await writeFile(file, bytes)
  return {
    device,
    path: rel(rt.cwd, file),
    absolutePath: file,
    bytes: bytes.byteLength,
    data: Buffer.from(bytes).toString('base64'),
  }
}

/**
 * A device serial reduced to characters every supported filesystem accepts.
 *
 * A TCP/Wi-Fi serial is `host:port`, and `:` is illegal in a Windows filename,
 * so the default screenshot name must not carry the raw serial.
 *
 * @param {string} serial - the device serial.
 * @returns {string} a filesystem-safe name fragment.
 */
export function fileSafe(serial) {
  return String(serial).replaceAll(/[^A-Za-z0-9._-]/g, '_')
}

/**
 * Extract the PNG payload from a `screencap` stream.
 *
 * The device-side `screencap` writes its own diagnostics to stdout, and
 * `adb exec-out` forwards that stdout unchanged, so the buffer is not
 * guaranteed to start with the image. A device with more than one display
 * prints, before the PNG:
 *
 *     [Warning] Multiple displays were found, but no display id was specified!
 *     ...
 *
 * Writing that preamble to disk produced a `.png` that no image tool could
 * open, while the tool still reported success. Locating the signature is
 * transport-agnostic and needs no device-specific knowledge of display ids.
 *
 * @param {Buffer} bytes - everything the child wrote to stdout.
 * @returns {Buffer} the PNG payload.
 * @throws When the stream contains no PNG at all.
 */
export function pngPayload(bytes) {
  const start = bytes.indexOf(PNG_SIGNATURE)
  if (start === -1) throw new Error('screencap produced no PNG image data')
  return bytes.subarray(start)
}

/**
 * Stream one raw PNG through `adb exec-out screencap -p`.
 *
 * This goes through {@link runBytes} rather than spawning adb itself. A
 * hand-rolled spawn here previously missed the timeout escalation and the
 * bounded drain that `lib/util/run.js` provides, so an adb client that ignored
 * `SIGTERM` left the tool call pending forever.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} serial - the target device.
 * @param {number} timeoutMs - how long the capture may take.
 * @returns {Promise<Buffer>} the PNG bytes.
 */
async function screencap(rt, serial, timeoutMs) {
  const adb = await requireTool(rt, 'adb')
  const out = await runBytes([adb, '-s', serial, 'exec-out', 'screencap', '-p'], {
    timeout: timeoutMs,
    env: await androidEnv(rt),
  })
  if (!ok(out)) {
    const detail = [out.stderr.trim(), out.timed ? `screencap timed out after ${timeoutMs}ms` : '']
      .filter(Boolean)
      .join('\n')
    throw new Error(detail || `screencap failed with exit ${out.code}`)
  }
  return pngPayload(out.bytes)
}

/**
 * Filesystem-safe timestamp for log names.
 *
 * @returns {string} the timestamp.
 */
function stamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-')
}
