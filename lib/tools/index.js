import { defineTool } from '@deepseek-ai/dsh-tools'
import { createRuntime } from '../runtime.js'
import { imageContent, textContent, toLosslessJson } from '../util/content.js'
import * as appProvider from '../providers/app.js'
import * as avdProvider from '../providers/avd.js'
import * as buildProvider from '../providers/build.js'
import * as deviceProvider from '../providers/device.js'
import * as logsProvider from '../providers/logs.js'
import * as preflightProvider from '../providers/preflight.js'
import * as projectProvider from '../providers/project.js'
import * as screenshotProvider from '../providers/screenshot.js'
import * as uiProvider from '../providers/ui.js'

/**
 * The plugin's model-facing tool surface.
 *
 * Every tool from the ZCode plugin is preserved under its original name and
 * argument names, so a workflow written against the MCP server keeps working
 * against this one. Two harness-level changes are uniform across the set:
 *
 *   - each call builds a {@link createRuntime} from the session workspace and
 *     the live settings, instead of reading `process.cwd()`/`process.env`;
 *   - each tool declares both the argument schema and the result schema, so the
 *     registry validates what the model sent and what the body returned.
 *
 * @module @zhz8888/dsh-android-emulator-helper/tools
 */

/** Shared target arguments: which device to act on. */
const TARGET = {
  serial: {
    type: 'string',
    description:
      'Android device or emulator serial number. When omitted, the plugin uses a ready device/emulator or starts one when needed.',
  },
  avd: {
    type: 'string',
    description: 'Android Virtual Device name, used when an emulator needs to be started.',
  },
  timeoutMs: {
    type: 'integer',
    description: 'Operation timeout in milliseconds.',
  },
}

/** Shared build arguments. */
const BUILD = {
  ...TARGET,
  projectDir: { type: 'string', description: 'Android Gradle project root as a path relative to the session workspace.' },
  module: { type: 'string', description: 'Gradle module. Defaults to the discovered app module.' },
  variant: { type: 'string', description: 'Build variant. Defaults to debug.' },
  applicationId: {
    type: 'string',
    description: 'applicationId override to use when automatic discovery cannot resolve the app ID.',
  },
}

/** A result schema that accepts any JSON object. */
const ANY_OBJECT = { type: 'object', additionalProperties: true }

/** Named Android key events. */
const KEYS = Object.keys(uiProvider.KEY_EVENTS)

/**
 * Register every tool on the calling context.
 *
 * @param {object} ctx - the plugin context; must carry `tools`.
 * @param {{config: Record<string, unknown>, logger: object}} plugin - live config and host logger.
 * @returns {Array<() => void>} disposers, one per registered tool.
 */
export function registerTools(ctx, { config, logger }) {
  const disposers = []
  const register = (definition) => {
    disposers.push(ctx.tools.register(defineTool(definition)))
  }

  /**
   * Wrap one provider call: build the runtime, run it, render the JSON result.
   *
   * @param {string} name - tool name, for the error prefix.
   * @param {(rt: object, args: object, exec: object) => Promise<unknown>} body - the provider call.
   * @returns {(args: object, exec: object) => Promise<object>} the tool body.
   */
  const body = (name, run) => async (args, exec) => {
    const rt = createRuntime({ config, exec, logger })
    try {
      // The registry snapshots the returned value as lossless JSON and rejects
      // `undefined`, so normalization happens here, on the one path every
      // result takes, rather than in each of the 23 providers.
      return toLosslessJson(await run(rt, args ?? {}, exec))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`${name}: ${detail}`)
    }
  }

  /**
   * Define one JSON-valued tool.
   *
   * @param {{name: string, description: string, parameters: object, run: Function}} spec - the tool.
   */
  const jsonTool = ({ name, description, parameters, run }) => {
    register({
      name,
      description,
      parameters,
      output: { schema: ANY_OBJECT, render: (_args, value) => textContent(value) },
      execute: body(name, run),
    })
  }

  /**
   * Define one device-targeted tool: adds {@link TARGET} to the parameters.
   *
   * @param {{name: string, description: string, parameters?: object, run: Function}} spec - the tool.
   */
  const targetTool = (spec) => jsonTool({ ...spec, parameters: { ...TARGET, ...(spec.parameters ?? {}) } })

  jsonTool({
    name: 'android_preflight',
    description:
      'Check whether the Android SDK, adb, emulator, AVDs, Java, Gradle project state, and ADB/UI Automator automation are available, and echo the current plugin settings.',
    parameters: {},
    run: (rt) => preflightProvider.preflight(rt),
  })

  jsonTool({
    name: 'android_discover_project',
    description:
      'Find the Gradle root, modules, variants, app ID, manifest, and APK outputs in the current session workspace.',
    parameters: {},
    run: (rt) => projectProvider.discover(rt, rt.cwd),
  })

  jsonTool({
    name: 'android_create_app',
    description: 'Create a minimal Kotlin and Jetpack Compose Android app in the session workspace.',
    parameters: {
      name: { type: 'string', required: true, description: 'App/project name; letters and digits are kept.' },
      packageName: { type: 'string', description: 'Dotted application id, e.g. com.example.demo.' },
      dir: { type: 'string', description: 'Target directory relative to the session workspace.' },
      minSdk: { type: 'integer', description: 'Minimum SDK level. Defaults to the plugin setting.' },
      compileSdk: { type: 'integer', description: 'Compile SDK level. Defaults to the plugin API level setting.' },
      overwrite: { type: 'boolean', description: 'Replace existing generated files. Defaults to false.' },
    },
    run: (rt, args) => projectProvider.create(rt, args),
  })

  jsonTool({
    name: 'android_build_app',
    description: 'Build the current or specified Android Gradle project.',
    parameters: BUILD,
    run: (rt, args) => buildProvider.buildApp(rt, args),
  })

  jsonTool({
    name: 'android_build_and_run',
    description:
      'Build the Android app, reuse a ready device/emulator or start a GUI emulator on demand, then install and launch the app.',
    parameters: {
      ...BUILD,
      launchActivity: { type: 'string', description: 'Explicit activity class to launch instead of the launcher intent.' },
    },
    run: (rt, args) => buildProvider.buildAndRun(rt, args),
  })

  jsonTool({
    name: 'android_list_devices',
    description: 'List devices and emulators visible to adb.',
    parameters: {},
    // Wrapped in an object: every tool in this plugin declares an object result
    // schema, so the registry rejects a bare array as invalid output.
    run: async (rt) => ({ devices: await deviceProvider.listDevices(rt) }),
  })

  jsonTool({
    name: 'android_list_avds',
    description: 'List Android Virtual Devices visible to the emulator command.',
    parameters: {},
    run: async (rt) => ({ avds: await avdProvider.listAvds(rt) }),
  })

  jsonTool({
    name: 'android_start_emulator',
    description:
      'Start a new GUI Android emulator for the specified AVD. To reuse an existing device or emulator, pass its serial to build, install, launch, screenshot, log, or UI tools.',
    parameters: {
      avd: { type: 'string', description: 'Android Virtual Device name to start.' },
      timeoutMs: { type: 'integer', description: 'Startup timeout in milliseconds.' },
    },
    run: (rt, args) => avdProvider.startEmulator(rt, args),
  })

  jsonTool({
    name: 'android_stop_emulator',
    description: 'Stop the selected Android emulator by serial number.',
    parameters: { serial: { type: 'string', required: true, description: 'Emulator serial, e.g. emulator-5554.' } },
    run: (rt, args) => avdProvider.stopEmulator(rt, args),
  })

  jsonTool({
    name: 'android_create_avd',
    description:
      'Create an Android Virtual Device with avdmanager, using the configured API level and system image. Confirm SDK package and license configuration with the user first.',
    parameters: {
      name: { type: 'string', description: 'AVD name. Defaults to the configured default AVD.' },
      packageId: { type: 'string', description: 'Full system-image package id, e.g. system-images;android-35;google_apis;arm64-v8a.' },
      device: { type: 'string', description: 'avdmanager device profile, e.g. pixel_7.' },
      force: { type: 'boolean', description: 'Overwrite an existing AVD of the same name.' },
    },
    run: (rt, args) => avdProvider.createAvd(rt, args),
  })

  jsonTool({
    name: 'android_install_app',
    description: 'Install an APK on the selected Android device or emulator.',
    parameters: {
      ...TARGET,
      apkPath: { type: 'string', required: true, description: 'APK path relative to the session workspace, or absolute.' },
    },
    run: (rt, args) => appProvider.install(rt, args),
  })

  targetTool({
    name: 'android_launch_app',
    description: 'Launch an installed Android app by application ID.',
    parameters: {
      applicationId: { type: 'string', required: true, description: 'Dotted application id.' },
      activity: { type: 'string', description: 'Explicit activity class, e.g. .MainActivity.' },
    },
    run: (rt, args) => appProvider.launch(rt, args),
  })

  targetTool({
    name: 'android_terminate_app',
    description: 'Force-stop an installed Android app by application ID.',
    parameters: { applicationId: { type: 'string', required: true, description: 'Dotted application id.' } },
    run: (rt, args) => appProvider.terminate(rt, args),
  })

  targetTool({
    name: 'android_open_url',
    description: 'Open a URL on the selected Android device or emulator.',
    parameters: { url: { type: 'string', required: true, description: 'Absolute URL with a scheme.' } },
    run: (rt, args) => appProvider.openUrl(rt, args),
  })

  register({
    name: 'android_screenshot',
    description:
      'Capture a PNG screenshot from the selected Android device or emulator, save it to disk, and return it as an image when the current model accepts image input.',
    parameters: {
      ...TARGET,
      path: { type: 'string', description: 'Output path relative to the session workspace; defaults under the plugin data directory.' },
    },
    output: {
      schema: ANY_OBJECT,
      render: (_args, value) =>
        value.attachment === undefined ? textContent(value) : imageContent(value, value.attachment),
    },
    execute: body('android_screenshot', async (rt, args, exec) => {
      const shot = await screenshotProvider.shot(rt, args)
      const value = {
        device: shot.device,
        path: shot.path,
        bytes: shot.bytes,
        mediaType: 'image/png',
      }
      const admitted = await admitImage(rt, ctx, exec, shot.data)
      return admitted.ok ? { ...value, attachment: admitted.attachment } : { ...value, imageUnavailable: admitted.reason }
    }),
  })

  targetTool({
    name: 'android_logs',
    description: 'Read recent logcat output, optionally filtered by application ID.',
    parameters: {
      applicationId: { type: 'string', description: 'Filter lines mentioning this application id.' },
      lines: { type: 'integer', description: 'How many recent lines to read. Defaults to the plugin setting, max 5000.' },
      limit: { type: 'integer', description: 'Maximum characters of rendered output.' },
    },
    run: (rt, args) => logsProvider.logs(rt, args),
  })

  jsonTool({
    name: 'android_ui_status',
    description: 'Report whether the Android UI automation backend is available.',
    parameters: {},
    run: (rt) => uiProvider.status(rt),
  })

  targetTool({
    name: 'android_ui_describe',
    description: 'Return a compact UI Automator element tree for the current Android screen.',
    run: (rt, args) => uiProvider.describe(rt, args),
  })

  targetTool({
    name: 'android_ui_resolve',
    description: 'Resolve a text, content description, resource id, or class query to screen coordinates.',
    parameters: { query: { type: 'string', required: true, description: 'Case-insensitive substring to match.' } },
    run: (rt, args) => uiProvider.resolve(rt, args),
  })

  targetTool({
    name: 'android_ui_tap',
    description: 'Tap screen coordinates using Android UI automation.',
    parameters: {
      x: { type: 'number', required: true, description: 'Screen x in pixels.' },
      y: { type: 'number', required: true, description: 'Screen y in pixels.' },
    },
    run: (rt, args) => uiProvider.tap(rt, args),
  })

  targetTool({
    name: 'android_ui_swipe',
    description: 'Swipe between screen coordinates using Android UI automation.',
    parameters: {
      x1: { type: 'number', required: true, description: 'Start x in pixels.' },
      y1: { type: 'number', required: true, description: 'Start y in pixels.' },
      x2: { type: 'number', required: true, description: 'End x in pixels.' },
      y2: { type: 'number', required: true, description: 'End y in pixels.' },
      durationMs: { type: 'number', description: 'Swipe duration in milliseconds. Defaults to 300.' },
    },
    run: (rt, args) => uiProvider.swipe(rt, args),
  })

  targetTool({
    name: 'android_ui_type_text',
    description: 'Enter text into the currently focused Android control.',
    parameters: { text: { type: 'string', required: true, description: 'Text to type; max 1000 characters.' } },
    run: (rt, args) => uiProvider.typeText(rt, args),
  })

  targetTool({
    name: 'android_ui_keyevent',
    description: `Press one of ${KEYS.join(', ')} on the selected Android device.`,
    parameters: { key: { type: 'string', required: true, enum: KEYS, description: 'Named key event.' } },
    run: (rt, args) => uiProvider.keyevent(rt, args),
  })

  return disposers
}

/**
 * Store a screenshot as a durable image attachment.
 *
 * The harness only accepts an image block that references the attachment
 * store, so the base64 payload is committed here rather than placed in the
 * tool's canonical value. Every refusal degrades to a text-only result that
 * still names the PNG on disk: a screenshot that the model cannot see is still
 * useful to the user, and a missing attachments service must not fail the call.
 *
 * @param {object} rt - the call runtime.
 * @param {object} ctx - the plugin context.
 * @param {object} exec - the tool execution record.
 * @param {string} data - base64 PNG bytes.
 * @returns {Promise<{ok: true, attachment: unknown}|{ok: false, reason: string}>} the admission outcome.
 */
async function admitImage(rt, ctx, exec, data) {
  const attachments = ctx.get?.('attachments')
  if (attachments === undefined || typeof attachments.saveImages !== 'function') {
    return { ok: false, reason: 'this deployment stores no attachments, so the image was only written to disk' }
  }
  const model = exec?.agent?.options?.model
  const provider = exec?.agent?.options?.provider
  const llm = ctx.get?.('llm')
  if (llm !== undefined && model !== undefined && provider !== undefined) {
    try {
      const info = await llm.resolveModelInfo(provider, model, exec.signal)
      if (Array.isArray(info?.inputModalities) && !info.inputModalities.includes('image')) {
        return { ok: false, reason: `model "${model}" does not declare image input` }
      }
    } catch (error) {
      rt.logger.warn(`android_screenshot: could not verify image input support: ${message(error)}`)
    }
  }
  try {
    const [attachment] = await attachments.saveImages([
      { data: Buffer.from(data, 'base64'), mediaType: 'image/png', name: 'android-screenshot.png' },
    ])
    return attachment === undefined
      ? { ok: false, reason: 'the attachment store returned no reference' }
      : { ok: true, attachment }
  } catch (error) {
    return { ok: false, reason: `image admission refused the screenshot: ${message(error)}` }
  }
}

/** Error message of an arbitrary thrown value. */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
