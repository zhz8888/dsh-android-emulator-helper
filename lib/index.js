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

/** Route prefix owned by this plugin; every path is registered under `/api`. */
const ROUTE_PREFIX = '/api/android-emulator-helper'

/**
 * Mount the plugin.
 *
 * @param {object} ctx - the host plugin context.
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
 * @param {object} ctx - the host plugin context.
 */
function configureAutoPage(ctx) {
  ctx.inject(['settings'], (sctx) => {
    if (typeof sctx.settings?.configure !== 'function') return
    sctx.effect(
      () => sctx.settings.configure({ auto: false }, ctx.fiber),
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
 * @param {object} ctx - the host plugin context.
 * @param {object} logger - host logger.
 */
function registerSkill(ctx, logger) {
  ctx.inject(['skills'], (sctx) => {
    const dispose = sctx.effect(() => {
      let loaded
      try {
        loaded = loadSkillFiles()
      } catch (error) {
        logger.warn(`android-emulator-helper: could not read the bundled skill: ${message(error)}`)
        return () => {}
      }
      return sctx.skills.register({
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
  const front = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim())
    if (!pair) continue
    let value = pair[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    front[pair[1]] = value
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
 * @param {object} ctx - the host plugin context.
 * @param {{config: Record<string, unknown>, logger: object}} plugin - live config and logger.
 */
function registerCommand(ctx, { config, logger }) {
  ctx.inject(['commands'], (cctx) => {
    cctx.effect(
      () =>
        cctx.commands.register({
          name: 'android-dev',
          description: 'Run the Android environment diagnostic and print the next step',
          input: { hint: '[goal, e.g. "build and screenshot the app"]' },
          handler: async ({ rawInput }) => {
            const rt = createRuntime({ config, exec: undefined, logger })
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
 * @param {{ok: boolean, checks: Array<object>, settings: object}} report - the preflight report.
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
 * @param {object} ctx - the host plugin context.
 * @param {{config: Record<string, unknown>, logger: object}} plugin - live config and logger.
 */
function registerRoutes(ctx, { config, logger }) {
  ctx.inject(['connection'], (cctx) => {
    const register = cctx.connection?.fetch?.register
    if (typeof register !== 'function') {
      logger.warn('android-emulator-helper: this deployment exposes no exact Fetch route registry; the configuration page will show no diagnostics')
      return
    }
    cctx.effect(
      () =>
        register({
          path: `${ROUTE_PREFIX}/status`,
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
          path: `${ROUTE_PREFIX}/inventory`,
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

/** Logger used when the composition provides none. */
const silentLogger = {
  info() {},
  warn() {},
  error() {},
}

/** Error message of an arbitrary thrown value. */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
