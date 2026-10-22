import { mkdir } from 'node:fs/promises'
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
 * Resolve a caller-supplied path against the session workspace and refuse escapes.
 *
 * Tool arguments arrive from the model, so a relative `../..` must not silently
 * reach outside the workspace the user opened. An absolute path is accepted
 * as-is because the user's own settings and the session header may legitimately
 * point outside the workspace (an SDK installed under `/opt`, for example).
 *
 * @param {string} base - absolute session workspace directory.
 * @param {string} raw - the requested path.
 * @returns {string} the resolved absolute path.
 */
export function inside(base, raw) {
  const out = path.resolve(base, raw)
  if (out === base || out.startsWith(base + path.sep)) return out
  throw new Error(`Path escapes the session workspace: ${raw}`)
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
