import { inside } from '../util/path.js'
import { brief, ok, run } from '../util/run.js'
import { ensureDevice } from './avd.js'
import { adbShell } from './device.js'
import { androidEnv, requireTool } from './sdk.js'

/**
 * App-level device operations: install, launch, force-stop and open a URL.
 * Ported from the ZCode plugin's `providers/app.ts`; the application-id and URL
 * validators reject values before quoting, since both reach `adb shell` as
 * command words.
 *
 * @module @zhz8888/dsh-android-emulator-helper/providers/app
 */

/**
 * The runtime the app provider reads.
 *
 * @typedef {import('../runtime.js').Runtime} Runtime
 */

/**
 * One device or emulator, as `adb devices -l` reports it.
 *
 * @typedef {import('./device.js').DeviceRecord} DeviceRecord
 */

/** Dotted Java application ids, as `adb shell am` accepts them. */
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/

/**
 * Install an APK, replacing any installed copy.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{apkPath: string, serial?: string, avd?: string, timeoutMs?: number}} input - the tool arguments.
 * @returns {Promise<object>} the install report.
 */
export async function install(rt, input) {
  // The APK path is checked before the device is resolved: a path that is not
  // inside the workspace must be refused before an emulator is started to
  // install from it.
  const apk = inside(rt.cwd, input.apkPath)
  const device = await ensureDevice(rt, input)
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
 * @param {Runtime} rt - the call runtime.
 * @param {{applicationId: string, serial?: string, avd?: string, activity?: string, timeoutMs?: number}} input - the tool arguments.
 * @returns {Promise<object>} the launch report.
 */
export async function launch(rt, input) {
  // The application id is checked before the device is resolved: a malformed
  // id must be refused before an emulator is started to carry it.
  const app = packageName(input.applicationId)
  const device = await ensureDevice(rt, input)
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
 * Force-stop an installed app. Checks `pm list packages` for an exact
 * `package:<id>` line first (a prefix match would accept a longer id), because
 * `am force-stop` exits 0 even for an absent package.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{applicationId: string, serial?: string, avd?: string, timeoutMs?: number}} input - the tool arguments.
 * @returns {Promise<object>} the stop report.
 * @throws When the package is not installed on the device.
 */
export async function terminate(rt, input) {
  // The application id is checked before the device is resolved, so a
  // malformed id never starts an emulator.
  const app = packageName(input.applicationId)
  const device = await ensureDevice(rt, input)
  const timeoutMs = input.timeoutMs ?? 30_000
  const installed = await adbShell(rt, device.serial, ['pm', 'list', 'packages', app], timeoutMs)
  if (!isInstalled(installed.stdout, app)) {
    throw new Error(
      `Android application is not installed on ${device.serial}: ${app}. ` +
        'Install it with android_install_app before terminating it.',
    )
  }
  await adbShell(rt, device.serial, ['am', 'force-stop', app], timeoutMs)
  return { terminated: true, serial: device.serial, applicationId: app }
}

/**
 * Whether `pm list packages` output names exactly this package.
 *
 * @param {string} value - the command's stdout.
 * @param {string} app - the validated application id.
 * @returns {boolean} true when one output line is `package:<app>`.
 */
function isInstalled(value, app) {
  return String(value ?? '')
    .split(/\r?\n/)
    .some((line) => line.trim() === `package:${app}`)
}

/**
 * Open a URL through the device's default VIEW handler.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{url: string, serial?: string, avd?: string, timeoutMs?: number}} input - the tool arguments.
 * @returns {Promise<object>} the open report.
 */
export async function openUrl(rt, input) {
  // The URL is checked before the device is resolved: a malformed URL must be
  // refused before an emulator is started to open it.
  const value = url(input.url)
  const device = await ensureDevice(rt, input)
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
