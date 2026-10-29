import path from 'node:path'
import { brief, ok, run } from '../util/run.js'
import { listAvds } from './avd.js'
import { systemImagePackage } from '../settings.js'
import { listDevices } from './device.js'
import { discover } from './project.js'
import { androidAvdHome, androidEnv, checkTool, findTool, javaHomeInfo, listJavaHomes, sdkRoot, sdkRoots } from './sdk.js'

/**
 * Environment diagnostics for the host and the settings page.
 *
 * Ported from the ZCode plugin's `providers/preflight.ts`. Two additions serve
 * the in-app settings page: the "Android plugin defaults" check now reports the
 * values the user actually saved, and {@link inventory} returns the same
 * discoveries in a shape a form can consume (dropdown options, device lists).
 *
 * @module @zhz8888/dsh-android-emulator-helper/providers/preflight
 */

/**
 * The per-call runtime the providers read.
 *
 * @typedef {import('../runtime.js').Runtime} Runtime
 */

/**
 * One device the plugin can see.
 *
 * @typedef {import('./device.js').DeviceRecord} DeviceRecord
 */

/**
 * The plugin's live settings.
 *
 * @typedef {import('../settings.js').AndroidSettings} AndroidSettings
 */

/**
 * One probe's outcome.
 *
 * The `ok` flag is the discriminant: a caller reads `value` when it is true
 * and `error` when it is false. That reading only narrows while the flag keeps
 * its literal type, which is why the two halves are written as one union
 * rather than as two unrelated shapes.
 *
 * @template T
 * @typedef {{ok: true, value: T[]} | {ok: false, value: T[], error: string}} Probe
 */

/**
 * One preflight check.
 *
 * @typedef {object} PreflightCheck
 * @property {string} name - the check's name, as the report shows it.
 * @property {boolean} ok - whether the check passed.
 * @property {string} detail - what the check found.
 * @property {string} fix - what to do about it.
 */

/** Name of the ADB device check, exempted from the overall verdict when a device can still be started. */
const ADB_DEVICES_CHECK = 'ADB devices'

/**
 * Where the user edits the values these diagnostics report.
 *
 * The page lives on the plugin's own detail view in the Plugins panel, not in
 * the Settings dialog, so every user-visible fix hint that points at it says
 * this phrase. tests/providers.test.js pins it and the two interpolations.
 */
export const PAGE_LOCATION = 'the Android Emulator Helper page in the Plugins panel'

/**
 * Emulator-only checks that a ready physical device makes optional.
 *
 * A developer with a plugged-in phone has a working setup even with no AVD and
 * no emulator binary, so preflight must not call that a failure.
 */
const READY_TARGET_OPTIONAL_CHECKS = new Set(['emulator', 'avdmanager', 'Android Virtual Devices', 'Emulator acceleration'])

/**
 * The command-line tools the diagnostic probes.
 *
 * The pair is a tuple, so the tool name and its arguments keep their own
 * types: a plain array literal widens to `(string | string[])[]`, and the
 * name would no longer be one the SDK resolver knows.
 *
 * @type {Array<[import('./sdk.js').ToolName, string[]]>}
 */
const TOOL_PROBES = [
  ['adb', ['version']],
  ['emulator', ['-version']],
  ['sdkmanager', ['--version']],
  ['avdmanager', ['list', 'avd']],
]

/**
 * Whether a missing ready device is still recoverable.
 *
 * `ensureDevice` starts an emulator when it finds no ready target, so "no
 * devices" is not itself a failure — but only while that recovery is actually
 * available. With `autoStartEmulator` off, or with no emulator binary or no
 * AVD to start, every device-targeted tool refuses, and a verdict of "ready"
 * would be a lie the caller only discovers on its first real call.
 *
 * @param {Array<{name: string, ok: boolean}>} checks - the preflight checks.
 * @param {{autoStartEmulator?: boolean}} input - the live setting backing the recovery.
 * @returns {boolean} true when the plugin can still produce a target on its own.
 */
function canStartTarget(checks, input) {
  if (input.autoStartEmulator === false) return false
  const failed = new Set(checks.filter((item) => !item.ok).map((item) => item.name))
  // A failed acceleration check means the emulator the recovery would start
  // cannot boot, so it must not be exempted the way a missing ready device is.
  return (
    !failed.has('emulator') &&
    !failed.has('Android Virtual Devices') &&
    !failed.has('Emulator acceleration')
  )
}

/**
 * Reduce the checks to one verdict.
 *
 * @param {Array<{name: string, ok: boolean}>} checks - the preflight checks.
 * @param {{hasReadyTarget: boolean, autoStartEmulator?: boolean}} input - whether any device is ready, and whether one could still be started.
 * @returns {boolean} true when the environment can run the workflow.
 */
export function preflightOk(checks, input) {
  const deviceOptional = input.hasReadyTarget || canStartTarget(checks, input)
  return checks.every(
    (item) =>
      item.ok ||
      (deviceOptional && (item.name === ADB_DEVICES_CHECK || READY_TARGET_OPTIONAL_CHECKS.has(item.name))),
  )
}

/**
 * Run the full diagnostic.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<{ok: boolean, backend: string, checks: PreflightCheck[], settings: AndroidSettings}>} the report.
 */
export async function preflight(rt) {
  /** @type {PreflightCheck[]} */
  const checks = []

  checks.push({
    name: 'Host OS',
    ok: process.platform === 'darwin' || process.platform === 'win32',
    detail: `${process.platform} ${process.arch}`,
    fix: 'Run this plugin on macOS or Windows for the desktop Android Emulator workflow.',
  })

  const root = await sdkRoot(rt)
  const rootExists = root ? await exists(root) : false
  const searched = await sdkRoots(rt)
  checks.push({
    name: 'Android SDK root',
    ok: rootExists,
    detail: root || `not found (searched ${searched.slice(0, 4).join(', ')} …)`,
    fix: `Install Android Studio or set the Android SDK root on ${PAGE_LOCATION} (or ANDROID_HOME).`,
  })

  checks.push({
    name: 'Android plugin defaults',
    ok: true,
    detail: [
      `apiLevel=${rt.settings.apiLevel}`,
      `buildTools=${rt.settings.buildToolsVersion}`,
      `systemImage=${rt.settings.systemImageVariant}/${rt.settings.systemImageAbi || autoAbi()}`,
      `systemImagePackage=${systemImagePackage(rt.settings)}`,
      `jdkMajor=${rt.settings.jdkMajor}`,
      `defaultAvd=${rt.settings.defaultAvd}`,
      `autoStartEmulator=${rt.settings.autoStartEmulator}`,
    ].join('\n'),
    fix: `Edit these on ${PAGE_LOCATION}.`,
  })

  for (const [tool, args] of TOOL_PROBES) {
    const check = await checkTool(rt, tool, args)
    checks.push({
      name: tool,
      ok: check.ok,
      detail: check.path ? `${check.path}\n${check.detail}` : check.detail,
      fix: `Install Android SDK ${tool} support with Android Studio SDK Manager or the command-line tools.`,
    })
  }

  const env = await androidEnv(rt)
  const javaInfo = await javaHomeInfo(rt)
  const home = javaInfo.home
  const javaCmd = home ? path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java'
  const java = await run([javaCmd, '-version'], { timeout: 10_000, env })
  checks.push({
    name: 'Java',
    ok: ok(java),
    // The configured major is a preference: a machine that has no JDK of
    // exactly that major still builds with the nearest one it has. The
    // difference is stated here rather than left for the user to find out
    // from a build failure.
    detail: home
      ? [
          home,
          javaInfo.exact ? undefined : `JDK ${javaInfo.requested} requested, ${javaInfo.major} in use`,
          brief(java, 1000) || 'available',
        ]
          .filter((item) => item !== undefined)
          .join('\n')
      : brief(java, 1000) || 'not found',
    fix: 'Install a JDK compatible with the Android Gradle Plugin, or point the JDK major version setting at an installed one.',
  })

  const project = await discover(rt, rt.cwd).catch(() => undefined)
  const gradle = await findTool(rt, 'gradle')
  checks.push({
    name: 'Gradle',
    ok: Boolean(project?.hasWrapper || gradle),
    detail: project?.hasWrapper ? 'Gradle wrapper found' : gradle ? `gradle at ${gradle}` : 'not found',
    fix: 'Install Gradle or generate a Gradle wrapper in the Android project root.',
  })

  const emulator = await findTool(rt, 'emulator')
  if (process.platform === 'win32' && emulator) {
    // The first run on a cold Windows host initialises the emulator driver,
    // which takes longer than the probe's usual budget. A timeout here would
    // be reported as a failed acceleration check and would fail the whole
    // diagnostic for a machine whose emulator would in fact boot.
    const accel = await run([emulator, '-accel-check'], { timeout: 60_000, env })
    checks.push({
      name: 'Emulator acceleration',
      ok: ok(accel),
      detail: brief(accel, 1000) || 'available',
      fix: 'Enable CPU virtualization/WHPX or finish the Android Emulator driver setup in Android Studio Device Manager.',
    })
  }

  /** @type {Array<{name: string}> | Error} */
  const avds = await listAvds(rt).catch((err) => err)
  checks.push({
    name: 'Android Virtual Devices',
    ok: Array.isArray(avds) && avds.length > 0,
    detail: Array.isArray(avds)
      ? `${avds.length} AVD(s): ${avds.map((item) => item.name).join(', ')}`
      : String(avds),
    fix: 'Create an emulator in Android Studio Device Manager or call android_create_avd only when no ready device is available.',
  })

  /** @type {DeviceRecord[] | Error} */
  const devices = await listDevices(rt).catch((err) => err)
  const hasReadyTarget = readyDevices(devices).length > 0
  checks.push({
    name: ADB_DEVICES_CHECK,
    ok: hasReadyTarget,
    detail: Array.isArray(devices)
      ? `${devices.length} device(s): ${devices.map((item) => `${item.serial}:${item.state}`).join(', ')}`
      : String(devices),
    fix: 'Start an Android Emulator or connect a device with USB debugging enabled.',
  })

  return {
    ok: preflightOk(checks, { hasReadyTarget, autoStartEmulator: rt.settings.autoStartEmulator !== false }),
    backend: 'sdk',
    settings: rt.settings,
    checks,
  }
}

/**
 * Everything the settings page can offer as a choice, discovered on demand.
 *
 * Each probe is failure-tolerant: a missing SDK must not blank the page, it
 * must simply produce empty option lists plus a note, so the page still
 * renders and its fields can still be set.
 *
 * `avds` is the union of the AVD directory's records and the emulator's own
 * list, so a host whose emulator cannot be started still names the AVDs it
 * holds; `avdHome` is the directory the scan read, reported so the page can
 * say where the list came from instead of implying a probe that never ran.
 * `avdsError` is therefore the reason the union is *empty*: while the scan has
 * an answer the emulator's own failure is not reported here, and the
 * diagnostic route covers the emulator's health separately.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<object>} the inventory.
 */
export async function inventory(rt) {
  const root = await sdkRoot(rt)
  const [avds, devices, javaHomes, installed] = await Promise.all([
    settle(listAvds(rt)),
    settle(listDevices(rt)),
    listJavaHomes(rt),
    installedPackages(rt),
  ])

  return {
    host: { platform: process.platform, arch: process.arch },
    detectedSdkRoot: root ?? null,
    sdkRootExists: root ? await exists(root) : false,
    searchedSdkRoots: await sdkRoots(rt),
    avds: avds.value.map((item) => item.name),
    avdsError: avds.ok ? undefined : avds.error,
    avdHome: await androidAvdHome(rt),
    devices: devices.value.map((item) => ({
      serial: item.serial,
      state: item.state,
      kind: item.kind,
      model: item.model,
    })),
    devicesError: devices.ok ? undefined : devices.error,
    javaHomes: javaHomes.filter((item) => item.major),
    systemImages: installed.systemImages,
    platforms: installed.platforms,
    buildTools: installed.buildTools,
    installedError: installed.error,
    current: {
      dataRoot: rt.dataRoot,
      systemImagePackage: systemImagePackage(rt.settings),
      defaultAbi: autoAbi(),
      platformToolsVersion: await adbVersion(rt),
    },
  }
}

/**
 * Run one probe and keep its failure instead of throwing it.
 *
 * The settings page needs both halves: the list when the probe worked, and
 * the reason when it did not. A rejected promise would take the whole page
 * down, so the failure is turned into the second half of the pair.
 *
 * @template T
 * @param {Promise<T[]>} promise - the probe.
 * @returns {Promise<Probe<T>>} the probe's outcome.
 */
async function settle(promise) {
  try {
    return { ok: true, value: await promise }
  } catch (error) {
    return { ok: false, value: [], error: message(error) }
  }
}

/**
 * Installed SDK package ids grouped by kind.
 *
 * Read from the SDK directory tree rather than `sdkmanager --list_installed`:
 * the layout is stable across SDK versions, needs no subprocess (so it works
 * under a sandbox and returns in milliseconds), and cannot be broken by the
 * command-line tools' own deprecation churn.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<{systemImages: string[], platforms: string[], buildTools: string[], error?: string}>} the inventory.
 */
async function installedPackages(rt) {
  const root = await sdkRoot(rt)
  if (root === undefined || !(await exists(root))) {
    return { systemImages: [], platforms: [], buildTools: [], error: 'No Android SDK root found.' }
  }

  const systemImages = []
  for (const api of await childNames(path.join(root, 'system-images'))) {
    for (const variant of await childNames(path.join(root, 'system-images', api))) {
      for (const abi of await childNames(path.join(root, 'system-images', api, variant))) {
        systemImages.push(`system-images;${api};${variant};${abi}`)
      }
    }
  }

  return {
    systemImages,
    platforms: (await childNames(path.join(root, 'platforms'))).map((name) => `platforms;${name}`),
    buildTools: (await childNames(path.join(root, 'build-tools'))).map((name) => `build-tools;${name}`),
  }
}

/**
 * Directory entry names, or `[]` when `dir` is absent or unreadable.
 *
 * @param {string} dir - the directory to list.
 * @returns {Promise<string[]>} the subdirectory names, sorted.
 */
async function childNames(dir) {
  const { readdir } = await import('node:fs/promises')
  /** @type {import('node:fs').Dirent[]} */
  const items = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return items
    .filter((item) => item.isDirectory() && !item.name.startsWith('.'))
    .map((item) => item.name)
    .sort()
}

/**
 * `adb version`'s first line, or `undefined`.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<string | undefined>} the first line of the version output.
 */
async function adbVersion(rt) {
  const adb = await findTool(rt, 'adb')
  if (!adb) return undefined
  const out = await run([adb, 'version'], { timeout: 10_000, env: await androidEnv(rt) })
  return ok(out) ? out.stdout.split(/\r?\n/)[0]?.trim() : undefined
}

/**
 * Default ABI for this host when the setting is empty.
 *
 * @returns {string} the ABI.
 */
function autoAbi() {
  return process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64'
}

/**
 * Devices in the `device` state.
 *
 * @param {DeviceRecord[] | Error} value - the probe's outcome.
 * @returns {DeviceRecord[]} the ready devices.
 */
function readyDevices(value) {
  return Array.isArray(value) ? value.filter((item) => item.state === 'device') : []
}

/**
 * Order-preserving de-duplication.
 *
 * @param {string[]} items - the items.
 * @returns {string[]} the unique items, in order.
 */
function unique(items) {
  return [...new Set(items)]
}

/**
 * `access` as a boolean.
 *
 * @param {string} file - the path to probe.
 * @returns {Promise<boolean>} whether the path is reachable.
 */
async function exists(file) {
  const { access } = await import('node:fs/promises')
  return access(file)
    .then(() => true)
    .catch(() => false)
}

/**
 * Error message of an arbitrary thrown value.
 *
 * @param {unknown} error - the thrown value.
 * @returns {string} its message.
 */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
