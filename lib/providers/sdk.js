import { access, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { brief, ok, run } from '../util/run.js'

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
 * @param {Runtime} rt - the call runtime.
 * @returns {string[]} absolute, de-duplicated candidates.
 */
export function sdkRoots(rt) {
  const env = rt.env
  const configured = [rt.settings.sdkPath, env.ANDROID_HOME, env.ANDROID_SDK_ROOT].filter((item) =>
    Boolean(item && String(item).trim()),
  )
  return unique([
    ...configured.map((item) => path.resolve(rt.cwd, String(item))),
    path.join(os.homedir(), 'Library', 'Android', 'sdk'),
    path.join(os.homedir(), 'Android', 'Sdk'),
    ...windowsSdkRoots(env),
    '/opt/android-sdk',
    '/usr/local/share/android-sdk',
    '/opt/homebrew/share/android-commandlinetools',
  ])
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
    const resolved = path.resolve(rt.cwd, configured)
    // An explicitly configured root that does not exist is still reported, so
    // preflight can name the exact wrong path instead of silently searching on.
    return resolved
  }
  for (const item of sdkRoots(rt)) {
    if (await exists(item)) return item
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
 * @param {Runtime} rt - the call runtime.
 * @param {string} name - the tool to locate.
 * @returns {Promise<string|undefined>} absolute executable path.
 */
async function locateTool(rt, name) {
  const viaPath = await which(rt, name)
  if (viaPath) return viaPath
  const rels = toolPaths(name)
  for (const root of sdkRoots(rt)) {
    for (const rel of rels) {
      for (const candidate of executableCandidates(path.join(root, rel))) {
        if (await exists(candidate)) return candidate
      }
    }
  }
  return undefined
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
    rt.env.PATH,
  ].filter((item) => Boolean(item))
  return {
    JAVA_HOME: java,
    ANDROID_HOME: root,
    ANDROID_SDK_ROOT: root,
    PATH: paths.join(path.delimiter),
  }
}

/**
 * Resolve a JDK home for the configured major version.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<string|undefined>} absolute JDK home.
 */
export async function javaHome(rt) {
  const version = String(rt.settings.jdkMajor ?? '17').trim() || '17'
  const configured = rt.env.JAVA_HOME?.trim()
  if (configured && (await exists(path.join(configured, 'bin', javaBin())))) return configured

  if (process.platform === 'darwin') {
    const home = await run(['/usr/libexec/java_home', '-v', version], { timeout: 5000 })
    if (ok(home)) {
      const value = home.stdout.trim()
      if (value) return value
    }
  }

  for (const candidate of await javaHomes(rt, version)) {
    if (await exists(path.join(candidate, 'bin', javaBin()))) return candidate
  }

  // The fixed candidates above only cover Homebrew and the OpenJDK disk-image
  // layout. A machine whose only JDK of the requested major is an Adoptium or
  // Oracle install under a name those paths do not predict still resolves here,
  // by matching the discovered majors instead of guessing a path.
  const discovered = await listJavaHomes(rt)
  const match = discovered.find((item) => item.major === version)
  if (match) return match.home

  return undefined
}

/**
 * Every JDK home this host offers, for the settings page's suggestions.
 *
 * @param {Runtime} rt - the call runtime.
 * @returns {Promise<Array<{major: string, home: string}>>} discovered JDKs, newest major first.
 */
export async function listJavaHomes(rt) {
  /** @type {Map<string, {major: string, version: string, home: string}>} */
  const found = new Map()
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
        found.set(home, { major: majorOf(version), version, home })
      }
    }
  }
  const roots = [
    '/Library/Java/JavaVirtualMachines',
    '/opt/homebrew/opt',
    path.join(process.env.HOME ?? '', 'Library', 'Java', 'JavaVirtualMachines'),
  ]
  for (const root of roots) {
    for (const name of await childNames(root)) {
      const home = name.startsWith('openjdk@')
        ? path.join(root, name, 'libexec', 'openjdk.jdk', 'Contents', 'Home')
        : path.join(root, name, 'Contents', 'Home')
      const version = (name.match(/(\d+(?:\.\d+)*)/) ?? [])[1] ?? ''
      if ((await exists(path.join(home, 'bin', javaBin()))) && !found.has(home)) {
        found.set(home, { major: majorOf(version), version, home })
      }
    }
  }
  return [...found.values()].sort((left, right) => Number(right.major) - Number(left.major))
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
  const found = out.stdout.trim().split('\n')[0]?.trim()
  return found || undefined
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
 * Per-user Android SDK locations on Windows.
 *
 * @param {NodeJS.ProcessEnv} env - the environment to read.
 * @returns {string[]} the candidate roots.
 */
function windowsSdkRoots(env) {
  return [
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Android', 'Sdk') : undefined,
    path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
  ].filter((item) => item !== undefined)
}

/**
 * Fixed per-platform JDK locations for one major version.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {string} version - the JDK major version.
 * @returns {Promise<string[]>} the candidate JDK homes.
 */
async function javaHomes(rt, version) {
  const fixed = [
    `/opt/homebrew/opt/openjdk@${version}/libexec/openjdk.jdk/Contents/Home`,
    `/Library/Java/JavaVirtualMachines/openjdk-${version}.jdk/Contents/Home`,
    path.join(rt.env.ProgramFiles || '', 'Eclipse Adoptium', `jdk-${version}`),
    path.join(rt.env.ProgramFiles || '', 'Java', `jdk-${version}`),
  ].filter(Boolean)
  if (process.platform !== 'win32') return fixed
  const pattern = new RegExp(`^jdk-${escapeRegex(version)}`, 'i')
  return unique([
    ...fixed,
    ...(await childDirs(path.join(rt.env.ProgramFiles || '', 'Eclipse Adoptium'), pattern)),
    ...(await childDirs(path.join(rt.env.ProgramFiles || '', 'Java'), pattern)),
  ])
}

/**
 * Directory entries matching `pattern`.
 *
 * @param {string} root - the directory to scan.
 * @param {RegExp} pattern - the matcher for entry names.
 * @returns {Promise<string[]>} the matching directories.
 */
async function childDirs(root, pattern) {
  return (await childNames(root)).filter((name) => pattern.test(name)).map((name) => path.join(root, name))
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
 * Escape a literal for embedding in a `RegExp`.
 *
 * @param {string} value - the literal.
 * @returns {string} the escaped literal.
 */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
