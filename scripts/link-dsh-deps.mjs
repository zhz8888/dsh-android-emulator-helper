#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * Bridge the DSH runtime packages into this package for offline development.
 *
 * The plugin's peer dependencies are provided by the host at runtime: inside a
 * booted DSH profile they resolve through the launcher's own resolution, and
 * nothing has to be installed here. For running `pnpm test`, `pnpm run check` or
 * the smoke scripts against a local DSH installation without a registry round
 * trip, this script symlinks each package from where DSH already keeps it.
 *
 * `@deepseek-ai/schemastery` and `@deepseek-ai/cordis` normally come from the
 * profile's own `node_modules`; the rest ship inside the DSH application
 * bundle. Pass `--app <dir>` / `--profile <dir>` to point at other locations.
 *
 *   node scripts/link-dsh-deps.mjs
 *   node scripts/link-dsh-deps.mjs --clean
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = path.join(ROOT, 'node_modules', '@deepseek-ai')

/** Packages needed to run the suite against a local DSH installation. */
const PACKAGES = ['schemastery', 'cordis', 'dsh-tools']

/** Read `--flag value` from argv. */
function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const appDir = arg('app', process.env.DSH_DESKTOP_APP ?? '/Applications/DSH Desktop.app/Contents/Resources/app')
const profileDir = arg('profile', path.join(process.env.HOME ?? '', '.dsh', 'profiles', 'desktop'))



if (process.argv.includes('--clean')) {
  // Only remove the links this script creates. `node_modules/@deepseek-ai` also
  // holds pnpm's own dependency links — `dsh-client-ui-primitives` among them,
  // which the client half's type gate needs — so deleting the directory would
  // break `pnpm run typecheck` until a reinstall.
  for (const name of PACKAGES) {
    rmSync(path.join(TARGET, name), { recursive: true, force: true })
    console.log(`removed ${path.relative(ROOT, path.join(TARGET, name))}`)
  }
  process.exit(0)
}

mkdirSync(TARGET, { recursive: true })

let linked = 0
for (const name of PACKAGES) {
  const candidates = [
    path.join(appDir, 'node_modules', '@deepseek-ai', name),
    path.join(profileDir, 'node_modules', '@deepseek-ai', name),
  ]
  const source = candidates.find((candidate) => existsSync(candidate))
  if (source === undefined) {
    console.warn(`skip ${name}: not found in\n  ${candidates.join('\n  ')}`)
    continue
  }
  const link = path.join(TARGET, name)
  rmSync(link, { recursive: true, force: true })
  symlinkSync(source, link, 'dir')
  console.log(`linked ${name} -> ${source}`)
  linked += 1
}

console.log(`\n${linked}/${PACKAGES.length} runtime packages linked. Run \`pnpm run check\` next.`)
