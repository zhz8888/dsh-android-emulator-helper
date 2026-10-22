import { spawn as spawnChild } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { insideForWrite, rel } from '../util/path.js'
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
 * Stream one raw PNG through `adb exec-out screencap -p`.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} serial - the target device serial.
 * @param {number} timeoutMs - how long the capture may take.
 * @returns {Promise<Buffer>} the PNG bytes.
 */
async function screencap(rt, serial, timeoutMs) {
  const adb = await requireTool(rt, 'adb')
  const env = await androidEnv(rt)
  const child = spawnChild(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], {
    env: Object.fromEntries(Object.entries({ ...rt.env, ...env }).filter((item) => typeof item[1] === 'string')),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let timed = false
  /** @type {Error|undefined} */
  let spawnError
  const timer = setTimeout(() => {
    timed = true
    child.kill('SIGTERM')
  }, timeoutMs)
  const out = collectBuffer(child.stdout)
  const err = collectText(child.stderr)

  const code = await new Promise(
    /** @param {(value: number) => void} resolve */
    (resolve) => {
      let settled = false
      /** @param {number} exitCode */
      const settle = (exitCode) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(exitCode)
      }
      child.once('error', (error) => {
        spawnError = error instanceof Error ? error : new Error(String(error))
        settle(127)
      })
      child.once('close', (exitCode) => settle(exitCode ?? 1))
    },
  )

  if (code !== 0 || timed) {
    const stderr = [await err, spawnError?.message].filter(Boolean).join('\n').trim()
    throw new Error(stderr || `screencap failed with exit ${code}${timed ? ' after timeout' : ''}`)
  }
  return out
}

/**
 * Buffer one stream as raw bytes.
 *
 * The stream is a `Readable` and its chunks are whatever the process wrote, so
 * they are handled one by one rather than assumed to be Buffers.
 *
 * @param {import('node:stream').Readable|null} stream - the stream to drain.
 * @returns {Promise<Buffer>} the bytes.
 */
async function collectBuffer(stream) {
  if (!stream) return Buffer.alloc(0)
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks)
}

/**
 * Buffer one stream as UTF-8 text.
 *
 * @param {import('node:stream').Readable|null} stream - the stream to drain.
 * @returns {Promise<string>} the decoded text.
 */
async function collectText(stream) {
  return (await collectBuffer(stream)).toString('utf8')
}

/**
 * Filesystem-safe timestamp for log names.
 *
 * @returns {string} the timestamp.
 */
function stamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-')
}
