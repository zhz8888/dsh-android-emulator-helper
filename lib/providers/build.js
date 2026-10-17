import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { inside, rel } from '../util/path.js'
import { brief, ok, run, splitArgumentLines } from '../util/run.js'
import { install, launch } from './app.js'
import { ensureDevice } from './avd.js'
import { discover, findApks } from './project.js'
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

/** Gradle version used when a wrapper has to be generated. */
const GENERATED_GRADLE_VERSION = '8.9'

/**
 * Build one module/variant of an Android Gradle project.
 *
 * @param {object} rt - the call runtime.
 * @param {{projectDir?: string, module?: string, variant?: string, applicationId?: string, timeoutMs?: number}} [input] - the tool arguments.
 * @returns {Promise<object>} the build report, including the APK path when it succeeded.
 */
export async function buildApp(rt, input = {}) {
  const root = await projectRoot(rt, input.projectDir)
  const found = await discover(rt, root)
  const module = normalizeModule(input.module || found.modules[0] || 'app')
  const variant = input.variant || found.variants[0] || 'debug'
  const task = `:${module}:assemble${cap(variant)}`
  const gradle = await gradleCommand(rt, root)
  const out = await run([...gradle, task, ...splitArgumentLines(rt.settings.gradleExtraArgs)], {
    cwd: root,
    timeout: input.timeoutMs ?? rt.settings.buildTimeoutMs,
    env: await androidEnv(rt),
  })
  const logPath = await record(rt, 'build', out)
  const apk = ok(out) ? await findApk(root, module, variant) : undefined
  const applicationId = input.applicationId || found.applicationIds[0]

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
 * @param {object} rt - the call runtime.
 * @param {object} input - build arguments plus `serial`, `avd`, `launchActivity`.
 * @returns {Promise<object>} the combined report.
 */
export async function buildAndRun(rt, input = {}) {
  const built = await buildApp(rt, input)
  if (!built.ok) return { ...built, installed: false, launched: false }
  if (!built.apkPath) throw new Error('Build succeeded, but no APK product was found.')
  if (!built.applicationId) throw new Error('Build succeeded, but applicationId could not be resolved.')
  const device = await ensureDevice(rt, {
    serial: input.serial,
    avd: input.avd,
    timeoutMs: input.timeoutMs,
  })
  const installed = await install(rt, {
    serial: device.serial,
    apkPath: built.apkPath,
    timeoutMs: input.timeoutMs,
  })
  const launched = await launch(rt, {
    serial: device.serial,
    applicationId: built.applicationId,
    activity: input.launchActivity,
    timeoutMs: input.timeoutMs,
  })
  return { ...built, device, installed, launched }
}

/**
 * Resolve an absolute Gradle root.
 *
 * @param {object} rt - the call runtime.
 * @param {string} [raw] - an explicit project directory.
 * @returns {Promise<string>} the absolute root.
 */
export async function projectRoot(rt, raw) {
  if (raw) return inside(rt.cwd, raw)
  const found = await discover(rt, rt.cwd)
  if (found.root !== undefined) return inside(rt.cwd, found.root || '.')
  throw new Error('No Android Gradle project found. Use android_create_app first.')
}

/** The APK product for one module/variant, preferring the variant's own directory. */
async function findApk(root, module, variant) {
  const hits = await findApks(root, [module])
  return pickApk(hits, variant)
}

/**
 * Pick the APK matching a variant directory, falling back to the first product.
 *
 * @param {string[]} hits - candidate APK paths.
 * @param {string} variant - the requested variant.
 * @returns {string|undefined} the chosen APK.
 */
export function pickApk(hits, variant) {
  const want = `${path.sep}${variant.toLowerCase()}${path.sep}`
  return hits.find((item) => item.toLowerCase().includes(want)) || hits[0]
}

/**
 * Resolve the Gradle launcher, generating a wrapper when only `gradle` exists.
 *
 * @param {object} rt - the call runtime.
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
 * @param {object} rt - the call runtime.
 * @param {string} name - log basename prefix.
 * @param {{cmd: string[], code: number, timed: boolean, stdout: string, stderr: string}} out - the command result.
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

/** `access` as a boolean. */
async function exists(file) {
  return access(file)
    .then(() => true)
    .catch(() => false)
}

/** Strip leading Gradle module separators. */
function normalizeModule(value) {
  return String(value).replace(/^:+/, '') || 'app'
}

/** Capitalize each `-`/`_` separated segment, as Gradle task names require. */
function cap(value) {
  return String(value)
    .split(/[-_]/g)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join('')
}

/** Stable short hash of the workspace path, so two projects do not collide. */
function key(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 8)
}

/** Filesystem-safe timestamp. */
function stamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-')
}
