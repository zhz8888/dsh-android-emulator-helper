import assert from 'node:assert/strict'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { STATIC_MODULES } from './helpers/load-bundle.mjs'

/**
 * The shell's static module table.
 *
 * A client bundle may only `require` what the DSH web shell serves, so the
 * table this repository pins has to be the shell's own seed table. It used to
 * be shorter than the shell's, which made the helper refuse a bundle the shell
 * would have loaded — a stricter list is a bug, not extra safety. The shipped
 * SPA is the source of truth; the test below reads it when DSH is installed
 * and skips when it is not, because the suite itself is hermetic.
 *
 * Finding the SPA is platform work of its own. The desktop app is an Electron
 * bundle: a macOS install keeps it unpacked under `Contents/Resources/app`,
 * while a packaged Windows/Linux install ships `resources/app.asar` — an
 * archive whose contents only a reader for its header can see. A single
 * hardcoded macOS path therefore made this the one real-shell comparison that
 * never ran on the other two platforms, and its skip message claimed "no
 * installed DSH" on a machine that had one. The candidates below cover the
 * per-platform install locations, the running Electron host, and an explicit
 * `DSH_WEB_FRONTEND` override for a layout none of those guess (a portable
 * install, a checkout, a CI cache).
 */

/** Where an installed app keeps the built web frontend, inside its resources root. */
const FRONTEND_ASSETS = ['node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'assets']

/**
 * The candidate app roots on a host, most specific first.
 *
 * A root is either a directory holding `Resources/app` laid out like the macOS
 * bundle (`<root>/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets`), or
 * the packaged `app.asar` itself. `DSH_WEB_FRONTEND` may name any of: an app
 * root, the frontend package, its `dist/assets`, or an `app.asar`.
 *
 * @param {{platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv, resourcesPath?: string}} [options] - the host to resolve for.
 * @returns {string[]} the candidate roots.
 */
export function appRoots({ platform = process.platform, env = process.env, resourcesPath = process.resourcesPath } = {}) {
  const roots = []
  for (const override of [env.DSH_WEB_FRONTEND, env.DSH_DESKTOP_APP]) {
    if (typeof override === 'string' && override.length > 0) roots.push(override)
  }
  // Running inside the desktop app: `process.resourcesPath` is the `resources`
  // directory the app was started from, so the shell is right next to it.
  if (typeof resourcesPath === 'string' && resourcesPath.length > 0) {
    roots.push(path.join(resourcesPath, 'app.asar'), path.join(resourcesPath, 'app'))
  }
  if (platform === 'darwin') {
    roots.push('/Applications/DSH Desktop.app/Contents/Resources/app')
    roots.push(path.join(env.HOME ?? os.homedir(), 'Applications', 'DSH Desktop.app', 'Contents', 'Resources', 'app'))
    return roots
  }
  if (platform === 'win32') {
    const bases = [
      env.LOCALAPPDATA === undefined ? undefined : path.join(env.LOCALAPPDATA, 'Programs'),
      env.ProgramFiles,
      env['ProgramFiles(x86)'],
    ].filter((base) => typeof base === 'string' && base.length > 0)
    for (const base of bases) {
      for (const name of ['DSH Desktop', 'dsh-desktop', 'DSH']) {
        roots.push(path.join(base, name, 'resources', 'app'))
        roots.push(path.join(base, name, 'resources', 'app.asar'))
      }
    }
    return roots
  }
  roots.push(path.join(env.HOME ?? os.homedir(), '.local', 'share', 'dsh-desktop', 'resources', 'app'))
  roots.push('/opt/DSH Desktop/resources/app')
  roots.push('/opt/dsh-desktop/resources/app')
  return roots
}

/**
 * Whether the path exists and is a directory.
 *
 * @param {string} candidate - the path to test.
 * @returns {boolean} true for a directory.
 */
function isDirectory(candidate) {
  try {
    return statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

/** The entry names of a directory, or an empty list when it cannot be read. */
function entriesOf(directory) {
  try {
    return readdirSync(directory)
  } catch {
    return []
  }
}

/**
 * Read the JavaScript files of one directory, skipping any that cannot be read.
 *
 * @param {string} directory - the directory.
 * @returns {Array<{name: string, source: string}>} the sources.
 */
function javascriptOf(directory) {
  const sources = []
  for (const name of entriesOf(directory).filter((item) => item.endsWith('.js'))) {
    try {
      sources.push({ name, source: readFileSync(path.join(directory, name), 'utf8') })
    } catch {
      // An unreadable file cannot carry the seed table; the caller keeps looking.
    }
  }
  return sources
}

/**
 * The directories a candidate may hold the frontend's assets in.
 *
 * `DSH_WEB_FRONTEND` may name the assets directory itself, which is the one
 * layout the two joins below cannot see, so a directory that carries the
 * SPA's own `index-<hash>.js` is added to the front.
 *
 * @param {string} root - the candidate root.
 * @returns {string[]} the directories to try.
 */
function assetDirectories(root) {
  const directories = [path.join(root, ...FRONTEND_ASSETS), path.join(root, 'dist', 'assets')]
  const entries = isDirectory(root) ? entriesOf(root) : []
  if (entries.some((name) => name.startsWith('index-') && name.endsWith('.js'))) directories.unshift(root)
  return directories
}

/**
 * Read the frontend's JavaScript out of an Electron `app.asar` archive.
 *
 * An asar is a header — a 16-byte prefix whose last field is the header's
 * length, then a JSON directory of `{size, offset}` entries — followed by the
 * concatenated files. Only the frontend's own assets are read: the archive is
 * hundreds of megabytes and nothing here needs the rest of it.
 *
 * @param {string} archive - the `app.asar` path.
 * @returns {Array<{name: string, source: string}>|undefined} the sources, or undefined when the archive is unusable.
 */
function asarSources(archive) {
  let handle
  try {
    handle = openSync(archive, 'r')
    const prefix = Buffer.alloc(16)
    readSync(handle, prefix, 0, 16, 0)
    const headerSize = prefix.readUInt32LE(12)
    if (headerSize === 0 || headerSize > 16 * 1024 * 1024) return undefined
    const header = Buffer.alloc(headerSize)
    readSync(handle, header, 0, headerSize, 16)
    /** @type {{files?: Record<string, any>}} */
    let node = JSON.parse(header.toString('utf8'))
    for (const segment of FRONTEND_ASSETS) {
      node = node?.files?.[segment]
      if (node === undefined) return undefined
    }
    const base = 16 + headerSize
    const sources = []
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      if (!name.endsWith('.js')) continue
      const size = Number(entry.size)
      const data = Buffer.alloc(size)
      readSync(handle, data, 0, size, base + Number(entry.offset))
      sources.push({ name, source: data.toString('utf8') })
    }
    return sources.length > 0 ? sources : undefined
  } catch {
    return undefined
  } finally {
    if (handle !== undefined) closeSync(handle)
  }
}

/**
 * Every JavaScript source under one candidate's frontend.
 *
 * @param {string} candidate - an app root, the frontend package, an assets directory, or an `app.asar`.
 * @returns {Array<{name: string, source: string}>|undefined} the sources, or undefined when the candidate holds no frontend.
 */
function frontendSources(candidate) {
  if (candidate.endsWith('.asar')) return asarSources(candidate)
  if (!isDirectory(candidate)) return undefined
  for (const directory of assetDirectories(candidate)) {
    if (!isDirectory(directory)) continue
    const sources = javascriptOf(directory)
    if (sources.length > 0) return sources
  }
  return undefined
}

/**
 * The object literal that starts at the first `{` after `from`.
 *
 * @param {string} source - the bundle source.
 * @param {number} from - the offset to start looking at.
 * @returns {string|null} the literal, or null when it is not closed.
 */
function objectLiteralAfter(source, from) {
  const start = source.indexOf('{', from)
  if (start === -1) return null
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return null
}

/**
 * The specifiers one SPA bundle declares as its seed table.
 *
 * The shell builds the table once and hands it to the module loader as
 * `staticModules:NAME()`, where `NAME` is a function returning the object
 * literal whose keys are the specifiers. A bundle that does not carry that
 * shape is not the shell's entry chunk.
 *
 * @param {string} source - one JavaScript file of the SPA.
 * @returns {string[]|undefined} the specifiers, or undefined when this file does not declare them.
 */
export function staticSeed(source) {
  const marker = /staticModules:([A-Za-z_$][\w$]*)\s*\(/.exec(source)
  if (marker === null) return undefined
  const definition = source.indexOf(`function ${marker[1]}`)
  if (definition === -1) return undefined
  const returned = source.indexOf('return', definition)
  const literal = objectLiteralAfter(source, returned)
  if (literal === null) return undefined
  const keys = [...literal.matchAll(/(?:"([^"]*)"|([A-Za-z_$][\w$]*))\s*:/g)].map((match) => match[1] ?? match[2])
  return keys.includes('react/jsx-runtime') ? keys : undefined
}

/**
 * Locate the installed shell's seed table.
 *
 * @returns {{specifiers: string[], where: string} | {foundWithoutSeed?: true, where?: string, tried: string[]}} the outcome.
 */
export function installedShellSeed() {
  const tried = []
  for (const candidate of appRoots()) {
    tried.push(candidate)
    const sources = frontendSources(candidate)
    if (sources === undefined) continue
    for (const { name, source } of sources) {
      const specifiers = staticSeed(source)
      if (specifiers !== undefined) return { specifiers, where: candidate.endsWith('.asar') ? `${candidate}:${name}` : path.join(candidate, name) }
    }
    // A frontend was found but this build no longer declares a seed table:
    // that is a different answer from "DSH is not installed", and the reason
    // must say which one it is.
    return { foundWithoutSeed: true, where: candidate, tried }
  }
  return { tried }
}

test('the seed table matches the installed shell', (t) => {
  // This is the only assertion that compares the repository's table with a real
  // shell. Both arrays used to live in this repository, so the test compared two
  // hand-written copies and would stay green on any machine without a DSH
  // install; when there is no harness to read, skipping is more honest than
  // "passing" against itself — but the skip has to say *why*, and the reason
  // must not be "DSH is not installed" when the real problem is that the lookup
  // only knows one platform's layout.
  const outcome = installedShellSeed()
  if (outcome.specifiers === undefined) {
    const reason =
      outcome.foundWithoutSeed === true
        ? `a DSH web frontend was found at ${outcome.where} but it declares no staticModules seed table (the shell's bundle shape changed)`
        : `no installed DSH web frontend was found on this host (tried: ${outcome.tried.join(', ')}); point DSH_WEB_FRONTEND at the app directory, its dist/assets, or its app.asar to compare against it`
    t.skip(reason)
    return
  }
  assert.deepEqual([...STATIC_MODULES].sort(), [...outcome.specifiers].sort())
})

test('the app-root candidates follow the platform and the environment override', () => {
  // Each platform's install layout is pinned without needing that platform,
  // which is what makes the lookup reviewable: a macOS-only path was the bug.
  // Every expectation is built with `path.join` from the same segments the
  // implementation uses, so the assertions do not themselves assume a
  // separator.
  const windows = appRoots({
    platform: 'win32',
    env: {
      DSH_WEB_FRONTEND: 'D:\\portable-dsh\\resources\\app.asar',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      ProgramFiles: 'C:\\Program Files',
    },
    resourcesPath: '',
  })
  assert.equal(windows[0], 'D:\\portable-dsh\\resources\\app.asar', 'the override comes first')
  assert.ok(
    windows.includes(path.join('C:\\Users\\me\\AppData\\Local', 'Programs', 'DSH Desktop', 'resources', 'app.asar')),
  )
  assert.ok(windows.includes(path.join('C:\\Program Files', 'DSH Desktop', 'resources', 'app')))

  const linux = appRoots({ platform: 'linux', env: { HOME: '/home/me' }, resourcesPath: '' })
  assert.ok(linux.includes(path.join('/home/me', '.local', 'share', 'dsh-desktop', 'resources', 'app')))
  assert.ok(linux.includes('/opt/DSH Desktop/resources/app'))

  const mac = appRoots({ platform: 'darwin', env: { HOME: '/Users/me' }, resourcesPath: '' })
  assert.ok(mac.includes('/Applications/DSH Desktop.app/Contents/Resources/app'))

  // Running inside the desktop app, the shell sits beside `process.resourcesPath`.
  const running = appRoots({ platform: 'win32', env: {}, resourcesPath: path.join('D:\\DSH NEXT', 'resources') })
  assert.ok(running.includes(path.join('D:\\DSH NEXT', 'resources', 'app.asar')))
})

test('a packaged app.asar is read without unpacking it', (t) => {
  // The packaged desktop app keeps the SPA inside `app.asar`, so a directory
  // listing can never see it. A fixture in the archive format pins the reader
  // on every machine, including the ones with no DSH installed.
  const directory = mkdtempSync(path.join(os.tmpdir(), 'aemh-asar-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const archive = path.join(directory, 'app.asar')
  const inner = FRONTEND_ASSETS.join('/') + '/index-test.js'
  writeAsar(archive, inner, 'const t={staticModules:OZ()};function OZ(){return{react:1,"react/jsx-runtime":2}}')
  const sources = frontendSources(archive)
  assert.ok(sources !== undefined, 'the reader must find the frontend inside the archive')
  assert.deepEqual(staticSeed(sources[0].source), ['react', 'react/jsx-runtime'])
  // A candidate that is neither a directory nor an asar is not a frontend.
  assert.equal(frontendSources(path.join(directory, 'missing')), undefined)
})

test('the seed parser is not fooled by a bundle without a seed table', () => {
  assert.equal(staticSeed('const x = 1'), undefined)
  assert.equal(staticSeed('staticModules:OZ()'), undefined, 'the marker without the function must not match')
  assert.equal(staticSeed('const t = { staticModules:OZ() }; function OZ() { return {} }'), undefined)
  assert.equal(staticSeed('const t = { staticModules:OZ() }; function OZ() { return { "react": 1 } }'), undefined, 'a table without react/jsx-runtime is not the shell seed')
})

/**
 * Write a minimal Electron `app.asar` holding one file.
 *
 * The format is a prefix whose last 4 bytes are the header's length, the JSON
 * directory, then the file bytes at the offsets the directory declares
 * (relative to the end of the header). Only what {@link asarSources} reads is
 * written, which is exactly the point: the fixture proves the reader handles
 * the real layout rather than a directory it can list.
 *
 * @param {string} archive - the file to write.
 * @param {string} inner - the path inside the archive, `/`-separated.
 * @param {string} content - the file's text.
 * @returns {void} writes the file.
 */
function writeAsar(archive, inner, content) {
  const segments = inner.split('/')
  const bytes = Buffer.from(content, 'utf8')
  /** @type {{size: number, offset: number} | {files: Record<string, any>}} */
  let node = { size: bytes.length, offset: 0 }
  for (let index = segments.length - 1; index >= 0; index -= 1) node = { files: { [segments[index]]: node } }
  const header = Buffer.from(JSON.stringify(node), 'utf8')
  const prefix = Buffer.alloc(16)
  prefix.writeUInt32LE(4, 0)
  prefix.writeUInt32LE(header.length + 8, 4)
  prefix.writeUInt32LE(header.length + 4, 8)
  prefix.writeUInt32LE(header.length, 12)
  writeFileSync(archive, Buffer.concat([prefix, header, bytes]))
}
