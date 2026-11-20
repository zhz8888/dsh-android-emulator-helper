import { mkdir, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** Directory name used under the DSH home (and as the temp-file fallback prefix). */
export const DATA_DIR_NAME = 'android-emulator-helper'

/**
 * Resolve one output directory under the data root, creating it.
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
export function defaultDataRoot(env = process.env, base = process.cwd()) {
  const home = env.DSH_HOME?.trim()
  // A relative DSH_HOME would otherwise make the data root relative too, and
  // a relative data root is created against whatever directory the process
  // happens to be in — which is the host's, not the session's. Resolving it
  // against the session workspace keeps the root inside that workspace.
  if (home) {
    return path.isAbsolute(home)
      ? path.join(home, DATA_DIR_NAME)
      : path.resolve(base, home, DATA_DIR_NAME)
  }
  const userHome = os.homedir()
  if (userHome) return path.join(userHome, '.dsh', DATA_DIR_NAME)
  return path.join(os.tmpdir(), DATA_DIR_NAME)
}

/**
 * Expand a leading `~` in a user-supplied directory setting.
 *
 * @param {string} value - the raw setting.
 * @param {NodeJS.ProcessEnv} [env] - environment to read `HOME` from.
 * @returns {string} the path with a leading tilde expanded.
 */
export function expandHome(value, env = process.env) {
  const text = String(value ?? '')
  // Only a leading `~` or `~/` expands; a mid-path tilde is a legal filename.
  if (text !== '~' && !text.startsWith(`~${path.sep}`) && !text.startsWith('~/')) return text
  const home = env.HOME?.trim() || os.homedir()
  if (!home) return text
  return text === '~' ? home : path.join(home, text.slice(2))
}

/**
 * Resolve a path against the session workspace, refusing escapes (lexical).
 *
 * Absolute paths are accepted only while still inside the workspace; comparison
 * is case-folded on case-insensitive volumes. {@link insideForWrite} adds the
 * symlink check for write targets.
 *
 * @param {string} base - absolute session workspace directory.
 * @param {string} raw - the requested path.
 * @returns {string} the resolved absolute path.
 */
export function inside(base, raw) {
  // The base is normalised before it is compared. A caller may hand over a
  // path that is not already the resolved form — a rooted-but-drive-less path,
  // a mixed-case directory, a trailing separator — and comparing that against
  // the resolved `out` would reject a path that is plainly inside the
  // workspace. POSIX has the same defect whenever the two spellings differ; it
  // is simply rarer there.
  const root = path.resolve(base)
  const out = path.resolve(root, raw)
  const foldedBase = foldCase(root)
  const foldedOut = foldCase(out)
  const prefix = foldedBase.endsWith(path.sep) ? foldedBase : foldedBase + path.sep
  if (foldedOut === foldedBase || foldedOut.startsWith(prefix)) return out
  throw new Error(`Path escapes the session workspace: ${raw}`)
}

/**
 * Resolve a write path following symlinks, refusing targets outside the workspace.
 *
 * {@link inside} is lexical and misses `workspace/link -> /outside`; this
 * re-checks the deepest existing ancestor against the real workspace, yet
 * returns the original lexical path.
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
