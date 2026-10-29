import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../lib/runtime.js'
import { fallbackAdb, findTool, platformToolsAdb } from '../lib/providers/sdk.js'
import { writeFakeTool } from './helpers/fake-tool.mjs'

/**
 * The last-resort `adb` search.
 *
 * The normal resolution is the resolved SDK root, then the environment's own
 * lookup (`where adb` on Windows). A host can have the SDK installed while
 * `platform-tools` is not on `PATH` — the environment answers nothing, and a
 * diagnostic that reports "adb is missing" while the SDK holds one is worse
 * than a wider search. These tests pin that wider search: it is filesystem
 * only, it only runs for `adb`, and it only speaks when nothing else did.
 */

/** A logger that says nothing; the providers only ever warn through it. */
const QUIET = { info() {}, warn() {}, error() {} }

/** The `adb` executable name `executableCandidates` looks for on this platform. */
const ADB = process.platform === 'win32' ? 'adb.exe' : 'adb'

/**
 * Write an `adb` into `<dir>/platform-tools`.
 *
 * @param {string} dir - the SDK-like directory to seed.
 * @returns {Promise<string>} the adb path.
 */
async function seedAdb(dir) {
  const platformTools = path.join(dir, 'platform-tools')
  await mkdir(platformTools, { recursive: true })
  const adb = path.join(platformTools, ADB)
  await writeFile(adb, '')
  return adb
}

/**
 * A runtime whose environment either cannot answer for `adb` or answers with a
 * fake one.
 *
 * The lookup itself is the real `where`/`which`, and `PATH` is reduced to the
 * directories that tool needs plus the throwaway bin directory: a machine whose
 * PATH holds another `adb` would otherwise answer before the fallback is ever
 * reached, which is exactly the case these tests must not depend on. `sdkPath`
 * is pinned so the fallback's first candidate is the throwaway tree.
 *
 * @param {{sdkPath?: string, pathAdb?: boolean, logger?: object}} [options] - the environment to build.
 * @returns {Promise<{rt: object, binDir: string, workDir: string}>} the runtime and its directories.
 */
async function runtime({ sdkPath = '', pathAdb = false, logger = QUIET } = {}) {
  const workDir = await mkdtemp(path.join(tmpdir(), 'aemh-adb-work-'))
  const binDir = await mkdtemp(path.join(tmpdir(), 'aemh-adb-bin-'))
  if (pathAdb) await writeFakeTool(binDir, 'adb', [{ out: 'Android Debug Bridge version 1.0.41' }, { exit: 0 }])
  const rt = createRuntime({
    config: {
      dataDir: { get: () => path.join(workDir, 'data') },
      // A root that holds nothing keeps the direct probe and the SDK scan from
      // answering for the machine's real installation.
      sdkPath: { get: () => sdkPath },
    },
    logger,
    cwd: workDir,
    env: { ...process.env, PATH: [binDir, ...systemPathDirs()].join(path.delimiter) },
  })
  return { rt, binDir, workDir }
}

/**
 * The directories the platform's own `where`/`which` needs, without an `adb`.
 *
 * @returns {string[]} the system directories.
 */
function systemPathDirs() {
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot ?? 'C:\\Windows'
    return [path.join(root, 'System32'), root]
  }
  return ['/usr/bin', '/bin']
}

test('the search finds an adb directly under the root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-sdk-'))
  const expected = await seedAdb(root)
  assert.equal(await platformToolsAdb(root), expected)
})

test('the search finds an SDK nested below the root', async () => {
  // A `sdkPath` pointed at `D:\Android` rather than `D:\Android\Sdk`: the root
  // itself has no `platform-tools`, the SDK two levels down does.
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-sdk-'))
  const expected = await seedAdb(path.join(root, 'Android', 'Sdk'))
  assert.equal(await platformToolsAdb(root), expected)
})

test('the search respects its depth bound', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-sdk-'))
  await seedAdb(path.join(root, 'Android', 'Sdk'))
  assert.equal(await platformToolsAdb(root, 1), undefined, 'an SDK below the bound is not scanned')
})

test('a tree without a platform-tools directory yields nothing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-sdk-'))
  await mkdir(path.join(root, 'not-a-sdk'), { recursive: true })
  assert.equal(await platformToolsAdb(root), undefined)
})

test('an adb on PATH still wins over the SDK fallback', async () => {
  const empty = await mkdtemp(path.join(tmpdir(), 'aemh-empty-sdk-'))
  const { rt, binDir } = await runtime({ sdkPath: empty, pathAdb: true })
  const found = await findTool(rt, 'adb')
  assert.equal(path.dirname(found ?? ''), binDir, 'the environment answered, so the fallback must not speak')
})

test('the SDK copy answers when the environment cannot', async () => {
  // The reported failure: `where adb` answers nothing because `platform-tools`
  // is not on `PATH`, while the SDK the user pointed at holds the tool.
  const portable = await mkdtemp(path.join(tmpdir(), 'aemh-portable-'))
  const expected = await seedAdb(path.join(portable, 'Android', 'Sdk'))
  const { rt } = await runtime({ sdkPath: portable })
  assert.equal(await findTool(rt, 'adb'), expected)
})

test('the fallback is reported through the host log', async () => {
  const warnings = []
  const logger = { info() {}, warn: (message) => warnings.push(message), error() {} }
  const portable = await mkdtemp(path.join(tmpdir(), 'aemh-portable-'))
  const expected = await seedAdb(path.join(portable, 'Android', 'Sdk'))
  const { rt } = await runtime({ sdkPath: portable, logger })
  assert.equal(await fallbackAdb(rt), expected)
  assert.ok(
    warnings.some((message) => message.includes(expected)),
    'an operator has to be able to see which copy the plugin picked',
  )
})

test('other SDK tools do not use the adb fallback', async () => {
  const portable = await mkdtemp(path.join(tmpdir(), 'aemh-portable-'))
  await seedAdb(path.join(portable, 'Android', 'Sdk'))
  const { rt } = await runtime({ sdkPath: portable })
  assert.equal(await findTool(rt, 'emulator'), undefined, 'the wider search is adb-only')
})
