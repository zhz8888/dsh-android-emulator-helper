import path from 'node:path'
import { defaultDataRoot, dataDir as makeDataDir, expandHome } from './util/path.js'
import { readSettings } from './settings.js'

/**
 * Per-call runtime handed to every provider.
 *
 * The original ZCode plugin read `process.cwd()` and `process.env` directly,
 * which is wrong inside a long-lived harness process: several sessions share
 * one Node process, so the working directory is neither stable nor per-session.
 * A runtime object is therefore built once per tool call from
 *
 *   - the calling agent's session workspace, and
 *   - the plugin's live settings,
 *
 * and passed explicitly into the ported providers.
 *
 * @module @zhz8888/dsh-android-emulator-helper/runtime
 */

/**
 * The harness' tool execution record.
 *
 * `@deepseek-ai/dsh-tools` declares it, and with it the whole chain this
 * module reads: `agent.session.header.cwd` is the workspace the user opened.
 *
 * @typedef {import('@deepseek-ai/dsh-tools').ToolRunContext} ToolRunContext
 */

/**
 * The plugin's live settings.
 *
 * @typedef {import('./settings.js').AndroidSettings} AndroidSettings
 */

/**
 * The host logger this plugin writes through.
 *
 * @typedef {{info: (message: string) => void, warn: (message: string) => void, error: (message: string) => void}} HostLogger
 */

/**
 * Everything one tool call needs, in one object.
 *
 * @typedef {object} Runtime
 * @property {string} cwd - the session workspace, or the caller's explicit root.
 * @property {AndroidSettings} settings - the live settings, projected for this call.
 * @property {NodeJS.ProcessEnv} env - the environment the call reads.
 * @property {HostLogger} logger - the host logger.
 * @property {string} dataRoot - the plugin's data root.
 * @property {() => Promise<string>} screenshots - the screenshot directory, created on demand.
 * @property {() => Promise<string>} buildLogs - the build-log directory, created on demand.
 */

/**
 * Resolve the directory a tool call should treat as the project root.
 *
 * `exec.agent.session.header.cwd` is the workspace the user opened; it is the
 * harness' own answer to "where is this session working". Nothing else in the
 * process can supply that, so a caller without an agent (a direct programmatic
 * dispatch) falls back to the process directory, matching the ported provider's
 * previous behaviour.
 *
 * @param {ToolRunContext | undefined} exec - the tool execution record.
 * @returns {string} an absolute directory.
 */
export function sessionCwd(exec) {
  return agentCwd(exec?.agent) ?? process.cwd()
}

/**
 * The workspace a session agent is working in.
 *
 * Commands get the agent without a tool execution record, so the same read has
 * to be available from the agent alone.
 *
 * @param {import('@deepseek-ai/dsh-tools').ToolRunContext['agent'] | undefined} agent - the agent, when there is one.
 * @returns {string | undefined} the session workspace.
 */
export function agentCwd(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/**
 * Build the runtime for one tool call.
 *
 * @param {object} options - composition inputs.
 * @param {Record<string, unknown>} options.config - the entry's live config.
 * @param {ToolRunContext | undefined} [options.exec] - the tool execution record.
 * @param {import('@deepseek-ai/dsh-tools').ToolRunContext['agent'] | undefined} [options.agent] - the calling agent, when there is no execution record.
 * @param {HostLogger} [options.logger] - host logger.
 * @param {NodeJS.ProcessEnv} [options.env] - environment override (tests).
 * @param {string} [options.cwd] - explicit project root; defaults to the session workspace.
 * @returns {Runtime} the per-call runtime.
 */
export function createRuntime({ config, exec, agent, logger, env = process.env, cwd }) {
  const settings = readSettings(config, env)
  const projectCwd = cwd ?? agentCwd(exec?.agent ?? agent) ?? process.cwd()
  const dataRoot = settings.dataDir
    ? path.resolve(projectCwd, expandHome(settings.dataDir, env))
    : defaultDataRoot(env)
  const screenshotRoot = settings.screenshotDir
    ? path.resolve(projectCwd, expandHome(settings.screenshotDir, env))
    : undefined
  return {
    cwd: projectCwd,
    settings,
    env,
    logger: logger ?? silentLogger,
    dataRoot,
    /** Directory screenshots are written to, created on demand. */
    screenshots: () => makeDataDir(screenshotRoot ?? dataRoot, ...(screenshotRoot ? [] : ['screenshots'])),
    /** Directory build logs are written to, created on demand. */
    buildLogs: () => makeDataDir(dataRoot, 'logs'),
  }
}

/**
 * Logger used when `apply` runs without a Cordis context (tests, direct import).
 *
 * @type {HostLogger}
 */
export const silentLogger = {
  info() {},
  warn() {},
  error() {},
}
