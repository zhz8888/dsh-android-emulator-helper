import { readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ok, run, runBytes } from './run.js'

/**
 * Windows discovery helpers.
 *
 * The Android SDK and a JDK are usually installed where their installer put
 * them, not where an environment variable says they are. On Windows that means
 * three places this module knows how to read, in the order the plugin needs
 * them:
 *
 *   - the **process environment**, which answers immediately but only knows
 *     about variables that existed when the host started;
 *   - the **registry**, which still holds a user's `ANDROID_HOME` after the
 *     host process has been running for days, and which is where every JDK
 *     installer records its own home;
 *   - the **filesystem**, by probing the drive roots for the well-known
 *     install layouts.
 *
 * Every helper here is read-only and never throws: a machine without a
 * registry, without a second drive or with a locked-down `System32` must
 * degrade to "not found", not to a failed tool call.
 *
 * @module @zhz8888/dsh-android-emulator-helper/util/windows
 */

/**
 * Whether the plugin is running on Windows.
 *
 * @returns {boolean} true on Windows.
 */
export function isWindows() {
  return process.platform === 'win32'
}

/**
 * How long a drive root may take to answer before it is given up on.
 *
 * A letter that is mapped to a disconnected network share blocks until the
 * SMB timeout expires, and one such letter would otherwise stall every
 * lookup. The probe is abandoned rather than waited out.
 */
const DRIVE_PROBE_MS = 2_000

/**
 * Resolve with `undefined` when a promise takes too long.
 *
 * The abandoned work is not cancelled — `fs` offers no portable way to stop
 * it — but its outcome is swallowed, so a drive that answers late changes
 * nothing.
 *
 * @template T
 * @param {Promise<T>} promise - the work to bound.
 * @param {number} ms - the deadline in milliseconds.
 * @returns {Promise<T | undefined>} the result, or `undefined` when the deadline wins.
 */
async function within(promise, ms) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * The drive letters this machine has mounted.
 *
 * A drive that is not mounted, or that is a disconnected network share, is
 * simply absent from the result. The letters are probed at the same time, so
 * one unreachable share costs the probe its timeout rather than twenty-six
 * times it.
 *
 * @returns {Promise<string[]>} the drive roots, each ending in a separator.
 */
export async function driveRoots() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  const results = await Promise.all(
    letters.map(async (letter) => {
      const root = `${letter}:${path.sep}`
      const reachable = await within(
        stat(root).then(
          () => true,
          () => false,
        ),
        DRIVE_PROBE_MS,
      )
      return reachable === true ? root : undefined
    }),
  )
  return results.filter((item) => item !== undefined)
}

/**
 * The sub-directory names of one directory.
 *
 * @param {string} dir - the directory to read.
 * @returns {Promise<string[]>} the directory names, empty when unreadable.
 */
export async function childDirNames(dir) {
  const items = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return items.filter((item) => item.isDirectory()).map((item) => item.name)
}

/**
 * The `Program Files` directory of this machine.
 *
 * The environment variable is the authority, but a host that scrubs it must
 * still find the default location. The name is spelled in several cases in
 * the wild — the environment on Windows is case-insensitive, the shell is
 * not — and the 32-bit directory is deliberately **not** a fallback here:
 * a 64-bit JDK is never installed into it, and using it would miss every
 * 64-bit vendor directory.
 *
 * @param {NodeJS.ProcessEnv} [env] - the environment to read.
 * @returns {string} the directory, without a trailing separator.
 */
export function programFiles(env = process.env) {
  const value = env.ProgramFiles ?? env.PROGRAMFILES
  if (typeof value === 'string' && value.trim()) return value.trim()
  return 'C:\\Program Files'
}

/**
 * The registry's `reg.exe`.
 *
 * `System32` holds the 64-bit binary on a 64-bit Windows, and `PATH` holds
 * it on every machine that has a default `PATH`. The absolute path is tried
 * first because a scrubbed `PATH` would otherwise hide it, and the Windows
 * directory is read from the environment rather than assumed to be `C:\` — a
 * Windows installed on another drive puts `System32` there.
 *
 * @param {NodeJS.ProcessEnv} [env] - the environment to read.
 * @returns {string} the executable to run.
 */
export function regExe(env = process.env) {
  const system = env.SystemRoot ?? env.SYSTEMROOT ?? env.WINDIR ?? 'C:\\Windows'
  return path.join(system, 'System32', 'reg.exe')
}

/**
 * The console's code page, which is the encoding `reg.exe` writes in.
 *
 * `reg.exe` writes its output in the machine's ANSI code page, so a path with
 * non-ASCII characters comes back as bytes in that encoding rather than as
 * UTF-8. The code page is read once per process: it changes only when the
 * user changes it, and reading it costs a child process.
 *
 * @returns {Promise<number>} the code page number; 65001 when it cannot be read.
 */
export function consoleCodepage() {
  codepage ??= (async () => {
    const out = await run(['cmd.exe', '/d', '/s', '/c', 'chcp'], { timeout: 5000 })
    if (!ok(out)) return 65001
    const match = out.stdout.match(/(\d{3,5})/)
    const value = match?.[1] ? Number.parseInt(match[1], 10) : 65001
    return Number.isFinite(value) ? value : 65001
  })()
  return codepage
}

/** @type {Promise<number> | undefined} */
let codepage

/**
 * The `TextDecoder` label for a Windows code page.
 *
 * Node ships the full ICU data, so the encodings a Chinese, Japanese or
 * Korean Windows uses are all decodable — but only under their own label.
 * `windows-936` is not one of them; `gb18030` is, and it is a superset of
 * GBK, which is what code page 936 actually stores.
 *
 * @type {Map<number, string>}
 */
const CODEPAGE_LABELS = new Map([
  [437, 'ibm866'],
  [874, 'windows-874'],
  [932, 'shift_jis'],
  [936, 'gb18030'],
  [949, 'euc-kr'],
  [950, 'big5'],
  [1250, 'windows-1250'],
  [1251, 'windows-1251'],
  [1252, 'windows-1252'],
  [65001, 'utf-8'],
])

/**
 * Decode bytes a Windows console program wrote.
 *
 * @param {Buffer} bytes - the raw output.
 * @returns {Promise<string>} the decoded text.
 */
export async function decodeWindowsText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  const page = await consoleCodepage()
  const label = CODEPAGE_LABELS.get(page) ?? 'utf-8'
  return new TextDecoder(label).decode(bytes)
}

/**
 * One registry value.
 *
 * @typedef {object} RegistryValue
 * @property {string} key - the full key the value lives under.
 * @property {string} name - the value's name.
 * @property {string} value - the value's text.
 */

/**
 * Read the values of one name from a key and its sub-keys.
 *
 * `reg query <key> /s /v <name>` is the one call that answers both "what is
 * this value" and "what values do the sub-keys hold", which is how the JDK
 * registry records one home per installed version. Without a name every
 * string value of the key and its sub-keys is collected, which is how the
 * registry's own copy of the environment is read.
 *
 * @param {string} key - the key to read, sub-keys included.
 * @param {string} [name] - the value name to collect; every string value when omitted.
 * @returns {Promise<RegistryValue[]>} the values found; empty when the key is absent.
 */
export async function registryValues(key, name, env = process.env) {
  const args = [regExe(env), 'query', key, '/s']
  if (name !== undefined) args.push('/v', name)
  const out = await runBytes(args, { timeout: 5000 })
  if (!ok(out)) return []
  const text = await decodeWindowsText(out.bytes)
  /** @type {RegistryValue[]} */
  const found = []
  let current = ''
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('HKEY_')) {
      current = trimmed
      continue
    }
    // The name is matched reluctantly: a value whose name contains a space
    // would otherwise be cut at the space and read as a shorter name.
    const match = trimmed.match(/^(.+?)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/)
    if (!match) continue
    const valueName = match[1]
    if (valueName === undefined) continue
    if (name !== undefined && valueName !== name) continue
    const raw = match[2] ?? ''
    found.push({ key: current, name: valueName, value: raw.trim() })
  }
  return found
}

/**
 * Read one registry value.
 *
 * @param {string} key - the key to read.
 * @param {string} name - the value's name.
 * @param {NodeJS.ProcessEnv} [env] - the environment to read.
 * @returns {Promise<string | undefined>} the value, when the key and name exist.
 */
export async function registryValue(key, name, env = process.env) {
  const found = await registryValues(key, name, env)
  return found[0]?.value
}

/**
 * Expand the `%NAME%` references a registry string may hold.
 *
 * `REG_EXPAND_SZ` values are stored unexpanded — `REG_SZ` values are not —
 * so a value read from the registry is expanded against the environment before
 * it is used as a path.
 *
 * @param {string} value - the raw value.
 * @param {NodeJS.ProcessEnv} [env] - the environment to expand against.
 * @returns {string} the expanded value.
 */
export function expandEnvRefs(value, env = process.env) {
  return value.replace(/%([^%]+)%/g, (match, name) => {
    const replacement = env[name.trim()]
    return typeof replacement === 'string' ? replacement : match
  })
}

/**
 * The environment variables Windows keeps in the registry.
 *
 * A variable the user set after the host started is invisible to
 * `process.env` — the host inherited the environment it was launched with and
 * nothing refreshes it. The registry still has it, so `ANDROID_HOME` set
 * through the Windows settings is readable here even hours later.
 *
 * @param {NodeJS.ProcessEnv} [env] - the environment to expand against.
 * @returns {Promise<Record<string, string>>} the registry's environment values.
 */
export async function registryEnvironment(env = process.env) {
  const keys = ['HKCU\\Environment', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment']
  /** @type {Record<string, string>} */
  const found = {}
  for (const key of keys) {
    const values = await registryValues(key, undefined, env)
    for (const item of values) {
      if (!item.name) continue
      found[item.name] = expandEnvRefs(item.value, env)
    }
  }
  return found
}

/**
 * The user's home directory from the environment rather than from `os`.
 *
 * `os.homedir()` reads `USERPROFILE` and falls back to the account's
 * profile, which is right; the environment is preferred here because a test
 * may pass one in.
 *
 * @param {NodeJS.ProcessEnv} [env] - the environment to read.
 * @returns {string} the home directory.
 */
export function userHome(env = process.env) {
  const value = env.USERPROFILE ?? env.HOME
  if (typeof value === 'string' && value.trim()) return value.trim()
  return os.homedir()
}
