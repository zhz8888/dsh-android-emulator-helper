import { spawn as spawnChild } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { inside, rel } from '../util/path.js'
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
 * Capture the device screen to a file.
 *
 * @param {object} rt - the call runtime.
 * @param {{path?: string, serial?: string, avd?: string, timeoutMs?: number}} [input] - the tool arguments.
 * @returns {Promise<{device: object, path: string, absolutePath: string, bytes: number, data: string}>} the capture.
 */
export async function shot(rt, input = {}) {
  const device = await ensureDevice(rt, input)
  const file = input.path
    ? inside(rt.cwd, input.path)
    : path.join(await rt.screenshots(), `${stamp()}-${device.serial}.png`)
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

/** Stream one raw PNG through `adb exec-out screencap -p`. */
async function screencap(rt, serial, timeoutMs) {
  const adb = await requireTool(rt, 'adb')
  const env = await androidEnv(rt)
  const child = spawnChild(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], {
    env: Object.fromEntries(Object.entries({ ...rt.env, ...env }).filter((item) => typeof item[1] === 'string')),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let timed = false
  let spawnError
  const timer = setTimeout(() => {
    timed = true
    child.kill('SIGTERM')
  }, timeoutMs)
  const out = collectBuffer(child.stdout)
  const err = collectText(child.stderr)

  const code = await new Promise((resolve) => {
    let settled = false
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
  })

  if (code !== 0 || timed) {
    const stderr = [await err, spawnError?.message].filter(Boolean).join('\n').trim()
    throw new Error(stderr || `screencap failed with exit ${code}${timed ? ' after timeout' : ''}`)
  }
  return out
}

/** Buffer one stream as raw bytes. */
async function collectBuffer(stream) {
  if (!stream) return Buffer.alloc(0)
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks)
}

/** Buffer one stream as UTF-8 text. */
async function collectText(stream) {
  return (await collectBuffer(stream)).toString('utf8')
}

/** Filesystem-safe timestamp. */
function stamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-')
}
