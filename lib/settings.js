import z from '@deepseek-ai/schemastery'

/**
 * The plugin's live-editable configuration.
 *
 * `@deepseek-ai/dsh-settings` projects one form per profile entry from the
 * entry's own `Config`. Every field this plugin wants a user to edit must be
 * marked `.volatile()`: the marker is what makes the value a live reference
 * that is re-read on each use instead of being frozen into the entry at mount
 * time, and it is also what the settings service projects into its form.
 *
 * @module dsh-android-emulator-helper/settings
 */

/**
 * Settings namespace = the `cordis.patch.yml` insert row id = the id the DSH
 * settings service keys this plugin's form by. The browser half spells this
 * same string literally (a client package must not import a host package), so
 * the three places must move together.
 */
export const SETTINGS_NAMESPACE = 'android-emulator-helper'

/** System-image variants accepted by `sdkmanager`. */
export const SYSTEM_IMAGE_VARIANTS = ['default', 'google_apis', 'google_apis_playstore']

/** Instruction sets accepted by `sdkmanager` for Android system images. */
export const SYSTEM_IMAGE_ABIS = ['arm64-v8a', 'x86_64', 'x86', 'armeabi-v7a']

/**
 * Every user-editable field, in the order the settings page groups them.
 *
 * Each entry carries the metadata both halves need: the host builds the
 * schemastery schema from it, and the same metadata is mirrored in
 * `lib/client.js` to render the controls. `env` names the historical
 * environment variable the field falls back to, so an existing ZCode or CI
 * setup keeps working without touching the settings page.
 */
export const FIELD_GROUPS = [
  {
    id: 'sdk',
    env: 'ANDROID_PLUGIN_SDK_PATH',
    fields: [
      {
        key: 'sdkPath',
        kind: 'text',
        env: 'ANDROID_PLUGIN_SDK_PATH',
        default: '',
        placeholder: '/Users/me/Library/Android/sdk',
        label: { zh: 'Android SDK 根目录', en: 'Android SDK root' },
        hint: {
          zh: '留空时依次探测 ANDROID_HOME、ANDROID_SDK_ROOT 与常见安装路径。',
          en: 'Empty falls back to ANDROID_HOME, ANDROID_SDK_ROOT, then the common install paths.',
        },
      },
      {
        key: 'jdkMajor',
        kind: 'text',
        env: 'ANDROID_PLUGIN_JDK_MAJOR',
        default: '17',
        placeholder: '17',
        label: { zh: 'JDK 主版本', en: 'JDK major version' },
        hint: {
          zh: '用于预检与安装指引，例如 17 或 21。',
          en: 'Used by preflight and the install guidance, e.g. 17 or 21.',
        },
      },
      {
        key: 'buildToolsVersion',
        kind: 'text',
        env: 'ANDROID_PLUGIN_BUILD_TOOLS_VERSION',
        default: '35.0.0',
        placeholder: '35.0.0',
        label: { zh: 'Build-tools 版本', en: 'Build-tools version' },
        hint: {
          zh: '预检与安装指引中使用的 Android SDK build-tools 版本。',
          en: 'The Android SDK build-tools version named by preflight and the install guidance.',
        },
      },
    ],
  },
  {
    id: 'emulator',
    fields: [
      {
        key: 'defaultAvd',
        kind: 'text',
        env: 'ANDROID_PLUGIN_DEFAULT_AVD',
        default: 'medium_phone',
        placeholder: 'medium_phone',
        label: { zh: '默认 AVD', en: 'Default AVD' },
        hint: {
          zh: '需要启动模拟器时优先使用；不存在时退回第一个可用 AVD。',
          en: 'Preferred when an emulator must be started; falls back to the first available AVD.',
        },
      },
      {
        key: 'defaultSerial',
        kind: 'text',
        default: '',
        placeholder: 'emulator-5554',
        label: { zh: '默认设备序列号', en: 'Default device serial' },
        hint: {
          zh: '留空时优先选择已就绪的模拟器，其次任意已就绪设备。',
          en: 'Empty prefers a ready emulator, then any ready device.',
        },
      },
      {
        key: 'autoStartEmulator',
        kind: 'boolean',
        default: true,
        label: { zh: '自动启动模拟器', en: 'Start an emulator automatically' },
        hint: {
          zh: '关闭后，没有已就绪设备时相关工具会直接报错，而不是启动模拟器。',
          en: 'When off, tools fail instead of starting an emulator when no device is ready.',
        },
      },
      {
        key: 'emulatorArgs',
        kind: 'multiline',
        default: '',
        placeholder: '-no-snapshot-load\n-gpu swiftshader_indirect\n-memory 4096',
        label: { zh: '额外 emulator 参数', en: 'Extra emulator arguments' },
        hint: {
          zh: '每行一个参数，`#` 开头为注释。例如 -no-snapshot-load、-gpu swiftshader_indirect、-memory 4096。',
          en: 'One argument per line; `#` starts a comment. e.g. -no-snapshot-load, -gpu swiftshader_indirect, -memory 4096.',
        },
      },
      {
        key: 'bootTimeoutMs',
        kind: 'number',
        default: 180000,
        label: { zh: '模拟器启动超时 (ms)', en: 'Emulator boot timeout (ms)' },
        hint: { zh: '等待模拟器启动完成的最长时间。', en: 'Longest wait for the emulator to finish booting.' },
      },
    ],
  },
  {
    id: 'image',
    fields: [
      {
        key: 'apiLevel',
        kind: 'text',
        env: 'ANDROID_PLUGIN_API_LEVEL',
        default: '35',
        placeholder: '35',
        label: { zh: 'Android API 级别', en: 'Android API level' },
        hint: {
          zh: '生成项目、安装 SDK 包与选择系统镜像时使用的 API 级别。',
          en: 'API level used when generating projects, installing SDK packages and picking a system image.',
        },
      },
      {
        key: 'systemImageVariant',
        kind: 'select',
        env: 'ANDROID_PLUGIN_SYSTEM_IMAGE_VARIANT',
        default: 'default',
        options: SYSTEM_IMAGE_VARIANTS,
        label: { zh: '系统镜像变体', en: 'System image variant' },
        hint: { zh: 'default / google_apis / google_apis_playstore。', en: 'default / google_apis / google_apis_playstore.' },
      },
      {
        key: 'systemImageAbi',
        kind: 'select',
        env: 'ANDROID_PLUGIN_SYSTEM_IMAGE_ABI',
        default: '',
        options: ['', ...SYSTEM_IMAGE_ABIS],
        label: { zh: '系统镜像 ABI', en: 'System image ABI' },
        hint: {
          zh: '留空时 Apple Silicon 用 arm64-v8a，其他宿主用 x86_64。',
          en: 'Empty uses arm64-v8a on Apple Silicon and x86_64 elsewhere.',
        },
      },
      {
        key: 'minSdk',
        kind: 'number',
        default: 23,
        label: { zh: '默认 minSdk', en: 'Default minSdk' },
        hint: { zh: 'android_create_app 生成新项目时的默认 minSdk。', en: 'Default minSdk for a project created by android_create_app.' },
      },
    ],
  },
  {
    id: 'build',
    fields: [
      {
        key: 'buildTimeoutMs',
        kind: 'number',
        default: 600000,
        label: { zh: 'Gradle 构建超时 (ms)', en: 'Gradle build timeout (ms)' },
        hint: { zh: '一次 assemble 任务的最长运行时间。', en: 'Longest runtime of one assemble task.' },
      },
      {
        key: 'gradleExtraArgs',
        kind: 'multiline',
        default: '',
        placeholder: '--offline\n-Pandroid.injected.testOnly=false',
        label: { zh: '额外 Gradle 参数', en: 'Extra Gradle arguments' },
        hint: { zh: '每行一个参数，`#` 开头为注释。', en: 'One argument per line; `#` starts a comment.' },
      },
    ],
  },
  {
    id: 'output',
    fields: [
      {
        key: 'dataDir',
        kind: 'text',
        default: '',
        placeholder: '~/.dsh/android-emulator-helper',
        label: { zh: '数据目录', en: 'Data directory' },
        hint: {
          zh: '截图与构建日志的根目录；留空时使用 $DSH_HOME/android-emulator-helper。',
          en: 'Root for screenshots and build logs; empty uses $DSH_HOME/android-emulator-helper.',
        },
      },
      {
        key: 'screenshotDir',
        kind: 'text',
        default: '',
        placeholder: '<数据目录>/screenshots',
        label: { zh: '截图目录', en: 'Screenshot directory' },
        hint: { zh: '留空时使用数据目录下的 screenshots。', en: 'Empty uses `screenshots` under the data directory.' },
      },
      {
        key: 'logTailLines',
        kind: 'number',
        default: 500,
        label: { zh: '默认 logcat 行数', en: 'Default logcat lines' },
        hint: { zh: 'android_logs 未指定行数时读取的最近行数。', en: 'Lines android_logs reads when the call names none.' },
      },
    ],
  },
]

/** Flat `key -> field descriptor` view of {@link FIELD_GROUPS}. */
export const FIELDS = new Map(FIELD_GROUPS.flatMap((group) => group.fields.map((field) => [field.key, field])))

/** Every field key, in declaration order. */
export const FIELD_KEYS = [...FIELDS.keys()]

/** Build the schemastery node for one field descriptor. */
function schemaFor(field) {
  let node
  switch (field.kind) {
    case 'boolean':
      node = z.boolean()
      break
    case 'number':
      node = z.natural()
      break
    default:
      node = z.string()
      break
  }
  node = node.default(field.default)
  const description = field.hint?.zh ?? field.hint?.en
  if (description) node = node.description(description)
  // `.volatile()` is what makes the value live: DSH stores the reference and
  // the plugin re-reads `.get()` on every call, so a settings save reaches the
  // next tool invocation without remounting the entry.
  return node.volatile()
}

/**
 * The plugin's `Config` export.
 *
 * One volatile node per field, so every field is both persisted as a normal
 * Cordis patch value and re-read live by {@link readSettings}.
 */
export const Config = z.object(Object.fromEntries([...FIELDS].map(([key, field]) => [key, schemaFor(field)])))

/** Unwrap a live (volatile) reference, a plain value, or a missing field. */
function liveValue(node, fallback) {
  if (node === undefined || node === null) return fallback
  if (typeof node === 'object' && typeof node.get === 'function') {
    const value = node.get()
    return value === undefined || value === null ? fallback : value
  }
  return node
}

/** Coerce one setting to a non-empty trimmed string, else `undefined`. */
function stringFrom(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Coerce one setting to a positive integer, else `undefined`. */
function positiveIntFrom(value) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Project the entry's live config into plain values for one call.
 *
 * Called once per tool invocation, so a value saved in the settings page is
 * visible to the very next call. Empty text fields fall back to the historical
 * environment variable, then to the declared default, mirroring the ZCode
 * plugin's `userConfig` behaviour.
 *
 * @param {Record<string, unknown>} config - the entry config handed to `apply`.
 * @param {NodeJS.ProcessEnv} [env] - process environment for the legacy fallback.
 * @returns {Record<string, unknown>} plain, validated setting values.
 */
export function readSettings(config, env = process.env) {
  const raw = config ?? {}
  const out = {}
  for (const [key, field] of FIELDS) {
    const live = liveValue(raw[key], undefined)
    switch (field.kind) {
      case 'boolean': {
        out[key] = typeof live === 'boolean' ? live : field.default
        break
      }
      case 'number': {
        out[key] = positiveIntFrom(live) ?? positiveIntFrom(field.env ? env[field.env] : undefined) ?? field.default
        break
      }
      case 'select': {
        const value = stringFrom(live) ?? stringFrom(field.env ? env[field.env] : undefined) ?? field.default
        out[key] = field.options.includes(value) ? value : field.default
        break
      }
      default: {
        out[key] = stringFrom(live) ?? stringFrom(field.env ? env[field.env] : undefined) ?? field.default
        break
      }
    }
  }
  return out
}

/**
 * The system-image package id implied by the current settings.
 *
 * @param {Record<string, unknown>} settings - output of {@link readSettings}.
 * @returns {string} e.g. `system-images;android-35;google_apis;arm64-v8a`.
 */
export function systemImagePackage(settings) {
  const abi = settings.systemImageAbi || (process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64')
  return `system-images;android-${settings.apiLevel};${settings.systemImageVariant};${abi}`
}
