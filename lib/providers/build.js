import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { inside, rel } from '../util/path.js'
import { brief, callTimeoutMs, ok, run, splitArgumentLines } from '../util/run.js'
import { install, launch } from './app.js'
import { ensureDevice } from './avd.js'
import { applicationIdFor, discover, findApks } from './project.js'
import { androidEnv, findTool } from './sdk.js'

/**
 * Gradle build orchestration and the one-call build→install→launch flow.
 *
 * Ported from the ZCode plugin's `providers/build.ts`. Every build writes a
 * complete transcript under the plugin data directory, because the tool result
 * only carries a truncated tail: a 12k-character excerpt is enough for the
 * model, but a user diagnosing a dependency failure needs the whole log.
 *
 * @module @zhz8888/dsh-android-emulator-helper/providers/build
 */

/**
 * The per-call runtime the providers read.
 *
 * @typedef {import('../runtime.js').Runtime} Runtime
 */

/**
 * What one command left behind.
 *
 * @typedef {import('../util/run.js').RunResult} RunResult
 */

/**
 * The arguments `android_build_app` accepts.
 *
 * @typedef {object} BuildInput
 * @property {string} [projectDir] - the project directory, relative to the workspace.
 * @property {string} [module] - the Gradle module to assemble.
 * @property {string} [variant] - the build variant to assemble.
 * @property {string} [applicationId] - the application id to install and launch.
 * @property {number} [timeoutMs] - the build timeout, in milliseconds.
 */

/**
 * The arguments `android_build_and_run` accepts: the build ones plus the
 * device and launch ones.
 *
 * @typedef {BuildInput & {
 *   serial?: string,
 *   avd?: string,
 *   launchActivity?: string,
 * }} BuildRunInput
 */

/**
 * What one build left behind.
 *
 * @typedef {object} BuildReport
 * @property {boolean} ok - whether Gradle exited cleanly.
 * @property {string} root - the project root, relative to the workspace.
 * @property {string} module - the module that was assembled.
 * @property {string} variant - the variant that was assembled.
 * @property {string} task - the Gradle task that ran.
 * @property {string | undefined} apkPath - the APK product, relative to the workspace.
 * @property {string | undefined} applicationId - the application id the build resolved.
 * @property {string | undefined} logPath - the full transcript, relative to the workspace, when it could be written.
 * @property {number} code - Gradle's exit code.
 * @property {boolean} timedOut - whether the timeout killed Gradle.
 * @property {string} output - the truncated tail of Gradle's output.
 */

/** Gradle version used when a wrapper has to be generated. */
const GENERATED_GRADLE_VERSION = '8.9'

/**
 * Build one module/variant of an Android Gradle project.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {BuildInput} [input] - the tool arguments.
 * @returns {Promise<BuildReport>} the build report, including the APK path when it succeeded.
 */
export async function buildApp(rt, input = {}) {
  const root = await projectRoot(rt, input.projectDir)
  const found = await discover(rt, root)
  const module = normalizeModule(input.module || found.applicationModule || found.modules[0] || 'app')
  const variant = input.variant || found.variants[0] || 'debug'
  const task = `:${module}:assemble${cap(variant)}`
  const gradle = await gradleCommand(rt, root)
  const out = await run([...gradle, task, ...splitArgumentLines(rt.settings.gradleExtraArgs)], {
    cwd: root,
    // The device tools reject a non-positive override; the build path must too,
    // or `timeoutMs: 0` kills Gradle in milliseconds and reports a timeout with
    // no diagnostics at all.
    timeout: callTimeoutMs(input.timeoutMs, rt.settings.buildTimeoutSeconds),
    env: await androidEnv(rt),
  })
  /** @type {string | undefined} */
  let logPath
  try {
    logPath = await record(rt, 'build', out)
  } catch (error) {
    // The build itself already happened; failing to persist its transcript must
    // not replace a result the caller can use with a storage error.
    rt.logger.warn(`android_build_app: could not write the build log: ${message(error)}`)
  }
  const apk = ok(out) ? await findApk(root, module, variant) : undefined
  const applicationId = input.applicationId || (await applicationIdFor(root, module)) || found.applicationIds[0]

  return {
    ok: ok(out),
    root: rel(rt.cwd, root),
    module,
    variant,
    task,
    apkPath: apk ? rel(rt.cwd, apk) : undefined,
    applicationId,
    logPath,
    code: out.code,
    timedOut: out.timed,
    output: brief(out, 12_000),
  }
}

/**
 * Build, then install and launch on a device, starting an emulator if needed.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {BuildRunInput} [input] - build arguments plus `serial`, `avd`, `launchActivity`.
 * @returns {Promise<object>} the combined report.
 */
export async function buildAndRun(rt, input = {}) {
  const built = await buildApp(rt, input)
  if (!built.ok) return { ...built, installed: false, launched: false }
  if (!built.apkPath) throw new Error('Build succeeded, but no APK product was found.')
  if (!built.applicationId) throw new Error('Build succeeded, but applicationId could not be resolved.')
  const device = await ensureDevice(rt, deviceArgs(input))
  const installed = await install(rt, { serial: device.serial, apkPath: built.apkPath, ...timeoutArg(input.timeoutMs) })
  const launched = await launch(rt, {
    serial: device.serial,
    applicationId: built.applicationId,
    ...(input.launchActivity === undefined ? {} : { activity: input.launchActivity }),
    ...timeoutArg(input.timeoutMs),
  })
  return { ...built, device, installed, launched }
}

/**
 * The arguments one device selection takes.
 *
 * A key is copied only when the call named it. An argument the caller did not
 * pass has to stay absent, so the device tool applies its own default instead
 * of receiving an explicit "no value" it would have to tell apart from one.
 *
 * @param {BuildRunInput} input - the tool arguments.
 * @returns {{serial?: string, avd?: string, timeoutMs?: number}} the forwarded arguments.
 */
function deviceArgs(input) {
  return {
    ...(input.serial === undefined ? {} : { serial: input.serial }),
    ...(input.avd === undefined ? {} : { avd: input.avd }),
    ...timeoutArg(input.timeoutMs),
  }
}

/**
 * The timeout one build cycle forwards, when the call named one.
 *
 * @param {number | undefined} timeoutMs - the call's timeout.
 * @returns {{timeoutMs?: number}} the forwarded timeout.
 */
function timeoutArg(timeoutMs) {
  return timeoutMs === undefined ? {} : { timeoutMs }
}

/**
 * Resolve an absolute Gradle root.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} [raw] - an explicit project directory.
 * @returns {Promise<string>} the absolute root.
 */
export async function projectRoot(rt, raw) {
  if (raw) return inside(rt.cwd, raw)
  const found = await discover(rt, rt.cwd)
  if (found.root !== undefined) return inside(rt.cwd, found.root || '.')
  throw new Error('No Android Gradle project found. Use android_create_app first.')
}

/**
 * The APK product for one module/variant, preferring the variant's own directory.
 *
 * @param {string} root - the Gradle root.
 * @param {string} module - the module that was assembled.
 * @param {string} variant - the variant that was assembled.
 * @returns {Promise<string | undefined>} the absolute APK path.
 */
async function findApk(root, module, variant) {
  const hits = await findApks(root, [module])
  return pickApk(hits, variant)
}

/**
 * Pick the APK matching a variant directory, falling back to the first product.
 *
 * @param {string[]} hits - candidate APK paths.
 * @param {string} variant - the requested variant.
 * @returns {string | undefined} the chosen APK.
 */
export function pickApk(hits, variant) {
  const wanted = String(variant).toLowerCase()
  const wantDir = `${path.sep}${wanted}${path.sep}`
  return (
    hits.find((item) => item.toLowerCase().includes(wantDir)) ??
    // A flavored build puts the product in `freeDebug/`, so the variant check
    // has to accept the APK's own `-freeDebug.apk` suffix before falling back
    // to "the first product", which may belong to another flavor.
    hits.find((item) => item.toLowerCase().endsWith(`-${wanted}.apk`)) ??
    hits[0]
  )
}

/**
 * Resolve the Gradle launcher, generating a wrapper when only `gradle` exists.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} root - the Gradle root.
 * @returns {Promise<string[]>} the argv prefix that runs Gradle.
 */
async function gradleCommand(rt, root) {
  const wrapper = path.join(root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
  if (await exists(wrapper)) return [wrapper]
  const gradle = await findTool(rt, 'gradle')
  if (gradle) {
    const generated = await run([gradle, 'wrapper', '--gradle-version', GENERATED_GRADLE_VERSION], {
      cwd: root,
      timeout: 120_000,
      env: await androidEnv(rt),
    })
    if (ok(generated) && (await exists(wrapper))) return [wrapper]
    return [gradle]
  }
  throw new Error('No Gradle wrapper or gradle executable found. Generate a wrapper or install Gradle.')
}

/**
 * Persist one command transcript and return its workspace-relative path.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} name - log basename prefix.
 * @param {RunResult} out - the command result.
 * @returns {Promise<string>} the written log path.
 */
async function record(rt, name, out) {
  const dir = await rt.buildLogs()
  const file = path.join(dir, `${stamp()}-${name}-${key(rt.cwd)}.log`)
  await mkdir(dir, { recursive: true })
  await writeFile(
    file,
    [`$ ${out.cmd.join(' ')}`, `exit=${out.code}`, `timedOut=${out.timed}`, '', out.stdout, out.stderr].join('\n'),
    'utf8',
  )
  return rel(rt.cwd, file)
}

/**
 * `access` as a boolean.
 *
 * @param {string} file - the path to probe.
 * @returns {Promise<boolean>} whether the path is reachable.
 */
async function exists(file) {
  return access(file)
    .then(() => true)
    .catch(() => false)
}

/**
 * Strip leading Gradle module separators.
 *
 * @param {string} value - the module name.
 * @returns {string} the name Gradle's task path expects.
 */
function normalizeModule(value) {
  return String(value).replace(/^:+/, '') || 'app'
}

/**
 * Capitalize each `-`/`_` separated segment, as Gradle task names require.
 *
 * @param {string} value - the variant name.
 * @returns {string} the capitalized variant name.
 */
function cap(value) {
  return String(value)
    .split(/[-_]/g)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join('')
}

/**
 * Stable short hash of the workspace path, so two projects do not collide.
 *
 * @param {string} value - the workspace path.
 * @returns {string} the short hash.
 */
function key(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 8)
}

/**
 * Filesystem-safe timestamp.
 *
 * @returns {string} the timestamp.
 */
function stamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-')
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
