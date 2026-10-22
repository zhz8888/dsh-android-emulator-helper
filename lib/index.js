import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Config, SETTINGS_NAMESPACE } from './settings.js'
import { createRuntime } from './runtime.js'
import { inventory, preflight } from './providers/preflight.js'
import { registerTools } from './tools/index.js'

/**
 * Host half of `@zhz8888/dsh-android-emulator-helper`.
 *
 * One Cordis entry contributes four things, each behind its own optional
 * service so a deployment that lacks it still loads the rest:
 *
 *   - 23 model-facing `android_*` tools on `ctx.tools`;
 *   - the embedded `android-dev` skill on `ctx.skills`;
 *   - a `/android-dev` command on `ctx.commands`;
 *   - two exact Fetch routes on `ctx.connection` that back the plugin's configuration page.
 *
 * @module @zhz8888/dsh-android-emulator-helper
 */

/**
 * @typedef {import('@deepseek-ai/cordis').Context} PluginContext
 * @typedef {import('./runtime.js').HostLogger} HostLogger
 * @typedef {import('./runtime.js').Runtime} Runtime
 */

/**
 * The settings service, as this plugin uses it.
 *
 * The service is owned by `@deepseek-ai/dsh-settings`, which this plugin does
 * not depend on, so the one member it touches is described here instead of
 * installing a package to type it.
 *
 * @typedef {object} SettingsService
 * @property {(options: {auto?: boolean}, fiber?: unknown) => (() => void)} configure - the page-generation policy; returns a disposer.
 */

/**
 * One skill registration, as this plugin contributes it.
 *
 * @typedef {object} SkillRegistration
 * @property {string} name - the skill's name.
 * @property {string} description - the skill's description.
 * @property {string} [whenToUse] - when the model should reach for the skill.
 * @property {string} content - the skill body.
 * @property {string} source - where the skill came from.
 * @property {string} path - the file a caller resolves the body from.
 * @property {string} provider - who serves the skill.
 * @property {{kind: string, path: string}} resourceBase - the directory the skill's resources live in.
 */

/**
 * The skill registry, as this plugin uses it.
 *
 * The service is owned by `@deepseek-ai/dsh-skill`, which this plugin does not
 * depend on, so the one member it touches is described here instead.
 *
 * @typedef {object} SkillService
 * @property {(skill: SkillRegistration) => (() => void)} register - the registry's entry point; returns a disposer.
 */

/**
 * One slash command, as this plugin contributes it.
 *
 * @typedef {object} CommandRegistration
 * @property {string} name - the command's name.
 * @property {string} description - the command's description.
 * @property {{hint: string}} input - the placeholder the composer shows.
 * @property {(args: {agent?: import('@deepseek-ai/dsh-tools').ToolRunContext['agent'], rawInput: string}) => Promise<{kind: string, text: string}>} handler - the command body.
 */

/**
 * The command registry, as this plugin uses it.
 *
 * The service is owned by `@deepseek-ai/dsh-commands`, which this plugin does
 * not depend on, so the one member it touches is described here instead.
 *
 * @typedef {object} CommandService
 * @property {(command: CommandRegistration) => (() => void)} register - the registry's entry point; returns a disposer.
 */

/**
 * One exact Fetch route, as this plugin registers it.
 *
 * @typedef {object} FetchRoute
 * @property {string} path - the route's exact path.
 * @property {string[]} methods - the HTTP methods the route answers.
 * @property {string} requestBody - how the harness buffers the request body.
 * @property {() => Promise<Response>} fetch - the route's handler.
 */

/**
 * The connection service, as this plugin uses it.
 *
 * The service is owned by `@deepseek-ai/dsh-client-connection`, which this
 * plugin does not depend on, so the one member it touches is described here
 * instead.
 *
 * @typedef {object} ConnectionService
 * @property {{register: (route: FetchRoute) => (() => void)}} fetch - the exact-route registry.
 */

/**
 * One diagnostic check, as the preflight report carries it.
 *
 * `lib/providers/preflight.js` owns the diagnostic, and this file already
 * calls it, so the check is described in terms of that one declaration rather
 * than a second copy of it: two shapes for one report is the kind of drift
 * this plugin's other halves are checked for.
 *
 * @typedef {import('./providers/preflight.js').PreflightCheck} PreflightCheck
 */

/**
 * The diagnostic report the `/android-dev` command renders.
 *
 * @typedef {object} PreflightReport
 * @property {boolean} ok - whether every check passed.
 * @property {PreflightCheck[]} checks - the checks, in the order they ran.
 */

/**
 * The contexts the optional services are reached through.
 *
 * `ctx.tools` is typed by `@deepseek-ai/dsh-tools`, which augments Cordis'
 * `Context`. The other services this plugin reaches are owned by packages it
 * does not depend on, so each one is added to the context locally, with only
 * the members the code reads.
 *
 * @typedef {PluginContext & {settings?: SettingsService}} SettingsContext
 * @typedef {PluginContext & {skills: SkillService}} SkillsContext
 * @typedef {PluginContext & {commands: CommandService}} CommandsContext
 * @typedef {PluginContext & {connection?: ConnectionService}} ConnectionContext
 */

/** Cordis plugin name; matches the `dsh.name` field and the patch row id. */
export const name = 'android-emulator-helper'

/**
 * Required services.
 *
 * Only `tools` is listed. `skills`, `commands` and `connection` are optional
 * services reached through `ctx.inject` instead: an unresolved entry in this
 * array leaves the whole plugin pending forever, which would take the session
 * down over a missing convenience feature.
 */
export const inject = ['tools']

export { Config, SETTINGS_NAMESPACE }

/** Directory holding the plugin's bundled skill. */
const SKILL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'android-dev')

/**
 * Route prefix owned by this plugin; every path is registered under `/api`.
 *
 * Exported so the consistency gate can compare the routes this plugin
 * registers with the routes the browser half calls, instead of grepping this
 * file's source.
 */
export const ROUTE_PREFIX = '/api/android-emulator-helper'

/**
 * The two exact Fetch routes this plugin registers.
 *
 * The browser half calls them by absolute path, so the two sides have to
 * agree on the string. Both export it now — this map and the browser half's
 * `ROUTES` — so the consistency gate compares two values instead of grepping
 * two source files for the same literal.
 */
export const ROUTES = Object.freeze({
  status: `${ROUTE_PREFIX}/status`,
  inventory: `${ROUTE_PREFIX}/inventory`,
})

/**
 * Mount the plugin.
 *
 * @param {PluginContext} ctx - the host plugin context.
 * @param {Record<string, unknown>} config - the entry's live configuration.
 */
export function apply(ctx, config) {
  const logger = ctx.logger ?? silentLogger
  // `ctx.tools.register` already returns a disposer bound to this fiber, so the
  // tools need no extra effect wrapper: disposing the entry unregisters them.
  registerTools(ctx, { config, logger })
  configureAutoPage(ctx)
  registerSkill(ctx, logger)
  registerCommand(ctx, { config, logger })
  registerRoutes(ctx, { config, logger })
}

/**
 * Tell the settings service this plugin renders its own configuration page.
 *
 * `autoGenerate` defaults to true, and a client that generates pages from the
 * schema would otherwise show a second, redundant form for this entry. The
 * policy must be registered from a child of the settings service so a
 * late-mounted or replaced service still adopts it, and the plugin keeps
 * working when the service is absent.
 *
 * @param {PluginContext} ctx - the host plugin context.
 */
function configureAutoPage(ctx) {
  ctx.inject(['settings'], (injected) => {
    const sctx = /** @type {SettingsContext} */ (injected)
    const settings = sctx.settings
    if (typeof settings?.configure !== 'function') return
    sctx.effect(
      () => settings.configure({ auto: false }, ctx.fiber),
      'android-emulator-helper: configuration page policy',
    )
  })
}

/**
 * Contribute the bundled `android-dev` skill.
 *
 * The body is read from the package at mount time and registered as an
 * embedded runtime skill, with the skill directory as its resource base so
 * `INSTALL_ENVIRONMENT.md` resolves the same way it did in the original
 * plugin's `skills/` root.
 *
 * @param {PluginContext} ctx - the host plugin context.
 * @param {HostLogger} logger - host logger.
 */
function registerSkill(ctx, logger) {
  ctx.inject(['skills'], (injected) => {
    const sctx = /** @type {SkillsContext} */ (injected)
    const skills = sctx.skills
    const dispose = sctx.effect(() => {
      let loaded
      try {
        loaded = loadSkillFiles()
      } catch (error) {
        logger.warn(`android-emulator-helper: could not read the bundled skill: ${message(error)}`)
        return () => {}
      }
      return skills.register({
        name: loaded.name,
        description: loaded.description,
        ...(loaded.whenToUse === undefined ? {} : { whenToUse: loaded.whenToUse }),
        content: loaded.content,
        // `source` and `path` are not optional in practice. The registry builds a
        // discovery CANDIDATE out of the registered skill and validates it with
        // `typeof candidate.source !== "string" -> throw`, so a registration that
        // omits `source` fails when the skill is looked up, not when it is
        // registered: `apply` succeeds and `skills.get('android-dev')` then throws
        // "loaded skill android-dev source must be a string". `path` is what a
        // caller shows and resolves the body from.
        source: 'runtime',
        path: path.join(SKILL_DIR, 'SKILL.md'),
        provider: 'runtime',
        resourceBase: { kind: 'directory', path: SKILL_DIR },
      })
    }, 'android-emulator-helper: android-dev skill')
    return dispose
  })
}

/**
 * Read and parse the bundled skill synchronously into memory.
 *
 * @returns {{name: string, description: string, whenToUse?: string, content: string}} the skill definition.
 * @throws When the SKILL.md is missing or has no usable description.
 */
function loadSkillFiles() {
  const raw = readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8')
  const { front, body } = splitFrontmatter(raw)
  const description = front.description
  if (typeof description !== 'string' || description.trim().length === 0) {
    throw new Error('skills/android-dev/SKILL.md has no description in its frontmatter')
  }
  return {
    name: typeof front.name === 'string' && front.name.trim().length > 0 ? front.name.trim() : 'android-dev',
    description: description.trim(),
    ...(typeof front.whenToUse === 'string' && front.whenToUse.trim().length > 0
      ? { whenToUse: front.whenToUse.trim() }
      : {}),
    content: body.trim(),
  }
}

/**
 * Split YAML frontmatter from a Markdown body without a YAML dependency.
 *
 * The skill frontmatter is a flat map of single-line scalars, so a full parser
 * would be dead weight; anything more complex is left in the body untouched.
 *
 * @param {string} raw - the file contents.
 * @returns {{front: Record<string, string>, body: string}} the parsed parts.
 */
export function splitFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!match) return { front: {}, body: raw }
  /** @type {Record<string, string>} */
  const front = {}
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim())
    if (!pair) continue
    let value = (pair[2] ?? '').trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    front[pair[1] ?? ''] = value
  }
  return { front, body: raw.slice(match[0].length) }
}

/**
 * Contribute the `/android-dev` command.
 *
 * The original ZCode command injected a prompt into the model's conversation.
 * DSH commands deliberately never create a model message, so this command does
 * the one thing that is useful without the model: it runs the diagnostic and
 * reports the verdict plus the suggested next step.
 *
 * @param {PluginContext} ctx - the host plugin context.
 * @param {{config: Record<string, unknown>, logger: HostLogger}} plugin - live config and logger.
 */
function registerCommand(ctx, { config, logger }) {
  ctx.inject(['commands'], (injected) => {
    const cctx = /** @type {CommandsContext} */ (injected)
    const commands = cctx.commands
    cctx.effect(
      () =>
        commands.register({
          name: 'android-dev',
          description: 'Run the Android environment diagnostic and print the next step',
          input: { hint: '[goal, e.g. "build and screenshot the app"]' },
          handler: async ({ agent, rawInput }) => {
            const rt = createRuntime({ config, agent, logger })
            try {
              const report = await preflight(rt)
              return { kind: 'success', text: renderCommandReport(report, rawInput.trim()) }
            } catch (error) {
              return { kind: 'error', text: `android_preflight failed: ${message(error)}` }
            }
          },
        }),
      'android-emulator-helper: android-dev command',
    )
  })
}

/**
 * Render the `/android-dev` output: the failing checks first, then the goal.
 *
 * @param {PreflightReport} report - the preflight report.
 * @param {string} goal - the raw command input.
 * @returns {string} the user-facing text.
 */
export function renderCommandReport(report, goal) {
  const failed = report.checks.filter((check) => !check.ok)
  const lines = [
    report.ok ? 'Android environment: ready.' : `Android environment: not ready (${failed.length} check(s) failed).`,
    '',
    ...report.checks.map((check) => `${check.ok ? '[ok]  ' : '[FAIL]'} ${check.name}`),
  ]
  for (const check of failed) {
    lines.push('', `--- ${check.name} ---`, check.detail, check.fix ? `Fix: ${check.fix}` : '')
  }
  lines.push(
    '',
    goal.length > 0
      ? `Next: ask the agent to ${goal} — it will use the android-dev skill and the android_* tools.`
      : 'Next: ask the agent to build and run the Android app — it will use the android-dev skill and the android_* tools.',
    "Environment values are edited on this plugin's page in the Plugins panel (Plugins → Installed plugins → Android Emulator Helper).",
  )
  return lines.filter((line) => line !== undefined).join('\n')
}

/**
 * Contribute the two exact Fetch routes the configuration page calls.
 *
 * `connection.fetch.register` is the harness' sanctioned way for a plugin to
 * answer a same-origin browser request; the request passes the Host/Origin
 * fence and browser authentication before reaching the handler. The optional
 * `connection` service is reached through `ctx.inject`, so a deployment without
 * it simply loses the two buttons rather than failing to boot.
 *
 * @param {PluginContext} ctx - the host plugin context.
 * @param {{config: Record<string, unknown>, logger: HostLogger}} plugin - live config and logger.
 */
function registerRoutes(ctx, { config, logger }) {
  ctx.inject(['connection'], (injected) => {
    const cctx = /** @type {ConnectionContext} */ (injected)
    const register = cctx.connection?.fetch?.register
    if (typeof register !== 'function') {
      logger.warn('android-emulator-helper: this deployment exposes no exact Fetch route registry; the configuration page will show no diagnostics')
      return
    }
    cctx.effect(
      () =>
        register({
          path: ROUTES.status,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: async () => {
            // `createRuntime` reads the live settings, so it belongs inside the
            // guard: a reference that cannot be read must still answer with a
            // JSON body instead of rejecting the request.
            try {
              const rt = createRuntime({ config, exec: undefined, logger })
              return jsonResponse(200, await preflight(rt))
            } catch (error) {
              return jsonResponse(500, { error: message(error) })
            }
          },
        }),
      'android-emulator-helper: status route',
    )
    cctx.effect(
      () =>
        register({
          path: ROUTES.inventory,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: async () => {
            try {
              const rt = createRuntime({ config, exec: undefined, logger })
              return jsonResponse(200, await inventory(rt))
            } catch (error) {
              return jsonResponse(500, { error: message(error) })
            }
          },
        }),
      'android-emulator-helper: inventory route',
    )
  })
}

/**
 * Build a JSON Fetch response.
 *
 * @param {number} status - HTTP status.
 * @param {unknown} body - the JSON payload.
 * @returns {Response} the response.
 */
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body ?? null), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/**
 * Logger used when the composition provides none.
 *
 * @type {HostLogger}
 */
const silentLogger = {
  info() {},
  warn() {},
  error() {},
}

/**
 * Error message of an arbitrary thrown value.
 *
 * @param {unknown} error - the thrown value.
 * @returns {string} its message.
 */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
