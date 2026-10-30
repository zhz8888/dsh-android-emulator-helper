import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { insideForWrite } from '../util/path.js'
import { templateFiles, jvmTargetFor, TEMPLATE_MIN_COMPILE_SDK } from './project-template.js'
import { javaHomeInfo, sdkRoot } from './sdk.js'

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
  // The variants a project offers are not a constant: an `applicationIdSuffix`
  // debug build, a custom `staging` build type or a `free`/`paid` flavor pair
  // all change the set. The application module's own build file is the source,
  // and `variantsFromBuildFile` falls back to `debug` when it cannot answer.
  const variants = absRoot
    ? variantsFromBuildFile(await moduleBuildText(absRoot, applicationModule ?? modules[0] ?? 'app'))
    : ['debug']

  return {
    root,
    gradleRoots,
    modules,
    applicationModule,
    variants,
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
 * Build types every Android application has even when the build file names none.
 *
 * AGP creates `debug` and `release` for every application module, so a
 * discovery that only reported the types a build file declares would still be
 * wrong for the common case: `assembleRelease` works without a `buildTypes`
 * block. They come first so `buildApp`'s default variant stays `debug`.
 */
const DEFAULT_BUILD_TYPES = ['debug', 'release']

/**
 * Words a real `buildTypes`/`productFlavors` block cannot declare.
 *
 * The variant scanner looks for `name {` at the block's top level; a stray
 * control structure or Kotlin scope function would otherwise be reported as a
 * variant. Gradle build-type and flavor names are identifiers, and none of
 * these is one.
 */
const NOT_A_VARIANT = new Set([
  'if',
  'else',
  'when',
  'while',
  'for',
  'do',
  'try',
  'catch',
  'finally',
  'fun',
  'val',
  'var',
  'class',
  'object',
  'interface',
  'init',
  'apply',
  'with',
  'also',
  'let',
  'run',
])

/**
 * Build variants a module offers, read from its `build.gradle(.kts)`.
 *
 * A project with product flavors names its variants as `flavor` + capitalized
 * build type (`freeDebug`, `paidRelease`), while a project without flavors uses
 * the build type alone (`debug`, `release`, `staging`). The result is ordered
 * `debug` first, because callers use element zero as "the variant to build
 * when the call names none", and an accidental `release` there would ask for a
 * signed build a fresh project cannot produce.
 *
 * @param {string} text - a module's `build.gradle(.kts)` text.
 * @returns {string[]} the variant names; `['debug']` when the file is unreadable.
 */
export function variantsFromBuildFile(text) {
  const source = stripComments(String(text ?? ''))
  if (source.trim() === '') return ['debug']
  const types = unique([...DEFAULT_BUILD_TYPES, ...declaredBlockNames(source, 'buildTypes')])
  const flavors = declaredBlockNames(source, 'productFlavors')
  if (flavors.length === 0) return types
  return unique(flavors.flatMap((flavor) => types.map((type) => `${flavor}${capitalized(type)}`)))
}

/**
 * The names declared by a `buildTypes`/`productFlavors` block.
 *
 * @param {string} source - the build file text, comments already removed.
 * @param {string} block - the block to read.
 * @returns {string[]} the declared names, in file order.
 */
function declaredBlockNames(source, block) {
  const body = braceBody(source, block)
  if (body === undefined) return []
  return topLevelBlockNames(body)
}

/**
 * The text between a named block's braces.
 *
 * A hand-written scanner rather than a regex, because the block contains nested
 * blocks: matching to the first `}` would stop inside the first build type and
 * lose the rest.
 *
 * @param {string} source - the build file text.
 * @param {string} name - the block to read, e.g. `buildTypes`.
 * @returns {string | undefined} the block's inner text, or undefined when absent or unbalanced.
 */
function braceBody(source, name) {
  const open = new RegExp(`(?:^|[^A-Za-z0-9_])${name}\\s*\\{`).exec(source)
  if (open === null) return undefined
  const start = open.index + open[0].length
  let depth = 1
  for (let at = start; at < source.length; at += 1) {
    const char = source[at]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, at)
    }
  }
  return undefined
}

/**
 * The `name { ... }` blocks declared directly inside one block body.
 *
 * Handles the Kotlin DSL's `release { ... }`, its explicit
 * `create("staging") { ... }`/`getByName("release") { ... }` forms, and the
 * Groovy DSL's `release { ... }`; nested blocks are skipped because only depth
 * zero is inspected.
 *
 * @param {string} body - a block's inner text.
 * @returns {string[]} the declared names, in file order.
 */
function topLevelBlockNames(body) {
  /** @type {string[]} */
  const names = []
  let depth = 0
  let at = 0
  while (at < body.length) {
    const char = body[at]
    if (char === '{') {
      depth += 1
      at += 1
      continue
    }
    if (char === '}') {
      depth = Math.max(0, depth - 1)
      at += 1
      continue
    }
    if (depth === 0) {
      const rest = body.slice(at)
      const factory = /^(?:create|getByName|maybeCreate|register)\s*\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\)\s*\{/.exec(rest)
      const named = /^([A-Za-z_][A-Za-z0-9_]*)\s*\{/.exec(rest)
      const match = factory ?? named
      if (match !== null) {
        const name = match[1] ?? ''
        if (name !== '' && !NOT_A_VARIANT.has(name)) names.push(name)
        depth = 1
        at += match[0].length
        continue
      }
    }
    at += 1
  }
  return names
}

/**
 * Strip line and block comments before the variant scanner sees them.
 *
 * A commented-out `// release { ... }` is not a declared variant, and a URL in
 * a comment would otherwise be read as code.
 *
 * @param {string} value - the build file text.
 * @returns {string} the text without comments.
 */
function stripComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/**
 * Capitalize a build type the way Gradle concatenates a flavor with it.
 *
 * @param {string} value - the build type name.
 * @returns {string} `debug` → `Debug`.
 */
function capitalized(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
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
  // The template pins AndroidX versions, and every AndroidX release declares a
  // `minCompileSdk` in its AAR metadata. `core-ktx` 1.15.0 declares 35, so a
  // project written with 34 or less fails during Gradle configuration with
  // "requires ... compile against version 35 or later". Creating it anyway
  // breaks the promise that android_create_app emits a project that builds
  // as-is, so the level is refused with the reason instead.
  if (compileSdk < TEMPLATE_MIN_COMPILE_SDK) {
    throw new Error(
      `Invalid compileSdk: ${compileSdk}. The bundled template pins androidx.core:core-ktx 1.15.0, whose minCompileSdk is ${TEMPLATE_MIN_COMPILE_SDK}; pass compileSdk ${TEMPLATE_MIN_COMPILE_SDK} or later.`,
    )
  }
  // The generated project pins ONE bytecode target for both its Java and its
  // Kotlin compilation. Left unpinned, AGP uses its own default while the Kotlin
  // plugin follows whichever JDK runs Gradle, and on a host whose JDK is newer
  // than the pinned AGP release a freshly generated app fails to compile with
  // "different JVM target compatibility".
  //
  // The target has to name the JDK that will actually compile the project. The
  // configured major is a preference, not a requirement: a host that has no JDK
  // of exactly that major builds with the nearest one it does have, so a
  // project still pinned to the setting builds on JDK 24 with a Java 17 target
  // and fails with "inconsistent JVM-target compatibility: Java 17 and 24".
  // `javaHomeInfo` reports the major of the JDK in use; the setting is only the
  // fallback for a host where no JDK could be resolved at all, and
  // `jvmTargetFor` clamps the result to a version both plugins can name.
  const java = await javaHomeInfo(rt)
  const jvmTarget = jvmTargetFor(java.home ? java.major : rt.settings.jdkMajor)
  // The setting used to be display-only: preflight reported it while the
  // generated project silently let AGP pick its own default (34.0.0 for the
  // pinned AGP), so a machine that had only newer build-tools still triggered
  // an SDK download. Pinning it here makes the setting mean what it says.
  const buildToolsVersion = buildToolsFor(rt.settings.buildToolsVersion)
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
    await writeFile(file.path, file.body({ name, pkg, minSdk, compileSdk, jvmTarget, buildToolsVersion }), 'utf8')
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
 * Kotlin hard keywords, as the Kotlin specification lists them.
 *
 * A package name is written verbatim into the generated `MainActivity.kt`, and
 * a hard keyword cannot appear as a package segment there: `package
 * com.example.when` does not parse. The list deliberately holds only the hard
 * keywords — `get`, `set`, `field`, `value` and friends are soft keywords and
 * are legal identifiers outside their special syntactic positions, so
 * rejecting them would refuse package names that compile fine.
 *
 * `import` is not a hard keyword in the specification but is a reserved token
 * at the head of every Kotlin file, and a package segment by that name is
 * equally unparsable in a package declaration.
 */
export const KOTLIN_HARD_KEYWORDS = new Set([
  'as',
  'break',
  'class',
  'continue',
  'do',
  'else',
  'false',
  'for',
  'fun',
  'if',
  'import',
  'in',
  'interface',
  'is',
  'null',
  'object',
  'package',
  'return',
  'super',
  'this',
  'throw',
  'true',
  'try',
  'typealias',
  'typeof',
  'val',
  'var',
  'when',
  'while',
])

/**
 * Validate a dotted Java package name.
 *
 * The format check is Java's; the keyword check is Kotlin's, because the same
 * string becomes the generated Kotlin file's `package` declaration.
 *
 * @param {string} value - the package name.
 * @returns {string} the package name, unchanged.
 * @throws When the name is not a valid Java package or a segment is a Kotlin hard keyword.
 */
function packageName(value) {
  const parts = String(value).split('.')
  const good = parts.length > 1 && parts.every((part) => /^[A-Za-z][A-Za-z0-9_]*$/.test(part))
  if (!good) throw new Error(`Invalid Android package name: ${value}`)
  const keyword = parts.find((part) => KOTLIN_HARD_KEYWORDS.has(part))
  if (keyword !== undefined) {
    throw new Error(
      `Invalid Android package name: ${value} (segment "${keyword}" is a Kotlin hard keyword and cannot appear in a package declaration)`,
    )
  }
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
 * Validate a configured build-tools release for the generated project.
 *
 * Empty means "let AGP choose", which is what every release before this one
 * did. A value that is not a plain release number is refused rather than
 * interpolated into Kotlin: `buildToolsVersion` lands inside a generated
 * `build.gradle.kts`, so anything with a quote or a newline would break the
 * project the plugin just wrote.
 *
 * @param {unknown} value - the `buildToolsVersion` setting.
 * @returns {string | undefined} the version to pin, or undefined to leave it to AGP.
 * @throws When the value is present but not a release number.
 */
function buildToolsFor(value) {
  const text = String(value ?? '').trim()
  if (text === '') return undefined
  if (!/^[0-9]+(\.[0-9]+)*$/.test(text)) throw new Error(`Invalid buildToolsVersion: ${text}`)
  return text
}

/**
 * Lowercase, underscore-safe package segment.
 *
 * The result is a hard keyword for a name such as "when" or "object", which
 * would generate a `MainActivity.kt` Kotlin refuses to parse. A trailing
 * underscore is the cheapest safe escape: it keeps the name recognisable and
 * makes the segment a legal identifier again. A name starting with a digit gets
 * an `app_` prefix for the same reason — a package segment must start with a
 * letter.
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
  if (KOTLIN_HARD_KEYWORDS.has(out)) return `${out}_`
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
