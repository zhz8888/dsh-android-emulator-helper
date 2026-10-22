import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { inside } from '../util/path.js'
import { templateFiles, jvmTargetFor } from './project-template.js'
import { sdkRoot } from './sdk.js'

/**
 * Android Gradle project discovery and creation.
 *
 * Ported from the ZCode plugin's `providers/project.ts`. Discovery is a bounded
 * breadth-first walk (depth 5, skipping `build`, `.gradle` and `node_modules`)
 * rooted at the session workspace instead of `process.cwd()`.
 *
 * @module @zhz8888/dsh-android-emulator-helper/providers/project
 */

/**
 * The per-call runtime the providers read.
 *
 * @typedef {import('../runtime.js').Runtime} Runtime
 */

/**
 * What one discovery walk found.
 *
 * @typedef {object} Discovery
 * @property {string | undefined} root - the Gradle root, relative to the searched directory.
 * @property {string[]} gradleRoots - every Gradle root the walk found.
 * @property {string[]} modules - the modules the Gradle root declares.
 * @property {string[]} variants - the build variants the project offers.
 * @property {string[]} applicationIds - every application id, namespace and manifest package.
 * @property {string[]} manifests - the Android manifests, relative to the searched directory.
 * @property {string[]} apks - the APK products, relative to the searched directory.
 * @property {boolean} hasWrapper - whether the Gradle wrapper is present.
 * @property {boolean} hasGradleProperties - whether `gradle.properties` is present.
 * @property {boolean} hasLocalProperties - whether `local.properties` is present.
 * @property {string[]} warnings - what has to be fixed before the project builds as-is.
 */

/**
 * The arguments `android_create_app` accepts.
 *
 * @typedef {object} CreateInput
 * @property {string} name - the app name, reduced to a Gradle-safe identifier.
 * @property {string} [packageName] - the application id; derived from the name when absent.
 * @property {string} [dir] - the project directory, relative to the workspace.
 * @property {number} [minSdk] - the generated project's `minSdk`.
 * @property {number} [compileSdk] - the generated project's `compileSdk`.
 * @property {boolean} [overwrite] - whether existing files may be replaced.
 */

/** Directories never worth descending into while discovering a project. */
const SKIP_DIRS = new Set(['node_modules', 'build', '.gradle'])

/**
 * Discover the Gradle root, modules, app ids, manifests and APK outputs.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} [dir] - directory to search; defaults to the session workspace.
 * @returns {Promise<Discovery>} the discovery report, with paths relative to `dir`.
 */
export async function discover(rt, dir = rt.cwd) {
  /** @type {string[]} */
  const gradleRoots = []
  /** @type {string[]} */
  const manifests = []
  await walkProjectFiles(dir, 5, async (file, item) => {
    if (item.isFile() && /^settings\.gradle(\.kts)?$/.test(item.name)) {
      gradleRoots.push(path.relative(dir, path.dirname(file)))
    }
    if (item.isFile() && item.name === 'AndroidManifest.xml') manifests.push(path.relative(dir, file))
  })

  const root = gradleRoots.find((item) => item === '') ?? gradleRoots[0]
  const absRoot = root === undefined ? undefined : path.join(dir, root)
  const modules = absRoot ? await modulesFor(absRoot) : []
  const ids = absRoot ? await applicationIds(absRoot) : []
  const apks = absRoot ? (await findApks(absRoot, modules)).map((file) => path.relative(dir, file)) : []
  const hasWrapper = absRoot
    ? await exists(path.join(absRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'))
    : false
  const hasGradleProperties = absRoot ? await exists(path.join(absRoot, 'gradle.properties')) : false
  const hasLocalProperties = absRoot ? await exists(path.join(absRoot, 'local.properties')) : false

  return {
    root,
    gradleRoots,
    modules,
    variants: ['debug'],
    applicationIds: ids,
    manifests,
    apks,
    hasWrapper,
    hasGradleProperties,
    hasLocalProperties,
    warnings: projectWarnings({ hasWrapper, hasGradleProperties, hasLocalProperties }),
  }
}

/**
 * Fixed, actionable warnings for a project that will not build as-is.
 *
 * @param {{hasWrapper: boolean, hasGradleProperties: boolean, hasLocalProperties: boolean}} input - the flags.
 * @returns {string[]} the warnings.
 */
export function projectWarnings(input) {
  const warnings = []
  if (!input.hasGradleProperties) {
    warnings.push('Missing gradle.properties. Add android.useAndroidX=true for AndroidX/Compose projects.')
  }
  if (!input.hasLocalProperties) {
    warnings.push('Missing local.properties. Add sdk.dir=<Android SDK path> when Gradle cannot infer the SDK from the environment.')
  }
  if (!input.hasWrapper) {
    warnings.push('Missing Gradle wrapper. Install Gradle or generate ./gradlew before building.')
  }
  return warnings
}

/**
 * Create a minimal Kotlin + Jetpack Compose app from the bundled template.
 *
 * Existing generated files are never overwritten unless `overwrite` is set, so
 * a second call cannot destroy hand-written code.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {CreateInput} input - the tool arguments.
 * @returns {Promise<object>} the created project summary with workspace-relative paths.
 */
export async function create(rt, input) {
  const cwd = rt.cwd
  const name = cleanName(input.name)
  const root = inside(cwd, input.dir || name)
  const pkg = packageName(input.packageName || `com.example.${slug(name)}`)
  const minSdk = sdkLevel(input.minSdk ?? rt.settings.minSdk, 'minSdk')
  const compileSdk = sdkLevel(input.compileSdk ?? Number(rt.settings.apiLevel), 'compileSdk')
  // The generated project pins ONE bytecode target for both its Java and its
  // Kotlin compilation. Left unpinned, AGP uses its own default while the Kotlin
  // plugin follows whichever JDK runs Gradle, and on a host whose JDK is newer
  // than the pinned AGP release a freshly generated app fails to compile with
  // "different JVM target compatibility". Deriving the target from the
  // configured JDK major keeps the user's intent, and `jvmTargetFor` clamps it
  // to a version both plugins can actually name.
  const jvmTarget = jvmTargetFor(rt.settings.jdkMajor)
  const files = templateFiles(root, pkg, await sdkRoot(rt))

  if (!input.overwrite) {
    const hits = await present(files.map((item) => item.path))
    if (hits.length) {
      throw new Error(
        `Refusing to overwrite existing Android app files: ${hits.map((file) => path.relative(cwd, file)).join(', ')}`,
      )
    }
  }

  for (const file of files) {
    await mkdir(path.dirname(file.path), { recursive: true })
    await writeFile(file.path, file.body({ name, pkg, minSdk, compileSdk, jvmTarget }), 'utf8')
  }

  return {
    root: path.relative(cwd, root) || '.',
    module: 'app',
    variant: 'debug',
    applicationId: pkg,
    files: files.map((file) => path.relative(cwd, file.path)),
    createdBy: 'template',
    note: 'Build uses ./gradlew when present. If the wrapper is missing, android_build_app can generate it with gradle from PATH.',
  }
}

/**
 * Gradle modules declared by `settings.gradle(.kts)`, defaulting to `:app`.
 *
 * @param {string} root - the Gradle root.
 * @returns {Promise<string[]>} the module names, with or without their `:` prefix.
 */
async function modulesFor(root) {
  const settings =
    (await readFile(path.join(root, 'settings.gradle.kts'), 'utf8').catch(() => undefined)) ??
    (await readFile(path.join(root, 'settings.gradle'), 'utf8').catch(() => ''))
  const modules = [...settings.matchAll(/include\(([^)]+)\)/g)]
    .flatMap((match) => [...String(match[1]).matchAll(/["'](:[^"']+)["']/g)].map((hit) => hit[1] ?? ''))
    .filter(Boolean)
  return modules.length ? modules : ['app']
}

/**
 * Every `applicationId`/`namespace`/manifest `package` in the project.
 *
 * @param {string} root - the Gradle root.
 * @returns {Promise<string[]>} the identifiers, in discovery order.
 */
async function applicationIds(root) {
  /** @type {Set<string>} */
  const ids = new Set()
  await walkProjectFiles(root, 5, async (file, item) => {
    if (!item.isFile()) return
    if (/build\.gradle(\.kts)?$/.test(item.name)) {
      const text = await readFile(file, 'utf8').catch(() => '')
      for (const match of text.matchAll(/(?:applicationId|namespace)\s*(?:=|\s)\s*["']([^"']+)["']/g)) {
        const id = match[1]
        if (id) ids.add(id)
      }
    }
    if (item.name === 'AndroidManifest.xml') {
      const text = await readFile(file, 'utf8').catch(() => '')
      const match = text.match(/\bpackage=["']([^"']+)["']/)
      const id = match?.[1]
      if (id) ids.add(id)
    }
  })
  return [...ids]
}

/**
 * Locate APK products under the standard `build/outputs/apk` trees.
 *
 * @param {string} root - the Gradle root.
 * @param {string[]} [modules] - module names; defaults to `app`.
 * @returns {Promise<string[]>} absolute APK paths.
 */
export async function findApks(root, modules = []) {
  const names = modules.length ? modules.map((item) => item.replace(/^:+/, '') || 'app') : ['app']
  const roots = [
    ...names.map((name) => path.join(root, name, 'build', 'outputs', 'apk')),
    path.join(root, 'build', 'outputs', 'apk'),
  ]
  const hits = await Promise.all(roots.map((dir) => walkApks(dir, 5)))
  return unique(hits.flat())
}

/**
 * Bounded directory walk that reports project files to `cb`.
 *
 * @param {string} dir - the directory to walk.
 * @param {number} depth - how many levels are left.
 * @param {(file: string, item: import('node:fs').Dirent) => Promise<void>} cb - the per-file reporter.
 * @returns {Promise<void>} resolves when the walk is done.
 */
async function walkProjectFiles(dir, depth, cb) {
  if (depth < 0) return
  /** @type {import('node:fs').Dirent[]} */
  const items = await readdir(dir, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    items
      .filter((item) => !item.name.startsWith('.') && !SKIP_DIRS.has(item.name))
      .map(async (item) => {
        const file = path.join(dir, item.name)
        await cb(file, item)
        if (item.isDirectory()) await walkProjectFiles(file, depth - 1, cb)
      }),
  )
}

/**
 * Bounded walk collecting `.apk` files.
 *
 * The return type is written out because the function calls itself: without it
 * the compiler cannot tell the recursion apart from its own result and falls
 * back to `any`.
 *
 * @param {string} dir - the directory to walk.
 * @param {number} depth - how many levels are left.
 * @returns {Promise<string[]>} the absolute APK paths.
 */
async function walkApks(dir, depth) {
  if (depth < 0) return []
  /** @type {import('node:fs').Dirent[]} */
  const items = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return (
    await Promise.all(
      items
        .filter((item) => !item.name.startsWith('.'))
        .map(async (item) => {
          const file = path.join(dir, item.name)
          if (item.isFile() && item.name.endsWith('.apk')) return [file]
          if (item.isDirectory()) return walkApks(file, depth - 1)
          return []
        }),
    )
  ).flat()
}

/**
 * The subset of `files` that already exists.
 *
 * @param {string[]} files - the absolute paths to probe.
 * @returns {Promise<string[]>} the paths that are already there.
 */
async function present(files) {
  return (await Promise.all(files.map(async (file) => ((await exists(file)) ? file : undefined)))).filter(
    (file) => file !== undefined,
  )
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
 * Reduce an app name to a Kotlin/Gradle-safe identifier.
 *
 * @param {string} value - the app name.
 * @returns {string} the identifier.
 * @throws When the name carries no letter or digit.
 */
function cleanName(value) {
  const out = String(value).replace(/[^A-Za-z0-9_]/g, '')
  if (!out) throw new Error('App name must contain letters or numbers.')
  if (/^[0-9]/.test(out)) return `App${out}`
  return out
}

/**
 * Validate a dotted Java package name.
 *
 * @param {string} value - the package name.
 * @returns {string} the package name, unchanged.
 * @throws When the name is not a valid Java package.
 */
function packageName(value) {
  const parts = String(value).split('.')
  const good = parts.length > 1 && parts.every((part) => /^[A-Za-z][A-Za-z0-9_]*$/.test(part))
  if (!good) throw new Error(`Invalid Android package name: ${value}`)
  return value
}

/**
 * Validate an SDK level against the range `aapt2` accepts.
 *
 * @param {number} value - the SDK level.
 * @param {string} field - the field's name, for the error message.
 * @returns {number} the SDK level.
 * @throws When the level is outside the accepted range.
 */
function sdkLevel(value, field) {
  if (!Number.isInteger(value) || value < 21 || value > 99) throw new Error(`Invalid ${field}: ${value}`)
  return value
}

/**
 * Lowercase, underscore-safe package segment.
 *
 * @param {string} value - the app name.
 * @returns {string} the package segment.
 */
function slug(value) {
  const out = String(value)
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()
  if (/^[0-9]/.test(out)) return `app_${out}`
  return out || 'app'
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
