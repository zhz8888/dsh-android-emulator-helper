import { access, readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readPropertiesValue } from '../util/properties.js'
import { expandHome } from '../util/path.js'
import { brief, ok, run } from '../util/run.js'
import {
  childDirNames,
  driveRoots,
  isWindows,
  programFiles,
  registryEnvironment,
  registryValues,
  userHome,
} from '../util/windows.js'

/**
 * Android SDK discovery and tool resolution.
 *
 * Ported from the ZCode plugin's `providers/sdk.ts`, with two changes: the
 * search order now starts from the user's `sdkPath` setting, and every entry
 * point is async-safe against a runtime rather than reading `process.env`
 * globals. The macOS/Windows/Linux candidate list is unchanged so an existing
 * Android Studio install is found without any configuration.
 *
 * @module @zhz8888/dsh-android-emulator-helper/providers/sdk
 */

/**
 * The per-call runtime the providers read.
 *
 * `lib/runtime.js` owns the real object and its typedef; the providers name
 * it here rather than describing a second, local shape that could drift from
 * the one the host actually builds.
 *
 * @typedef {import('../runtime.js').Runtime} Runtime
 */

/**
 * SDK-relative locations of each command-line tool, in preference order.
 *
 * The map is typed explicitly so its keys form a literal union. A tool name
 * outside the map is then a compile error at the call site instead of a
 * lookup that quietly finds nothing and reports "Missing Android tool" for a
 * name the caller never meant to send.
 *
 * @typedef {{
 *   adb: readonly string[],
 *   emulator: readonly string[],
 *   sdkmanager: readonly string[],
 *   avdmanager: readonly string[],
 *   apkanalyzer: readonly string[],
 *   gradle: readonly string[],
 * }} ToolPaths
 */

/**
 * @type {ToolPaths}
 */
const TOOL_PATHS = {
  adb: ['platform-tools/adb'],
  emulator: ['emulator/emulator'],
  sdkmanager: ['cmdline-tools/latest/bin/sdkmanager', 'cmdline-tools/bin/sdkmanager', 'tools/bin/sdkmanager'],
  avdmanager: ['cmdline-tools/latest/bin/avdmanager', 'cmdline-tools/bin/avdmanager', 'tools/bin/avdmanager'],
  apkanalyzer: ['cmdline-tools/latest/bin/apkanalyzer', 'cmdline-tools/bin/apkanalyzer'],
  gradle: [],
}

/**
 * The tool names the plugin can resolve.
 *
 * @typedef {keyof typeof TOOL_PATHS} ToolName
 */

/**
 * Candidate SDK roots, most specific first.
 *
 * The order is the order of how sure the plugin is about each candidate: an
 * explicitly configured path, then the environment the user exported, then
 * the registry's copy of that environment, then the per-platform defaults.
 *
 * On Windows the registry matters more than it looks. A user who sets
 * `ANDROID_HOME` through the Windows settings has it in
 * `HKCU\Environment`, but the host process inherited its environment when it
 * started and never refreshes it — so `process.env.ANDROID_HOME` stays
 * undefined for the life of the process while the registry still has the
 * value the user typed. Reading it there is the difference between finding
 * the SDK and reporting that it is missing.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<string[]>} absolute, de-duplicated candidates.
 */
export async function sdkRoots(rt) {
  const env = rt.env
  const configured = [rt.settings.sdkPath, env.ANDROID_HOME, env.ANDROID_SDK_ROOT].filter((item) =>
    Boolean(item && String(item).trim()),
  )
  return unique([
    ...configured.map((item) => path.resolve(rt.cwd, expandHome(String(item), env))),
    ...(await registrySdkRoots(rt)),
    ...(await remembered(`sdk-roots|${sdkCacheKey(rt)}`, async () => [
      ...(await projectSdkRoots(rt)),
      ...(await studioSdkRoots(rt)),
      ...(await windowsSdkRoots(rt)),
    ])),
    path.join(os.homedir(), 'Library', 'Android', 'sdk'),
    path.join(os.homedir(), 'Android', 'Sdk'),
    '/opt/android-sdk',
    '/usr/local/share/android-sdk',
    '/opt/homebrew/share/android-commandlinetools',
  ])
}

/**
 * What the SDK discovery depends on, as one cache key.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {string} the key.
 */
function sdkCacheKey(rt) {
  const env = rt.env
  return [
    rt.cwd,
    rt.settings.sdkPath ?? '',
    env.ANDROID_HOME ?? '',
    env.ANDROID_SDK_ROOT ?? '',
    env.LOCALAPPDATA ?? '',
    env.APPDATA ?? '',
    env.USERPROFILE ?? '',
  ].join('|')
}

/**
 * The SDK root a project records in its `local.properties`.
 *
 * The Android Gradle Plugin writes `sdk.dir` into every project it builds, so
 * a workspace that holds one remembers the SDK it was built against — even on
 * a machine where no environment variable names it. The value is read with
 * the JVM's own unescaping rules, because the file stores `D\:\\Android\\Sdk`
 * and the path is only `D:\Android\Sdk` once the escapes are undone.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<string[]>} the recorded roots.
 */
async function projectSdkRoots(rt) {
  const value = await readPropertiesValue(path.join(rt.cwd, 'local.properties'), 'sdk.dir')
  return value ? [path.resolve(rt.cwd, value)] : []
}

/**
 * The SDK root Android Studio records.
 *
 * Android Studio writes the path of the SDK it uses into
 * `%APPDATA%\Google\AndroidStudio<version>\options\android.sdk.path.xml`.
 * The record is a preference and it goes stale — a machine whose SDK was
 * moved keeps naming the old directory — so the value is only a candidate;
 * whether it still holds an SDK is decided later.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<string[]>} the recorded roots.
 */
async function studioSdkRoots(rt) {
  const appData = rt.env.APPDATA?.trim()
  if (!appData) return []
  const google = path.join(appData, 'Google')
  const roots = []
  for (const name of await childDirNames(google)) {
    if (!name.startsWith('AndroidStudio')) continue
    const file = path.join(google, name, 'options', 'android.sdk.path.xml')
    const text = await readFile(file, 'utf8').catch(() => '')
    const match = text.match(/androidSdkAbsolutePath\s+value\s*=\s*"([^"]*)"/)
    if (match?.[1]) roots.push(match[1])
  }
  return roots
}

/**
 * The SDK roots the registry's copy of the environment names.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<string[]>} the roots; empty when the registry has none.
 */
async function registrySdkRoots(rt) {
  if (!isWindows()) return []
  const values = await remembered(`registry-env|${rt.env.USERPROFILE ?? ''}`, () =>
    registryEnvironment(rt.env),
  )
  /** @type {string[]} */
  const names = []
  for (const item of [values.ANDROID_HOME, values.ANDROID_SDK_ROOT]) {
    if (typeof item === 'string' && item.trim()) names.push(item)
  }
  return names.map((item) => path.resolve(rt.cwd, item.trim()))
}

/**
 * The per-user and per-drive SDK locations on Windows.
 *
 * `%LOCALAPPDATA%\Android\Sdk` is where the SDK Manager installs by default.
 * The drive scan covers the other common layout — an SDK kept on a second
 * drive under `Android\Sdk` — which nothing else records: the registry does
 * not mention it, and the environment variable is usually not set for it.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<string[]>} the candidate roots.
 */
async function windowsSdkRoots(rt) {
  if (!isWindows()) return []
  const env = rt.env
  const localAppData = env.LOCALAPPDATA?.trim()
  const candidates = [
    localAppData ? path.join(localAppData, 'Android', 'Sdk') : undefined,
    path.join(userHome(env), 'AppData', 'Local', 'Android', 'Sdk'),
  ]
  for (const root of await driveRoots()) {
    for (const rel of ['Android\\Sdk', 'Android\\android-sdk', 'android-sdk', 'Android']) {
      candidates.push(path.join(root, rel))
    }
  }
  return candidates.filter((item) => item !== undefined)
}

/**
 * Whether a directory is an Android SDK root rather than one of its parents.
 *
 * Existence alone is not enough: `D:\Android` holds `D:\Android\Sdk`, and a
 * scan that stopped at the first directory it found would name the parent and
 * then fail to find `platform-tools` inside it.
 *
 * @param {string} dir - the directory to test.
 * @returns {Promise<boolean>} whether the directory holds an SDK.
 */
export async function isSdkRoot(dir) {
  for (const marker of ['platform-tools', 'cmdline-tools', 'emulator', 'tools', 'platforms', 'build-tools']) {
    if (await exists(path.join(dir, marker))) return true
  }
  return false
}

/**
 * First existing SDK root, or `undefined`.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<string|undefined>} the SDK root.
 */
export async function sdkRoot(rt) {
  const configured = String(rt.settings.sdkPath ?? '').trim()
  if (configured) {
    const resolved = path.resolve(rt.cwd, expandHome(configured, rt.env))
    // An explicitly configured root that does not exist is still reported, so
    // preflight can name the exact wrong path instead of silently searching on.
    return resolved
  }
  for (const item of await sdkRoots(rt)) {
    if (await isSdkRoot(item)) return item
  }
  return undefined
}

/**
 * Locate one SDK tool: `PATH` first, then every candidate SDK root.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {ToolName} name - the tool to locate.
 * @returns {Promise<string|undefined>} absolute executable path.
 */
export async function findTool(rt, name) {
  return locateTool(rt, name)
}

/**
 * Locate one SDK tool by any name.
 *
 * `findTool` is the checked door into this module: its `name` is one of the
 * tool names the plugin knows, so a typo is refused by the compiler instead of
 * degrading into a tool that is simply never found. This helper takes any
 * string, for the caller that probes a name chosen at run time.
 *
 * The SDK's own copy of a tool wins over a copy that happens to be on
 * `PATH`. A machine often has more than one `adb` — the SDK's, and one a
 * package manager installed — and the two are different programs with
 * different versions. The emulator and `sdkmanager` of one SDK talk to that
 * SDK's `platform-tools`, so the plugin uses the same one; otherwise the
 * plugin would drive the emulator with one `adb` and talk to it with another.
 *
 * Only the **resolved** SDK root is probed, not every candidate the discovery
 * considered. A root the user named is the SDK the plugin uses, and a scan
 * that turned up another installation must not quietly supply a second
 * version of the same tool behind the user's back.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} name - the tool to locate.
 * @returns {Promise<string|undefined>} absolute executable path.
 */
async function locateTool(rt, name) {
  const rels = toolPaths(name)
  const root = await sdkRoot(rt)
  if (root) {
    for (const rel of rels) {
      for (const candidate of executableCandidates(path.join(root, rel))) {
        if (await exists(candidate)) return candidate
      }
    }
    for (const candidate of await cmdlineToolsCandidates(root, name)) {
      if (await exists(candidate)) return candidate
    }
  }
  const viaPath = await which(rt, name)
  if (viaPath) return viaPath
  return undefined
}

/**
 * The command-line tools of a versioned `cmdline-tools` directory.
 *
 * `cmdline-tools/latest` is the alias the SDK Manager writes, but a version
 * installed by hand — or a second version beside it — lives in
 * `cmdline-tools/13.0`, and the alias may be missing altogether.
 *
 * @param {string} root - the SDK root.
 * @param {string} name - the tool to locate.
 * @returns {Promise<string[]>} the candidate paths.
 */
async function cmdlineToolsCandidates(root, name) {
  if (name !== 'sdkmanager' && name !== 'avdmanager' && name !== 'apkanalyzer') return []
  const dir = path.join(root, 'cmdline-tools')
  const found = []
  for (const version of await childDirNames(dir)) {
    for (const candidate of executableCandidates(path.join(dir, version, 'bin', name))) {
      found.push(candidate)
    }
  }
  return found
}

/**
 * The SDK-relative locations of one tool, in preference order.
 *
 * @param {string} name - the tool name.
 * @returns {readonly string[]} the locations to probe; empty for an unknown tool.
 */
function toolPaths(name) {
  /** @type {Record<string, readonly string[]>} */
  const paths = TOOL_PATHS
  return paths[name] ?? []
}

/**
 * Resolve one SDK tool or fail with an actionable message.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {ToolName} name - the tool to resolve.
 * @returns {Promise<string>} absolute executable path.
 * @throws When the tool is missing.
 */
export async function requireTool(rt, name) {
  const found = await findTool(rt, name)
  if (found) return found
  throw new Error(`Missing Android tool: ${name}. Run android_preflight for setup details.`)
}

/**
 * Probe one tool with a version flag.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} name - the tool to probe.
 * @param {string[]} [versionArgs] - arguments that make the tool print its version.
 * @returns {Promise<{name: string, path?: string, ok: boolean, detail: string}>} the probe result.
 */
export async function checkTool(rt, name, versionArgs = ['--version']) {
  const found = await locateTool(rt, name)
  if (!found) return { name, ok: false, detail: 'not found' }
  const out = await run([found, ...versionArgs], { timeout: 10_000, env: await androidEnv(rt) })
  return {
    name,
    path: found,
    ok: ok(out),
    detail: ok(out) ? brief(out, 1000) || found : brief(out, 1000),
  }
}

/**
 * Environment for every Android child process: JAVA_HOME plus the SDK tools on `PATH`.
 *
 * Four places are prepended so `gradlew`, `adb`, `emulator` and `sdkmanager`
 * resolve without the user exporting anything.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<Record<string, string|undefined>>} the environment overlay.
 */
export async function androidEnv(rt) {
  const root = await sdkRoot(rt)
  const java = await javaHome(rt)
  const paths = [
    java ? path.join(java, 'bin') : undefined,
    root ? path.join(root, 'platform-tools') : undefined,
    root ? path.join(root, 'emulator') : undefined,
    root ? path.join(root, 'cmdline-tools', 'latest', 'bin') : undefined,
    root ? path.join(root, 'cmdline-tools', 'bin') : undefined,
    root ? path.join(root, 'tools', 'bin') : undefined,
    ...(root ? await cmdlineToolsBinDirs(root) : []),
    // The caller's own `PATH` is the fallback, and the host's when the caller
    // has none: the SDK's own tools are prepended, but without the system's
    // directories `cmd.exe` itself is no longer findable, and every `.bat`
    // launcher on Windows needs it.
    rt.env.PATH ?? process.env.PATH,
  ].filter((item) => Boolean(item))
  // A value that could not be resolved is left out rather than set to
  // `undefined`: the environment overlay is merged over the inherited one, and
  // an absent key drops the inherited value with it. A machine whose
  // `JAVA_HOME` names a JDK the resolver does not recognise would otherwise
  // lose it and reach `gradlew.bat` with no Java at all.
  /** @type {Record<string, string>} */
  const overlay = { PATH: paths.join(path.delimiter) }
  if (java) overlay.JAVA_HOME = java
  if (root) {
    overlay.ANDROID_HOME = root
    overlay.ANDROID_SDK_ROOT = root
  }
  overlay.ANDROID_USER_HOME = await androidUserHome(rt)
  overlay.ANDROID_AVD_HOME = await androidAvdHome(rt)
  return overlay
}

/**
 * The `bin` directory of every installed command-line tools version.
 *
 * @param {string} root - the SDK root.
 * @returns {Promise<string[]>} the directories.
 */
async function cmdlineToolsBinDirs(root) {
  const dir = path.join(root, 'cmdline-tools')
  const found = []
  for (const version of await childDirNames(dir)) {
    found.push(path.join(dir, version, 'bin'))
  }
  return found
}

/**
 * The directory that holds the user's Android files.
 *
 * `ANDROID_USER_HOME` moves the whole `.android` directory — the adb key,
 * the debug keystore and the AVDs with it. The tools read it, so the plugin
 * has to read it too: a machine that moved it would otherwise have the plugin
 * naming a path where nothing is.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<string>} the directory.
 */
export async function androidUserHome(rt) {
  const configured = rt.env.ANDROID_USER_HOME?.trim()
  if (configured) return path.resolve(rt.cwd, configured)
  return path.join(userHome(rt.env), '.android')
}

/**
 * The directory that holds the AVDs.
 *
 * `ANDROID_AVD_HOME` moves only the AVDs out of the user home, and the
 * emulator searches it before the default location.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<string>} the directory.
 */
export async function androidAvdHome(rt) {
  const configured = rt.env.ANDROID_AVD_HOME?.trim()
  if (configured) return path.resolve(rt.cwd, configured)
  return path.join(await androidUserHome(rt), 'avd')
}

/**
 * Resolve a JDK home for the configured major version.
 *
 * The configured major is a preference, not a requirement. A machine that has
 * no JDK of exactly that major still builds the project with the nearest one
 * it does have — the Android Gradle Plugin needs a JDK of at least 17, and a
 * newer one is as good as the requested one — and a machine with no JDK at
 * all cannot build anything. The preflight report names the JDK that was
 * actually used, so a version other than the one that was asked for is
 * visible rather than silent.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<string|undefined>} absolute JDK home.
 */
export async function javaHome(rt) {
  const requested = String(rt.settings.jdkMajor ?? '17').trim() || '17'
  const homes = await listJavaHomes(rt)

  const configured = String(rt.env.JAVA_HOME ?? '').trim()
  if (configured) {
    const match = homes.find((item) => samePath(item.home, configured))
    if (match) return match.home
    if (await exists(path.join(configured, 'bin', javaBin()))) return configured
  }

  const exact = homes.find((item) => item.major === requested)
  if (exact) return exact.home

  // The list is sorted newest major first, so the first newer JDK is the
  // newest one the machine has.
  const newer = homes.find((item) => Number(item.major) > Number(requested))
  if (newer) return newer.home
  const older = homes.find((item) => Number(item.major) < Number(requested))
  if (older) return older.home
  return undefined
}

/**
 * The JDK the plugin would use, and how it compares to the one that was asked for.
 *
 * @typedef {object} JavaHomeInfo
 * @property {string | undefined} home - the JDK home in use.
 * @property {string} requested - the major version the settings ask for.
 * @property {string} major - the major version of the JDK actually in use.
 * @property {boolean} exact - whether the JDK in use is the requested major.
 */

/**
 * Resolve the JDK the plugin uses, and how it compares to the requested one.
 *
 * The configured major is a preference, and a machine that has no JDK of
 * exactly that major still builds with the nearest one it does have. The
 * difference is reported rather than hidden, and a generated project is
 * pinned to the major of the JDK that will actually compile it — a project
 * that targets 17 while the build runs on 24 does not compile at all.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<JavaHomeInfo>} the JDK in use.
 */
export async function javaHomeInfo(rt) {
  const requested = String(rt.settings.jdkMajor ?? '17').trim() || '17'
  const home = await javaHome(rt)
  const homes = await listJavaHomes(rt)
  const found = home ? homes.find((item) => samePath(item.home, home)) : undefined
  const major = found?.major ?? requested
  return { home, requested, major, exact: major === requested }
}

/**
 * Every JDK home this host offers, for the settings page's suggestions.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<Array<{major: string, version: string, home: string}>>} discovered JDKs, newest major first.
 */
export async function listJavaHomes(rt) {
  return remembered(`jdk-homes|${jdkCacheKey(rt)}`, async () => {
    /** @type {Map<string, {major: string, version: string, home: string}>} */
    const found = new Map()
    for (const candidate of await javaCandidates(rt)) {
      const key = pathKey(candidate.home)
      if (found.has(key)) continue
      if (!(await exists(path.join(candidate.home, 'bin', javaBin())))) continue
      const version =
        candidate.version || versionFromName(candidate.home) || (await probeJavaVersion(candidate.home))
      const major = majorOf(version)
      if (!major) continue
      found.set(key, { major, version: version || major, home: candidate.home })
    }
    return [...found.values()].sort((left, right) => Number(right.major) - Number(left.major))
  })
}

/**
 * What the JDK discovery depends on, as one cache key.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {string} the key.
 */
function jdkCacheKey(rt) {
  const env = rt.env
  return [
    rt.settings.jdkMajor ?? '',
    env.JAVA_HOME ?? '',
    env.USERPROFILE ?? '',
    env.ProgramFiles ?? '',
    env.PATH ?? '',
  ].join('|')
}

/**
 * One place a JDK might be, and the version its name claims.
 *
 * @typedef {object} JdkCandidate
 * @property {string} home - the JDK home directory.
 * @property {string} version - the version the location's name claims, if any.
 */

/**
 * Every place this host may keep a JDK.
 *
 * On Windows the sources are the installer's own registry record, the vendor
 * directories under `Program Files`, the drive roots — an SDK and a JDK are
 * often kept on the same second drive — and the `java` on `PATH`, which
 * names the installation it belongs to even when it is only a launcher that
 * points into it.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<JdkCandidate[]>} the candidates, most authoritative first.
 */
async function javaCandidates(rt) {
  /** @type {JdkCandidate[]} */
  const candidates = []
  const env = rt.env

  const configured = env.JAVA_HOME?.trim()
  if (configured) candidates.push({ home: configured, version: '' })

  if (process.platform === 'darwin') {
    const all = await run(['/usr/libexec/java_home', '-V'], { timeout: 5000 })
    for (const line of `${all.stdout}${all.stderr}`.split(/\r?\n/)) {
      const match = line.match(/^\s*(\S+)\s+.*?"[^"]*"\s+(\/.+)$/)
      if (match) {
        // The pattern has three groups; the first is the version, the second
        // the home. The guard above proves both exist, but the compiler cannot
        // see that, so the two are read through explicit fallbacks.
        const version = match[1] ?? ''
        const home = (match[2] ?? '').trim()
        if (home) candidates.push({ home, version })
      }
    }
  }

  if (isWindows()) {
    // Every JDK installer records where it put itself. The sub-key carries
    // the version — `...\JDK\24` or `...\JDK\21.0.6` — and the value carries
    // the home, so one registry read answers both. A 32-bit JDK writes to the
    // redirected view of the key, so both views are read.
    for (const key of [
      'HKLM\\SOFTWARE\\JavaSoft\\JDK',
      'HKLM\\SOFTWARE\\JavaSoft\\Java Development Kit',
      'HKLM\\SOFTWARE\\JavaSoft\\Java Runtime Environment',
      'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\JDK',
      'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\Java Development Kit',
      'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\Java Runtime Environment',
    ]) {
      for (const item of await registryValues(key, 'JavaHome', rt.env)) {
        const home = item.value.trim()
        if (!home) continue
        candidates.push({ home, version: item.key.split('\\').pop() ?? '' })
      }
    }
    for (const home of await windowsVendorJdkHomes(rt)) {
      candidates.push({ home, version: path.basename(home) })
    }
    for (const home of await windowsDriveJdkHomes(rt)) {
      candidates.push({ home, version: path.basename(home) })
    }
    const probed = await probePathJava(rt)
    if (probed) candidates.push(probed)
  }

  const roots = [
    '/Library/Java/JavaVirtualMachines',
    '/opt/homebrew/opt',
    path.join(userHome(env), 'Library', 'Java', 'JavaVirtualMachines'),
  ]
  for (const root of roots) {
    for (const name of await childNames(root)) {
      const home = name.startsWith('openjdk@')
        ? path.join(root, name, 'libexec', 'openjdk.jdk', 'Contents', 'Home')
        : path.join(root, name, 'Contents', 'Home')
      const version = (name.match(/(\d+(?:\.\d+)*)/) ?? [])[1] ?? ''
      candidates.push({ home, version })
    }
  }

  return candidates
}

/**
 * The JDK directories the vendors install into `Program Files`.
 *
 * @type {Array<[string, RegExp]>}
 */
const WINDOWS_JDK_VENDORS = [
  ['Eclipse Adoptium', /^jdk/i],
  ['Microsoft', /^jdk/i],
  ['Java', /^jdk/i],
  ['Amazon Corretto', /^jdk/i],
  ['Zulu', /^zulu/i],
  ['BellSoft', /^bellsoft/i],
  ['Semeru', /^jdk/i],
  ['GraalVM', /^graalvm/i],
  ['JetBrains', /^jbr/i],
]

/**
 * The JDKs the vendors installed under `Program Files`.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<string[]>} the JDK home directories.
 */
async function windowsVendorJdkHomes(rt) {
  const roots = [programFiles(rt.env), programFilesX86(rt.env)].filter((item) => item !== undefined)
  const homes = []
  for (const root of roots) {
    for (const [vendor, pattern] of WINDOWS_JDK_VENDORS) {
      const dir = path.join(root, vendor)
      for (const name of await childDirNames(dir)) {
        if (pattern.test(name)) homes.push(path.join(dir, name))
      }
    }
  }
  return homes
}

/**
 * The 32-bit `Program Files` directory.
 *
 * A 32-bit JDK installer writes to this one, and a machine that only has it
 * still builds a project.
 *
 * @param {NodeJS.ProcessEnv} env - the environment to read.
 * @returns {string | undefined} the directory, when the environment names it.
 */
function programFilesX86(env) {
  const value = env['ProgramFiles(x86)'] ?? env['PROGRAMFILES(X86)']
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * The JDKs kept at the root of a drive.
 *
 * A machine that puts its tools on a second drive keeps them together, so the
 * SDK's drive is also the JDK's drive: `D:\Java\jdk-21` sits next to
 * `D:\Android\Sdk` on a host that never set `JAVA_HOME` at all.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<string[]>} the JDK home directories.
 */
async function windowsDriveJdkHomes(rt) {
  const homes = []
  for (const root of await driveRoots()) {
    for (const name of await childDirNames(root)) {
      if (/^(jdk|jre|jres)[-._]?\d/i.test(name) || /^openjdk[-._]?\d/i.test(name)) {
        homes.push(path.join(root, name))
        continue
      }
      if (!/^(java|jdk|jre|jres)$/i.test(name)) continue
      for (const sub of await childDirNames(path.join(root, name))) {
        if (/^(jdk|jre|jres)[-._]?\d/i.test(sub) || /^openjdk[-._]?\d/i.test(sub)) {
          homes.push(path.join(root, name, sub))
        }
      }
    }
  }
  return homes
}

/**
 * The JDK the `java` on `PATH` belongs to.
 *
 * `java -XshowSettings:properties -version` prints the installation's own
 * home and its specification version, and it prints them on **stderr**. This
 * is the one mechanism that works for every vendor: the launcher Windows
 * installs under `Common Files\Oracle\Java\javapath` reports the real
 * installation's home rather than its own.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<JdkCandidate | undefined>} the candidate, when a `java` answers.
 */
async function probePathJava(rt) {
  const out = await run(['java', '-XshowSettings:properties', '-version'], {
    timeout: 10_000,
    env: rt.env,
  })
  if (!ok(out)) return undefined
  const text = `${out.stdout}\n${out.stderr}`
  const home = text.match(/^\s*java\.home\s*=\s*(.+)$/m)?.[1]?.trim()
  if (!home) return undefined
  const version = text.match(/^\s*java\.specification\.version\s*=\s*(.+)$/m)?.[1]?.trim() ?? ''
  return { home, version }
}

/**
 * The version a JDK's own directory name claims.
 *
 * The vendors name their directories after the version they installed —
 * `jdk-21`, `jdk-21.0.5.11`, `jdk1.8.0_401` — so the name is usually the
 * cheapest answer to "which major is this?". A home whose name says nothing
 * about its version (`C:\Java\current`) has to ask the interpreter instead.
 *
 * @param {string} home - the JDK home directory.
 * @returns {string} the version, empty when the name carries none.
 */
function versionFromName(home) {
  const name = path.basename(home)
  return name.match(/(\d+(?:\.\d+)*)/)?.[1] ?? ''
}

/**
 * The version of one JDK, read from the interpreter itself.
 *
 * @param {string} home - the JDK home directory.
 * @returns {Promise<string>} the version, empty when it cannot be read.
 */
async function probeJavaVersion(home) {
  const out = await run([path.join(home, 'bin', javaBin()), '-version'], { timeout: 10_000 })
  if (!ok(out)) return ''
  const text = `${out.stdout}\n${out.stderr}`
  return text.match(/version\s+"([^"]+)"/)?.[1] ?? ''
}

/**
 * The major version a settings value is written against.
 *
 * `java_home -V` and directory names report full versions, and the setting is a
 * major, so `24.0.2` becomes `24`. The legacy `1.8.x` scheme is the exception:
 * Java 8 is `8`, not `1`, which is exactly the kind of off-by-one that would
 * otherwise send `jdkMajor: 8` at the wrong interpreter.
 *
 * @param {string} version - a dotted version, with or without a suffix.
 * @returns {string} the major version, or an empty string when unparseable.
 */
export function majorOf(version) {
  const parts = String(version).match(/\d+/g)
  if (parts === null || parts.length === 0) return ''
  const first = parts[0] ?? ''
  // `1.8.x` is Java 8: the leading `1` is the scheme, not the major.
  if (first === '1' && parts.length > 1) return parts[1] ?? ''
  return first
}

/**
 * Resolve a name through the platform's `PATH` lookup.
 *
 * On Windows `where` answers with **every** copy on `PATH`, and the first one
 * is not always a copy Windows can run: a Gradle installation ships both
 * `gradle` — a shell script — and `gradle.bat`, and `where` lists the script
 * first. A shell script is not a Windows image, so spawning it fails with
 * "not a valid Win32 application" and the tool reports that the command
 * could not be started. The copy with a runnable extension is the one that
 * answers.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} name - the executable to look for.
 * @returns {Promise<string|undefined>} the absolute path, when the host has one.
 */
async function which(rt, name) {
  const out = await run(process.platform === 'win32' ? ['where', name] : ['which', name], {
    timeout: 5000,
    env: rt.env,
  })
  if (!ok(out)) return undefined
  const found = out.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (found.length === 0) return undefined
  const runnable = found.find((item) => /\.(exe|bat|cmd|com)$/i.test(item))
  return runnable ?? found[0]
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
 * De-duplicate by resolved absolute path, preserving order.
 *
 * @param {string[]} items - candidate paths.
 * @returns {string[]} the resolved, unique paths.
 */
function unique(items) {
  const seen = new Set()
  /** @type {string[]} */
  const out = []
  for (const item of items) {
    const resolved = path.resolve(item)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    out.push(resolved)
  }
  return out
}

/**
 * Windows-only executable suffixes for a bare tool name.
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
 * Platform `java` executable name.
 *
 * @returns {string} the executable's file name.
 */
function javaBin() {
  return process.platform === 'win32' ? 'java.exe' : 'java'
}

/**
 * Directory entry names, or `[]` when the root is absent.
 *
 * @param {string} root - the directory to scan.
 * @returns {Promise<string[]>} the sub-directory names.
 */
async function childNames(root) {
  if (!root) return []
  const items = await readdir(root, { withFileTypes: true }).catch(() => [])
  return items.filter((item) => item.isDirectory()).map((item) => item.name)
}

/**
 * A comparable form of a path, for matching two paths that name one file.
 *
 * Windows and macOS compare paths without regard to case, so `D:\Java\jdk-21`
 * and `d:\java\JDK-21` are one directory there and two strings elsewhere.
 *
 * @param {string} value - the path to fold.
 * @returns {string} the comparable path.
 */
function pathKey(value) {
  const resolved = path.resolve(value)
  return CASE_INSENSITIVE ? resolved.toLowerCase() : resolved
}

/**
 * Whether two paths name the same location.
 *
 * @param {string} left - the first path.
 * @param {string} right - the second path.
 * @returns {boolean} true when they are the same location.
 */
function samePath(left, right) {
  return pathKey(left) === pathKey(right)
}

/** Whether this platform compares paths without regard to case. */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin'

/**
 * How long a discovery result is reused before it is looked up again.
 *
 * The lookups behind it are not free: the registry and the `PATH` probe each
 * cost a child process, and the drive scan costs a directory listing. None of
 * them changes while a session runs, so the result is kept for a minute — long
 * enough that a run of tool calls pays for it once, short enough that a user
 * who installs the SDK and re-runs the diagnostic does not have to restart the
 * host to be believed.
 */
const DISCOVERY_TTL_MS = 60_000

/**
 * One remembered discovery result.
 *
 * @template T
 * @typedef {{value: T, at: number}} Remembered
 */

/** @type {Map<string, Remembered<unknown>>} */
const rememberedValues = new Map()

/**
 * Remember a discovery result for a short while.
 *
 * @template T
 * @param {string} key - what the lookup depends on.
 * @param {() => Promise<T>} produce - the lookup itself.
 * @returns {Promise<T>} the remembered or freshly produced value.
 */
async function remembered(key, produce) {
  const hit = rememberedValues.get(key)
  if (hit && Date.now() - hit.at < DISCOVERY_TTL_MS) {
    return /** @type {T} */ (hit.value)
  }
  const value = await produce()
  rememberedValues.set(key, { value, at: Date.now() })
  return value
}
