import { mkdir, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** Directory name used under the DSH home (and as the temp-file fallback prefix). */
export const DATA_DIR_NAME = 'android-emulator-helper'

/**
 * Resolve one output directory inside the plugin data root, creating it.
 *
 * `settings.dataDir` wins when set; otherwise the plugin writes under the DSH
 * home (`$DSH_HOME`, else `~/.dsh`) so screenshots and build logs survive a
 * reboot. A deployment without a writable home still gets a working directory:
 * the final fallback is the system temp directory.
 *
 * @param {string} dataRoot - absolute data root already resolved from settings.
 * @param {string[]} part - path segments appended to the root.
 * @returns {Promise<string>} the created absolute directory.
 */
export async function dataDir(dataRoot, ...part) {
  const dir = path.join(dataRoot, ...part)
  await mkdir(dir, { recursive: true })
  return dir
}

/**
 * Fallback data root when the user configured none.
 *
 * @param {NodeJS.ProcessEnv} [env] - environment to read `DSH_HOME` from.
 * @returns {string} an absolute path; not created here.
 */
export function defaultDataRoot(env = process.env) {
  const home = env.DSH_HOME?.trim()
  if (home) return path.join(home, DATA_DIR_NAME)
  const userHome = os.homedir()
  if (userHome) return path.join(userHome, '.dsh', DATA_DIR_NAME)
  return path.join(os.tmpdir(), DATA_DIR_NAME)
}

/**
 * Expand a leading `~` in a user-supplied directory setting.
 *
 * `path.resolve()` does not expand a tilde, and the settings page's own
 * placeholder for the data directory is `~/.dsh/android-emulator-helper`, so a
 * user who types the suggested value literally used to get a directory named
 * `~` created inside their project. Only `~` and `~/…` are expanded; a bare `~`
 * in the middle of a path is a legal filename character and is left alone.
 *
 * @param {string} value - the raw setting.
 * @param {NodeJS.ProcessEnv} [env] - environment to read `HOME` from.
 * @returns {string} the path with a leading tilde expanded.
 */
export function expandHome(value, env = process.env) {
  const text = String(value ?? '')
  if (text !== '~' && !text.startsWith(`~${path.sep}`) && !text.startsWith('~/')) return text
  const home = env.HOME?.trim() || os.homedir()
  if (!home) return text
  return text === '~' ? home : path.join(home, text.slice(2))
}

/**
 * Resolve a caller-supplied path against the session workspace and refuse escapes.
 *
 * Tool arguments arrive from the model, so a relative `../..` must not silently
 * reach outside the workspace the user opened. An absolute path is accepted
 * only while it still resolves inside that workspace: the SDK and the session
 * header may live elsewhere, but a tool argument never widens the area this
 * plugin writes to.
 *
 * The comparison is case-folded on Windows and macOS, whose default volumes are
 * case-insensitive: `/Users/me/Work/app` and `/Users/me/work/app` are the same
 * file there, and a byte-wise prefix test would reject a path the user really
 * opened. This is a lexical check; {@link insideForWrite} adds the symbolic
 * link check for paths that are about to be written through.
 *
 * @param {string} base - absolute session workspace directory.
 * @param {string} raw - the requested path.
 * @returns {string} the resolved absolute path.
 */
export function inside(base, raw) {
  const out = path.resolve(base, raw)
  const foldedBase = foldCase(base)
  const foldedOut = foldCase(out)
  const prefix = foldedBase.endsWith(path.sep) ? foldedBase : foldedBase + path.sep
  if (foldedOut === foldedBase || foldedOut.startsWith(prefix)) return out
  throw new Error(`Path escapes the session workspace: ${raw}`)
}

/**
 * Resolve a path that is about to be written, following symbolic links.
 *
 * {@link inside} is lexical, so a symbolic link that already exists inside the
 * workspace (`workspace/link -> /outside`) passes it while `writeFile` writes
 * through the link to the outside target. This resolves the deepest existing
 * ancestor of the target and re-checks it against the resolved workspace, which
 * catches both a symlinked file and a symlinked parent directory. It returns
 * the lexical path so callers keep the path the user asked for.
 *
 * @param {string} base - absolute session workspace directory.
 * @param {string} raw - the requested write path.
 * @returns {Promise<string>} the resolved absolute lexical path.
 * @throws When the real target lies outside the real workspace.
 */
export async function insideForWrite(base, raw) {
  const out = inside(base, raw)
  // A workspace that no longer exists cannot be resolved; the lexical check
  // above is then the only answer available, and it already accepted `out`.
  const realBase = await realpath(base).catch(() => undefined)
  if (realBase === undefined) return out
  let probe = out
  while (true) {
    const real = await realpath(probe).catch(() => undefined)
    if (real !== undefined) {
      const foldedBase = foldCase(realBase)
      const foldedProbe = foldCase(real)
      const prefix = foldedBase.endsWith(path.sep) ? foldedBase : foldedBase + path.sep
      if (foldedProbe === foldedBase || foldedProbe.startsWith(prefix)) return out
      throw new Error(`Path escapes the session workspace through a symbolic link: ${raw}`)
    }
    const parent = path.dirname(probe)
    if (parent === probe) return out
    probe = parent
  }
}

/** Whether this platform's filesystem comparison should ignore case. */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin'

/**
 * Fold a path for a containment comparison on a case-insensitive filesystem.
 *
 * @param {string} value - the path to fold.
 * @returns {string} the comparable path.
 */
function foldCase(value) {
  return CASE_INSENSITIVE ? value.toLowerCase() : value
}

/**
 * Express `file` relative to the session workspace when it lies inside it.
 *
 * @param {string} cwd - the session workspace.
 * @param {string} file - the absolute path to express.
 * @returns {string} the relative path, or `.` for the workspace itself.
 */
export function rel(cwd, file) {
  return path.relative(cwd, file) || '.'
}
