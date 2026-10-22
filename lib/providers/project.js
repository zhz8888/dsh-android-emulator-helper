import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { insideForWrite } from '../util/path.js'
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
 * @property {string | undefined} applicationModule - the module that assembles an application, when one was identified.
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
  const applicationModule = absRoot ? await applicationModuleFor(absRoot, modules) : undefined
  const ids = absRoot ? await applicationIds(absRoot, applicationModule) : []
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
    applicationModule,
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
  const root = await insideForWrite(cwd, input.dir || name)
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
 * Name of the build file a Gradle module declares its Android settings in.
 *
 * @param {string} root - the Gradle root.
 * @param {string} module - the Gradle module path (`:app`, `:feature:login`, or `app`).
 * @returns {string} the absolute build-file path without its extension; `.kts`
 *   is tried before `.gradle` by {@link moduleBuildText}.
 */
function moduleBuildPath(root, module) {
  return path.join(root, moduleDirectory(module), 'build.gradle')
}

/**
 * Convert a Gradle module path into the directory that holds it.
 *
 * Gradle calls a nested subproject `:feature:login`, while the filesystem nests
 * it as `feature/login`. Treating the colons as part of one directory name
 * cannot find the module's build file or its APK output.
 *
 * @param {string} module - the Gradle module path.
 * @returns {string} the module's directory relative to the Gradle root.
 */
export function moduleDirectory(module) {
  return String(module).replace(/^:+/, '').split(':').filter(Boolean).join(path.sep) || 'app'
}

/**
 * An application module's id: `applicationId`, then `namespace`.
 *
 * @param {string} root - the Gradle root.
 * @param {string} [module] - the module to read; omitted means the `app` module.
 * @returns {Promise<string | undefined>} the application id, when the module declares one.
 */
export async function applicationIdFor(root, module = ':app') {
  const text = await moduleBuildText(root, module)
  const applicationId = text.match(/applicationId\s*(?:=|\s)\s*["']([^"']+)["']/)
  if (applicationId?.[1]) return applicationId[1]
  return text.match(/namespace\s*(?:=|\s)\s*["']([^"']+)["']/)?.[1]
}

/**
 * The module that assembles the installable application, when one exists.
 *
 * A `settings.gradle` only lists modules; it never says which one is the
 * application. The first `include(...)` may well be a library, so the default
 * build target cannot be `modules[0]`. The module whose build file declares the
 * Android application plugin or an `applicationId` is the one a caller means by
 * "the app", and an `app` module is the conventional fallback.
 *
 * @param {string} root - the Gradle root.
 * @param {string[]} modules - the modules the settings file declares.
 * @returns {Promise<string | undefined>} the application module, when identified.
 */
async function applicationModuleFor(root, modules) {
  for (const module of modules) {
    const text = await moduleBuildText(root, module)
    if (/com\.android\.application/.test(text) || /\bapplicationId\s*(?:=|\s)\s*["']/.test(text)) return module
  }
  return modules.find((module) => /(?:^|:)app$/.test(module))
}

/**
 * Read a module's `build.gradle.kts` or `build.gradle`.
 *
 * @param {string} root - the Gradle root.
 * @param {string} module - the Gradle module path.
 * @returns {Promise<string>} the build file text, or an empty string.
 */
async function moduleBuildText(root, module) {
  const base = moduleBuildPath(root, module)
  return (await readFile(`${base}.kts`, 'utf8').catch(() => undefined)) ?? (await readFile(base, 'utf8').catch(() => ''))
}

/**
 * Every `applicationId`/`namespace`/manifest `package` in the project.
 *
 * The walk is concurrent, so the order ids are discovered in is not stable. The
 * list is therefore sorted, with the identified application module's own id
 * first: callers use element zero as "the application id", and a random library
 * namespace there would make `build_and_run` launch the wrong package.
 *
 * @param {string} root - the Gradle root.
 * @param {string} [applicationModule] - the module that assembles the application.
 * @returns {Promise<string[]>} the identifiers, deterministically ordered.
 */
async function applicationIds(root, applicationModule) {
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
  const preferred = applicationModule === undefined ? undefined : await applicationIdFor(root, applicationModule)
  const rest = [...ids].filter((id) => id !== preferred).sort()
  return preferred === undefined ? rest : [preferred, ...rest]
}

/**
 * Locate APK products under the standard `build/outputs/apk` trees.
 *
 * @param {string} root - the Gradle root.
 * @param {string[]} [modules] - module names; defaults to `app`.
 * @returns {Promise<string[]>} absolute APK paths.
 */
export async function findApks(root, modules = []) {
  const names = modules.length ? modules.map(moduleDirectory) : ['app']
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
