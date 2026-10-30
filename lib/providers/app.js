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
 * @param {Runtime} rt - the call runtime.
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
 * `am force-stop` exits 0 for a package that is not installed, so its exit
 * code cannot confirm that anything was stopped. The package is therefore
 * looked up first: `pm list packages <id>` is a substring filter, so the
 * answer is matched line by line against `package:<id>` — a prefix match would
 * accept `com.example.application` when the caller named `com.example.app` —
 * and a package that is not installed is refused before `am` is spawned.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {{applicationId: string, serial?: string, avd?: string, timeoutMs?: number}} input - the tool arguments.
 * @returns {Promise<object>} the stop report.
 * @throws When the package is not installed on the device.
 */
export async function terminate(rt, input) {
  const device = await ensureDevice(rt, input)
  const app = packageName(input.applicationId)
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
