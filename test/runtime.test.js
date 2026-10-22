import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createRuntime, sessionCwd } from '../lib/runtime.js'
import { DATA_DIR_NAME, defaultDataRoot } from '../lib/util/path.js'

/**
 * Runtime resolution tests.
 *
 * `lib/runtime.js` exists for one reason: a long-lived harness process serves
 * several sessions at once, so `process.cwd()` is not the caller's workspace.
 * The session workspace is read from the tool execution record, and nothing
 * else in the process can supply it — so a typo in that path degrades
 * silently, every call quietly falling back to the process directory and every
 * path the plugin touches pointing somewhere else. Nothing else in the suite
 * exercises that path: every other runtime is built with an explicit `cwd`.
 */

/** The workspace the user opened, as the harness records it in the session header. */
const WORKSPACE = '/work/project'

/**
 * A tool execution record carrying a session workspace.
 *
 * The shape is the harness' own: `exec.agent.session.header.cwd` is where the
 * session header keeps the directory the user opened.
 *
 * @param {string} [cwd] - the session workspace.
 * @returns {object} the execution record.
 */
function execWithCwd(cwd) {
  return { agent: { session: { header: { cwd } } } }
}

/** A config object shaped like the one Cordis hands to `apply`. */
function liveConfig(values) {
  const out = {}
  for (const [key, value] of Object.entries(values)) {
    out[key] = { get: () => value }
  }
  return out
}

// ---------------------------------------------------------------------------
// The session workspace
// ---------------------------------------------------------------------------

test('sessionCwd reads the session workspace', () => {
  assert.equal(sessionCwd(execWithCwd(WORKSPACE)), WORKSPACE)
})

test('a record without a session falls back to the process directory', () => {
  // A direct programmatic dispatch carries no agent, and the ported provider's
  // previous behaviour was `process.cwd()`; the fallback has to keep that, and
  // it has to be a directory rather than a crash.
  assert.equal(sessionCwd(undefined), process.cwd())
  assert.equal(sessionCwd({}), process.cwd())
  assert.equal(sessionCwd({ agent: {} }), process.cwd())
  assert.equal(sessionCwd({ agent: { session: {} } }), process.cwd())
  assert.equal(sessionCwd({ agent: { session: { header: {} } } }), process.cwd())
})

test('an unusable session workspace falls back to the process directory', () => {
  // An empty header is not a workspace: resolving a relative path against it
  // would put every output in the current directory of the harness process.
  assert.equal(sessionCwd(execWithCwd('')), process.cwd())
  assert.equal(sessionCwd(execWithCwd(undefined)), process.cwd())
  assert.equal(sessionCwd(execWithCwd(42)), process.cwd())
})

// ---------------------------------------------------------------------------
// The runtime built from it
// ---------------------------------------------------------------------------

test('the runtime takes the session workspace when no cwd is given', () => {
  const rt = createRuntime({ config: {}, exec: execWithCwd(WORKSPACE), env: {} })
  assert.equal(rt.cwd, WORKSPACE)
})

test('the session workspace is the root the data directory resolves against', () => {
  const rt = createRuntime({
    config: liveConfig({ dataDir: 'out/data' }),
    exec: execWithCwd(WORKSPACE),
    env: {},
  })
  assert.equal(rt.dataRoot, path.resolve(WORKSPACE, 'out/data'))
})

test('an explicit cwd wins over the session workspace', () => {
  const rt = createRuntime({ config: {}, exec: execWithCwd(WORKSPACE), cwd: '/explicit', env: {} })
  assert.equal(rt.cwd, '/explicit')
})

test('an explicit cwd is also the root the data directory resolves against', () => {
  const rt = createRuntime({
    config: liveConfig({ dataDir: 'out/data' }),
    exec: execWithCwd(WORKSPACE),
    cwd: '/explicit',
    env: {},
  })
  assert.equal(rt.dataRoot, path.resolve('/explicit', 'out/data'))
})

test('the screenshot and log directories resolve against the session workspace', async () => {
  // The paths the providers actually write to: a session workspace that is
  // resolved wrongly sends screenshots and build logs to the wrong tree.
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'dsh-runtime-'))
  const rt = createRuntime({
    config: liveConfig({ dataDir: 'out' }),
    exec: execWithCwd(workspace),
    env: {},
  })
  assert.equal(await rt.screenshots(), path.join(workspace, 'out', 'screenshots'))
  assert.equal(await rt.buildLogs(), path.join(workspace, 'out', 'logs'))
})

// ---------------------------------------------------------------------------
// The data root
// ---------------------------------------------------------------------------

test('the data root follows DSH_HOME when it is set', () => {
  assert.equal(defaultDataRoot({ DSH_HOME: '/dsh' }), path.join('/dsh', DATA_DIR_NAME))
})

test('the data root falls back to the DSH home directory', () => {
  assert.equal(defaultDataRoot({}), path.join(os.homedir(), '.dsh', DATA_DIR_NAME))
})

test('a blank DSH_HOME is ignored', () => {
  // An environment variable set to whitespace is the same as one that is not
  // set: the home directory is the documented fallback, not an empty path.
  assert.equal(defaultDataRoot({ DSH_HOME: '   ' }), path.join(os.homedir(), '.dsh', DATA_DIR_NAME))
})

test('the runtime data root follows DSH_HOME when no data directory is configured', () => {
  const rt = createRuntime({ config: {}, exec: execWithCwd(WORKSPACE), env: { DSH_HOME: '/dsh' } })
  assert.equal(rt.dataRoot, path.join('/dsh', DATA_DIR_NAME))
})

test('an agent without a tool execution record still supplies the workspace', () => {
  const rt = createRuntime({ config: {}, agent: execWithCwd(WORKSPACE).agent, env: {} })
  assert.equal(rt.cwd, WORKSPACE)
})

test('an explicit cwd still wins over the agent workspace', () => {
  const rt = createRuntime({
    config: {},
    agent: execWithCwd(WORKSPACE).agent,
    cwd: '/explicit',
    env: {},
  })
  assert.equal(rt.cwd, '/explicit')
})
