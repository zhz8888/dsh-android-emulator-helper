import { inside } from '../util/path.js'
import { brief, ok, run } from '../util/run.js'
import { ensureDevice } from './avd.js'
import { adbShell } from './device.js'
import { androidEnv, requireTool } from './sdk.js'

/**
 * App-level device operations: install, launch, force-stop and open a URL.
 *
 * Ported from the ZCode plugin's `providers/app.ts`. The application-id and URL
 * validators are part of the security boundary: both values reach `adb shell`
 * as command words, so a malformed id must be rejected before quoting rather
 * than relied on quoting to contain.
 *
 * @module @zhz8888/dsh-android-emulator-helper/providers/app
 */

/** Dotted Java application ids, as `adb shell am` accepts them. */
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/

/**
 * Install an APK, replacing any installed copy.
 *
 * @param {object} rt - the call runtime.
 * @param {{apkPath: string, serial?: string, avd?: string, timeoutMs?: number}} input - the tool arguments.
 * @returns {Promise<object>} the install report.
 */
export async function install(rt, input) {
  const device = await ensureDevice(rt, input)
  const apk = inside(rt.cwd, input.apkPath)
  const adb = await requireTool(rt, 'adb')
  const out = await run([adb, '-s', device.serial, 'install', '-r', apk], {
    timeout: input.timeoutMs ?? 120_000,
    env: await androidEnv(rt),
  })
  if (!ok(out)) throw new Error(brief(out))
  return { installed: true, serial: device.serial, apkPath: input.apkPath, output: brief(out) }
}

/**
 * Launch an installed app, by explicit activity when one is given.
 *
 * @param {object} rt - the call runtime.
 * @param {{applicationId: string, serial?: string, avd?: string, activity?: string, timeoutMs?: number}} input - the tool arguments.
 * @returns {Promise<object>} the launch report.
 */
export async function launch(rt, input) {
  const device = await ensureDevice(rt, input)
  const app = packageName(input.applicationId)
  const out = input.activity
    ? await adbShell(rt, device.serial, ['am', 'start', '-W', '-n', `${app}/${input.activity}`], input.timeoutMs ?? 60_000)
    : await adbShell(
        rt,
        device.serial,
        ['monkey', '-p', app, '-c', 'android.intent.category.LAUNCHER', '1'],
        input.timeoutMs ?? 60_000,
      )
  return { launched: true, serial: device.serial, applicationId: app, output: brief(out) }
}

/**
 * Force-stop an installed app.
 *
 * @param {object} rt - the call runtime.
 * @param {{applicationId: string, serial?: string, avd?: string, timeoutMs?: number}} input - the tool arguments.
 * @returns {Promise<object>} the stop report.
 */
export async function terminate(rt, input) {
  const device = await ensureDevice(rt, input)
  const app = packageName(input.applicationId)
  await adbShell(rt, device.serial, ['am', 'force-stop', app], input.timeoutMs ?? 30_000)
  return { terminated: true, serial: device.serial, applicationId: app }
}

/**
 * Open a URL through the device's default VIEW handler.
 *
 * @param {object} rt - the call runtime.
 * @param {{url: string, serial?: string, avd?: string, timeoutMs?: number}} input - the tool arguments.
 * @returns {Promise<object>} the open report.
 */
export async function openUrl(rt, input) {
  const device = await ensureDevice(rt, input)
  const value = url(input.url)
  await adbShell(
    rt,
    device.serial,
    ['am', 'start', '-a', 'android.intent.action.VIEW', '-d', value],
    input.timeoutMs ?? 30_000,
  )
  return { opened: true, serial: device.serial, url: value }
}

/**
 * Validate a dotted Java application id.
 *
 * @param {string} value - the candidate.
 * @returns {string} the validated id.
 * @throws When the value is not a valid application id.
 */
export function packageName(value) {
  if (typeof value !== 'string' || !PACKAGE.test(value)) {
    throw new Error(`Invalid Android application id: ${value}`)
  }
  return value
}

/**
 * Validate a URL before it reaches `am start -d`.
 *
 * @param {string} value - the candidate.
 * @returns {string} the validated URL.
 * @throws When the value has no scheme or is unreasonable in length.
 */
function url(value) {
  if (typeof value !== 'string') throw new Error(`Invalid URL: ${value}`)
  if (value.length > 2048) throw new Error('URL is too long.')
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) throw new Error(`Invalid URL: ${value}`)
  return value
}
