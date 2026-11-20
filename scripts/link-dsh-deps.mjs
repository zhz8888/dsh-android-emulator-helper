#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, renameSync, rmSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * Link DSH runtime packages from a local install for offline development.
 *
 * Peers resolve through the host at runtime; this script lets `pnpm test`,
 * `pnpm run check` and the smoke scripts find them without a registry round trip.
 * Sources: the profile's `node_modules` (schemastery, cordis) or the DSH app bundle.
 * Use `--app <dir>` / `--profile <dir>` to override, `--clean` to remove the links.
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = path.join(ROOT, 'node_modules', '@deepseek-ai')

/** Packages needed to run the suite against a local DSH installation. */
const PACKAGES = ['schemastery', 'cordis', 'dsh-tools']

/**
 * The user's home directory for this host (`USERPROFILE` first on Windows).
 *
 * Reading `HOME` alone gives a relative path on Windows, where `cmd.exe` and
 * PowerShell 7 do not set it — a Git Bash `HOME` is `/c/Users/…`, which the
 * Windows path module resolves against the current drive.
 *
 * @param {NodeJS.ProcessEnv} [env] - the environment to read.
 * @param {NodeJS.Platform} [platform] - the platform to answer for.
 * @returns {string} an absolute home directory.
 */
function homeDirectory(env = process.env, platform = process.platform) {
  if (platform === 'win32') return env.USERPROFILE ?? env.HOME ?? os.homedir()
  return env.HOME ?? os.homedir()
}

/**
 * The DSH desktop app-bundle directory for this platform.
 *
 * `DSH_DESKTOP_APP` overrides the default; `undefined` means no default exists
 * (so the caller must pass `--app` rather than mistaking this for "not installed").
 *
 * @param {{platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv}} [options] - the host to resolve for.
 * @returns {string | undefined} the app directory, when the platform has a default.
 */
function defaultAppDirectory({ platform = process.platform, env = process.env } = {}) {
  if (typeof env.DSH_DESKTOP_APP === 'string' && env.DSH_DESKTOP_APP.length > 0) return env.DSH_DESKTOP_APP
  if (platform === 'darwin') return '/Applications/DSH Desktop.app/Contents/Resources/app'
  if (platform === 'win32') {
    const programs =
      typeof env.LOCALAPPDATA === 'string' && env.LOCALAPPDATA.length > 0 ? path.join(env.LOCALAPPDATA, 'Programs') : undefined
    return programs === undefined ? undefined : path.join(programs, 'DSH Desktop', 'resources', 'app')
  }
  return path.join(homeDirectory(env, platform), '.local', 'share', 'dsh-desktop', 'resources', 'app')
}

/**
 * The profile directory the desktop app boots from.
 *
 * `DSH_PROFILE_DIR` from the running host wins; otherwise derive it from home.
 *
 * @param {{env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform}} [options] - the host to resolve for.
 * @returns {string} the profile directory.
 */
function defaultProfileDirectory({ env = process.env, platform = process.platform } = {}) {
  if (typeof env.DSH_PROFILE_DIR === 'string' && env.DSH_PROFILE_DIR.length > 0) return env.DSH_PROFILE_DIR
  return path.join(homeDirectory(env, platform), '.dsh', 'profiles', env.DSH_PROFILE ?? 'desktop')
}

/** Read `--flag value` from argv, refusing a flag with no value. */
function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    console.error(`--${name} needs a value, e.g. --${name} <directory>`)
    process.exit(2)
  }
  return value
}

/** Whether the path exists as an entry of any kind, including a dangling link. */
function entryExists(candidate) {
  try {
    lstatSync(candidate)
    return true
  } catch {
    return false
  }
}

/**
 * Whether the path is a link this script could have created (`lstat` sees a
 * Windows junction as a symlink); a real pnpm package directory is never removed.
 */
function isLink(candidate) {
  try {
    return lstatSync(candidate).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Replace `link` with a link to `source` without destroying the old entry first.
 *
 * Use a Windows **junction** (no `SeCreateSymbolicLinkPrivilege` needed) and stage
 * the link under a temporary name: moving the old entry aside, never deleting it
 * up front, means a failed swap restores the original instead of losing the package.
 *
 * @param {string} source - the package directory to link to.
 * @param {string} link - the entry to replace.
 * @param {NodeJS.Platform} [platform] - the link flavour to create.
 * @returns {void} throws when the link cannot be created or moved into place.
 */
function replaceWithLink(source, link, platform = process.platform) {
  const type = platform === 'win32' ? 'junction' : 'dir'
  const temporary = `${link}.tmp-${process.pid}`
  const backup = `${link}.bak-${process.pid}`
  rmSync(temporary, { recursive: true, force: true })
  rmSync(backup, { recursive: true, force: true })
  try {
    symlinkSync(source, temporary, type)
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true })
    throw new Error(
      `could not create a directory ${type} for ${path.basename(link)}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  let moved = false
  try {
    if (entryExists(link)) {
      renameSync(link, backup)
      moved = true
    }
    renameSync(temporary, link)
    if (moved) rmSync(backup, { recursive: true, force: true })
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true })
    if (moved && !entryExists(link)) {
      try {
        renameSync(backup, link)
      } catch {
        // The restore failed too; the message below still says what was lost.
      }
    }
    throw new Error(
      `could not replace ${path.relative(ROOT, link)}: ${error instanceof Error ? error.message : String(error)}${moved ? ` (the previous entry is at ${path.basename(backup)})` : ''}`,
    )
  }
}

if (process.argv.includes('--clean')) {
  // Only remove the links this script creates. `node_modules/@deepseek-ai` also
  // holds pnpm's own entries — `dsh-client-ui-primitives` among them, which the
  // client half's type gate needs — so deleting the directory would break
  // `pnpm run typecheck` until a reinstall. A package directory is not this
  // script's link either, and removing it would be the same loss.
  let removed = 0
  for (const name of PACKAGES) {
    const link = path.join(TARGET, name)
    if (!entryExists(link)) continue
    if (!isLink(link)) {
      console.warn(`kept ${path.relative(ROOT, link)}: it is an installed package, not a link this script made`)
      continue
    }
    rmSync(link, { recursive: true, force: true })
    console.log(`removed ${path.relative(ROOT, link)}`)
    removed += 1
  }
  console.log(`\n${removed} link(s) removed.`)
  process.exit(0)
}

const appDir = arg('app', defaultAppDirectory())
const profileDir = arg('profile', defaultProfileDirectory())

mkdirSync(TARGET, { recursive: true })

let linked = 0
let failed = 0
/** Packages whose source was found in neither root. */
const missing = []
for (const name of PACKAGES) {
  const candidates = [
    appDir === undefined ? undefined : path.join(appDir, 'node_modules', '@deepseek-ai', name),
    path.join(profileDir, 'node_modules', '@deepseek-ai', name),
  ].filter((candidate) => candidate !== undefined)
  const source = candidates.find((candidate) => existsSync(candidate))
  if (source === undefined) {
    missing.push(name)
    continue
  }
  try {
    replaceWithLink(source, path.join(TARGET, name))
  } catch (error) {
    failed += 1
    console.error(`FAILED ${name}: ${error instanceof Error ? error.message : String(error)}`)
    continue
  }
  console.log(`linked ${name} -> ${source}`)
  linked += 1
}

// One actionable message instead of one "skip" per package: when a root is
// wrong, every package misses for the same reason, and the fix is the same flag.
if (missing.length > 0) {
  console.warn(`\nnot found: ${missing.join(', ')}`)
  console.warn(`  app root:     ${appDir ?? '(no default on this platform; pass --app <dir>)'}`)
  console.warn(`  profile root: ${profileDir}`)
  console.warn('Pass --app <dir> and/or --profile <dir> to point at the DSH installation.')
}

console.log(`\n${linked}/${PACKAGES.length} runtime packages linked${failed > 0 ? `, ${failed} failed` : ''}. Run \`pnpm run check\` next.`)
process.exit(failed > 0 ? 1 : 0)
