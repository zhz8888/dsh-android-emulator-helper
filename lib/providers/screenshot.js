import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { insideForWrite, rel } from '../util/path.js'
import { ok, runBytes } from '../util/run.js'
import { ensureDevice } from './avd.js'
import { androidEnv, requireTool } from './sdk.js'

/**
 * Device screenshots. Uses `adb exec-out` (raw bytes, no CRLF corruption) and
 * returns the base64 payload separately so the tool layer can attach it as an
 * image instead of putting megabytes into the text report.
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

/** The eight bytes every PNG starts with; used to locate the image inside an `adb exec-out` stream that also carries device chatter. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Capture the device screen to a file.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{path?: string, serial?: string, avd?: string, timeoutMs?: number}} [input] - the tool arguments.
 * @returns {Promise<{device: DeviceRecord, path: string, absolutePath: string, bytes: number, data: string}>} the capture.
 */
export async function shot(rt, input = {}) {
  // The output path is resolved before the device is: a path that escapes the
  // workspace must be refused without starting an emulator to capture into it.
  const requested = input.path ? await insideForWrite(rt.cwd, input.path) : undefined
  const device = await ensureDevice(rt, input)
  const file = requested ?? path.join(await rt.screenshots(), `${stamp()}-${fileSafe(device.serial)}.png`)
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
 * Reduce a device serial to a filesystem-safe name fragment. A TCP serial
 * `host:port` carries `:`, illegal in Windows filenames.
 *
 * @param {string} serial - the device serial.
 * @returns {string} a filesystem-safe name fragment.
 */
export function fileSafe(serial) {
  return String(serial).replaceAll(/[^A-Za-z0-9._-]/g, '_')
}

/**
 * Extract the PNG payload from a `screencap` stream. Device diagnostics (e.g. a
 * multi-display warning) can precede the PNG on stdout; scanning for the PNG
 * signature avoids writing a preamble-corrupted file.
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
 * Stream one raw PNG through `adb exec-out screencap -p`. Uses {@link runBytes}
 * so the timeout escalation and bounded drain apply (a hand-rolled spawn once
 * hung on an adb client that ignored SIGTERM).
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
