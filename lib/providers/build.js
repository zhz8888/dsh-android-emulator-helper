import { access, mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { inside, rel } from '../util/path.js'
import { brief, callTimeoutMs, ok, run, splitArgumentLines } from '../util/run.js'
import { install, launch } from './app.js'
import { ensureDevice } from './avd.js'
import { applicationIdFor, discover, findApks } from './project.js'
import { androidEnv, findTool, sdkRoot } from './sdk.js'

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
 * @property {string[] | undefined} apkCandidates - every product found, when the variant could not be resolved to exactly one.
 * @property {string | undefined} applicationId - the application id the build resolved.
 * @property {'argument' | 'apk' | 'build-script' | undefined} applicationIdSource - where {@link applicationId} came from.
 * @property {string | undefined} apkApplicationId - the id read back from the APK, when aapt2 could read it.
 * @property {string | undefined} applicationIdNote - why the id came from the build script instead of the APK.
 * @property {string | undefined} logPath - the full transcript, relative to the workspace, when it could be written.
 * @property {number} code - Gradle's exit code.
 * @property {boolean} timedOut - whether the timeout killed Gradle.
 * @property {string} output - the truncated tail of Gradle's output.
 */

/**
 * Fallback Gradle version for a generated wrapper when the installed one cannot
 * be identified.
 *
 * The installed version is preferred — see {@link gradleCommand} — so this only
 * applies to a `gradle` whose `--version` output is unreadable.
 */
const GENERATED_GRADLE_VERSION = '8.9'

/**
 * Smallest Gradle release the bundled Android Gradle Plugin accepts.
 *
 * The template pins AGP 8.7.3, whose version check refuses a Gradle older than
 * 8.9. A wrapper generated below that floor cannot configure the generated
 * project at all, so `gradle wrapper` and the first `assemble` both fail on a
 * machine whose only Gradle is, say, 8.5. The generated wrapper is therefore
 * clamped up to this release.
 */
export const MIN_WRAPPER_GRADLE_VERSION = '8.9'

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
  const products = ok(out) ? await findApks(root, [module]) : []
  const apk = pickApk(products, variant)
  // A build that produced several APKs and no unique match is not a failure —
  // the caller can still see what was built — but the product must be reported
  // as unresolved rather than guessed, or `build_and_run` installs and launches
  // a flavor nobody asked for.
  const apkCandidates =
    apk === undefined && products.length > 0 ? products.map((file) => rel(rt.cwd, file)) : undefined
  // A build script's `applicationId` is the base id; an `applicationIdSuffix`
  // or a product flavor can change what is actually installed, and launching
  // the base id then starts nothing (or, worse, an older build of the same
  // package). The APK itself is the authority, so it is read back with aapt2
  // after a successful build. When aapt2 cannot be found or cannot read the
  // APK, the build-script value is still returned, with a note saying so.
  const staticId = input.applicationId || (await applicationIdFor(root, module)) || found.applicationIds[0]
  /** @type {string | undefined} */
  let applicationId = staticId
  /** @type {'argument' | 'apk' | 'build-script' | undefined} */
  let applicationIdSource =
    input.applicationId !== undefined ? 'argument' : staticId === undefined ? undefined : 'build-script'
  /** @type {string | undefined} */
  let apkApplicationId
  /** @type {string | undefined} */
  let applicationIdNote
  if (apk !== undefined) {
    const read = await readApkApplicationId(rt, apk)
    apkApplicationId = read.applicationId
    if (input.applicationId === undefined) {
      if (read.applicationId !== undefined) {
        applicationId = read.applicationId
        applicationIdSource = 'apk'
      } else {
        applicationIdNote =
          read.aapt2 === undefined
            ? 'aapt2 was not found under the SDK build-tools, so applicationId comes from the build script; an applicationIdSuffix or product flavor can make it differ from the installed package.'
            : `aapt2 could not read the APK application id (${read.error ?? 'no package line'}), so applicationId comes from the build script and may differ from the installed package.`
      }
    }
  }

  return {
    ok: ok(out),
    root: rel(rt.cwd, root),
    module,
    variant,
    task,
    apkPath: apk ? rel(rt.cwd, apk) : undefined,
    apkCandidates,
    applicationId,
    applicationIdSource,
    apkApplicationId,
    applicationIdNote,
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
  if (!built.apkPath) {
    const candidates =
      built.apkCandidates === undefined || built.apkCandidates.length === 0
        ? ''
        : ` Candidates: ${built.apkCandidates.join(', ')}. Pass an explicit variant or remove stale build outputs.`
    throw new Error(`Build succeeded, but no APK product was found for variant "${built.variant}".${candidates}`)
  }
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
 * Pick the one APK that belongs to a variant.
 *
 * The candidate's *absolute* path is not usable for matching: a workspace at
 * `E:\release\app` makes every APK path contain `\release\`, so requesting
 * `release` used to select a stale `debug` product that happened to come first.
 * Only the part after `build/outputs/apk` is meaningful, and matching is done
 * on that, case-insensitively because Windows and macOS paths are.
 *
 * AGP writes flavored products in two layouts, and both are real:
 *
 *   build/outputs/apk/freeDebug/app-free-debug.apk    (older AGP / one segment)
 *   build/outputs/apk/free/debug/app-free-debug.apk   (AGP 8: flavor + build type)
 *
 * so the directory segments below `apk/` are concatenated before comparison:
 * `free` + `debug` and `freeDebug` both become `freedebug`, which is what
 * `android_discover_project` reports as the variant name. `-`/`_` are ignored
 * on both sides because Gradle's variant names and its product file names do
 * not agree on separators.
 *
 * When the directory layout does not answer, the product's file name does:
 * `app-free-debug.apk` names the variant after normalization. Either rule
 * matching more than one product means the variant is genuinely ambiguous — a
 * flavor pair produced one APK each, or a split-ABI build produced several —
 * and `undefined` is returned so the caller can report the candidates instead
 * of silently installing one of them.
 *
 * @param {string[]} hits - candidate APK paths.
 * @param {string} variant - the requested variant.
 * @returns {string | undefined} the exactly-matching APK, or undefined when no product matches uniquely.
 */
export function pickApk(hits, variant) {
  const wanted = variantKey(variant)
  if (wanted === '') return undefined
  /** @type {Array<{file: string, relative: string}>} */
  const candidates = []
  for (const file of hits) {
    const relative = outputsRelative(file)
    if (relative !== undefined) candidates.push({ file, relative })
  }
  const directories = candidates.filter((item) => directoryKey(item.relative) === wanted)
  if (directories.length === 1) return directories[0]?.file
  if (directories.length > 1) return undefined
  const suffixed = candidates.filter((item) => fileKey(item.relative).endsWith(`${wanted}.apk`))
  if (suffixed.length === 1) return suffixed[0]?.file
  return undefined
}

/**
 * The comparison form of a variant name or of one output directory.
 *
 * Lowercased, with the `-`/`_` separators Gradle uses inconsistently removed:
 * the variant is `freeDebug`, the flavor directory is `free`, the build type
 * directory is `debug`, and the APK is `app-free-debug.apk` — all one variant.
 *
 * @param {string} value - a variant name or directory path fragment.
 * @returns {string} the comparison key.
 */
function variantKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(/[-_\s]/g, '')
}

/**
 * The path relative to the module's `build/outputs` directory.
 *
 * @param {string} file - an APK's absolute path.
 * @returns {string | undefined} the lowercased relative path, or undefined when the file is not a build output.
 */
function outputsRelative(file) {
  const normalized = String(file).replaceAll('\\', '/')
  const marker = '/build/outputs/'
  const at = normalized.toLowerCase().lastIndexOf(marker)
  if (at < 0) return undefined
  return normalized.slice(at + marker.length).toLowerCase()
}

/**
 * The directory segments of a relative build-output path.
 *
 * @param {string} relative - a path relative to `build/outputs`.
 * @returns {string[]} the directory names, without the file name.
 */
function outputDirectories(relative) {
  return relative.split('/').slice(0, -1)
}

/**
 * The variant an APK's output directory names.
 *
 * `build/outputs/apk/free/debug/app-free-debug.apk` → `freedebug`, and
 * `build/outputs/apk/freeDebug/app-free-debug.apk` → the same key. The leading
 * `apk` directory is the output kind rather than part of the variant name.
 *
 * @param {string} relative - a path relative to `build/outputs`.
 * @returns {string} the comparison key of the directory path.
 */
function directoryKey(relative) {
  const segments = outputDirectories(relative)
  const withoutKind = segments[0] === 'apk' ? segments.slice(1) : segments
  return variantKey(withoutKind.join(''))
}

/**
 * The comparison form of an APK file name, used when the directory says nothing.
 *
 * `app-free-debug.apk` → `appfreedebug.apk`, so a variant asked for as
 * `freeDebug` or `free-debug` still matches by suffix.
 *
 * @param {string} relative - a path relative to `build/outputs`.
 * @returns {string} the comparison key of the file name.
 */
function fileKey(relative) {
  const name = relative.split('/').at(-1) ?? ''
  return name.replaceAll(/[-_]/g, '').toLowerCase()
}

/**
 * The application id an `aapt2 dump badging` transcript names.
 *
 * aapt2 prints one header line:
 *
 *   package: name='com.example.free.debug' versionCode='1' versionName='1.0' ...
 *
 * and that line is the only place the *built* package is recorded: the build
 * script names the base application id, while an `applicationIdSuffix` or a
 * flavor changes what actually lands on the device. Both quote styles are
 * accepted because aapt (1) used double quotes in some releases, and a wrapper
 * may normalize the output.
 *
 * @param {string} output - aapt2's stdout.
 * @returns {string | undefined} the package name, when the transcript carries one.
 */
export function parseAaptBadging(output) {
  const text = String(output ?? '')
  const single = /^package:\s*name='([^']+)'/m.exec(text)
  if (single?.[1] !== undefined) return single[1]
  return /^package:\s*name="([^"]+)"/m.exec(text)?.[1]
}

/**
 * Read one APK's real application id, using the SDK's own aapt2.
 *
 * The tool is looked for under the resolved SDK root's `build-tools/`, newest
 * release first. It is not resolved through the shared tool table because that
 * table's names are a closed union and `aapt2` is used by nothing else; adding
 * it there would make every consumer of `findTool` advertise a tool it does not
 * necessarily have. When the SDK, the `build-tools` package or the tool itself
 * is missing, the caller falls back to the build script's value and says so.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} apk - the APK to read.
 * @returns {Promise<{applicationId: string | undefined, aapt2: string | undefined, error: string | undefined}>} the id and how it was read.
 */
async function readApkApplicationId(rt, apk) {
  const aapt2 = await aapt2Tool(rt)
  if (aapt2 === undefined) return { applicationId: undefined, aapt2: undefined, error: undefined }
  const out = await run([aapt2, 'dump', 'badging', apk], { timeout: 30_000, env: await androidEnv(rt) })
  const applicationId = ok(out) ? parseAaptBadging(out.stdout) : undefined
  return {
    applicationId,
    aapt2,
    error: applicationId === undefined ? brief(out, 400) || 'aapt2 printed no package line' : undefined,
  }
}

/**
 * The SDK's own `aapt2`, preferring the newest build-tools release.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<string | undefined>} the absolute tool path, when one exists.
 */
async function aapt2Tool(rt) {
  const root = await sdkRoot(rt)
  if (root === undefined) return undefined
  const dir = path.join(root, 'build-tools')
  const versions = (await readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .sort((left, right) => compareRanks(versionRank(right), versionRank(left)))
  for (const version of versions) {
    for (const candidate of executableCandidates(path.join(dir, version, 'aapt2'))) {
      if (await exists(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * The leading `major.minor.patch` of a version-like string.
 *
 * @param {string} value - the version, possibly with a suffix such as `-rc1`.
 * @returns {[number, number, number] | undefined} the numeric parts, or undefined when there is no leading number.
 */
function versionRank(value) {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(value ?? '').trim())
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2] ?? '0'), Number(match[3] ?? '0')]
}

/**
 * Whether one version rank sorts before another.
 *
 * @param {[number, number, number]} left - the first rank.
 * @param {[number, number, number]} right - the second rank.
 * @returns {boolean} true when `left` is the older release.
 */
function rankBelow(left, right) {
  for (let at = 0; at < left.length; at += 1) {
    const a = left[at] ?? 0
    const b = right[at] ?? 0
    if (a !== b) return a < b
  }
  return false
}

/**
 * `Array#sort` comparator over two version ranks, newest first.
 *
 * @param {[number, number, number] | undefined} left - the first rank.
 * @param {[number, number, number] | undefined} right - the second rank.
 * @returns {number} the sort order.
 */
function compareRanks(left, right) {
  if (left === undefined || right === undefined) return 0
  for (let at = 0; at < left.length; at += 1) {
    const a = left[at] ?? 0
    const b = right[at] ?? 0
    if (a !== b) return a - b
  }
  return 0
}

/**
 * Windows executable suffixes for a bare tool name.
 *
 * The plugin's shared resolver keeps its own copy private, and `build-tools`
 * releases are directories rather than the flat layouts that resolver knows, so
 * the probe is repeated here.
 *
 * @param {string} base - the path without a suffix.
 * @returns {string[]} the candidates to probe.
 */
function executableCandidates(base) {
  if (process.platform !== 'win32') return [base]
  if (path.extname(base)) return [base]
  return ['.exe', '.bat', '.cmd', ''].map((suffix) => `${base}${suffix}`)
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
  if (!gradle) {
    throw new Error(
      'No Gradle wrapper or gradle executable found. Install Gradle, or run `gradle wrapper` in the project root once so the project carries its own launcher.',
    )
  }
  // Pin the generated wrapper to the Gradle that is actually installed. The
  // hard-coded version this used to name was an old release, so every fresh
  // project downloaded ~134 MB of a Gradle the machine already had a newer copy
  // of, and the pinned release was not necessarily one the host's JDK supports.
  //
  // The template's AGP 8.7.3 refuses a Gradle older than 8.9, though, so the
  // wrapper is clamped up to that floor: a machine with only Gradle 8.5 would
  // otherwise get a wrapper the very project it belongs to cannot configure.
  const installed = await gradleVersion(rt, gradle)
  const version = wrapperGradleVersion(installed)
  if (installed !== undefined && version !== installed) {
    rt.logger.warn(
      `android_build_app: Gradle ${installed} is older than ${MIN_WRAPPER_GRADLE_VERSION}, which the bundled Android Gradle Plugin requires; generating a wrapper pinned to ${version}.`,
    )
  }
  const generated = await run([gradle, 'wrapper', '--gradle-version', version], {
    cwd: root,
    // A cold cache has to start a daemon and resolve the wrapper task; 120 s was
    // not enough there, and the failure was silent because the code fell back to
    // the global gradle without saying so.
    timeout: 600_000,
    env: await androidEnv(rt),
  })
  if (ok(generated) && (await exists(wrapper))) return [wrapper]
  rt.logger.warn(
    `android_build_app: could not generate a Gradle wrapper (${brief(generated, 400) || 'no output'}); building with ${gradle} instead.`,
  )
  return [gradle]
}

/**
 * The version of one installed Gradle, for pinning a generated wrapper.
 *
 * Read from `gradle --version`, whose first line is a banner and whose second
 * is `Gradle 8.12`. Returning undefined lets the caller fall back to
 * {@link GENERATED_GRADLE_VERSION} rather than pinning a version it guessed.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} gradle - the Gradle executable.
 * @returns {Promise<string | undefined>} the version, when it could be read.
 */
async function gradleVersion(rt, gradle) {
  const out = await run([gradle, '--version'], { timeout: 120_000, env: await androidEnv(rt) })
  if (!ok(out)) return undefined
  return out.stdout.match(/^Gradle\s+(\d+(?:\.\d+)+)\s*$/m)?.[1]
}

/**
 * The Gradle version a generated wrapper should be pinned to.
 *
 * The installed release is preferred, because a wrapper that names it downloads
 * nothing on the machine that generated it. The template's AGP 8.7.3 checks the
 * running Gradle version and refuses anything below 8.9, though, so an older
 * installed Gradle is clamped up: a wrapper below the floor makes the generated
 * project impossible to configure, which is worse than the one-time download.
 *
 * @param {string | undefined} installed - the version `gradle --version` reported.
 * @returns {string} the version to pass to `gradle wrapper --gradle-version`.
 */
export function wrapperGradleVersion(installed) {
  const version = String(installed ?? '').trim()
  const parsed = versionRank(version)
  const floor = versionRank(MIN_WRAPPER_GRADLE_VERSION)
  if (parsed === undefined || floor === undefined) return GENERATED_GRADLE_VERSION
  return rankBelow(parsed, floor) ? MIN_WRAPPER_GRADLE_VERSION : version
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
