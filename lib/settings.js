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
 * @module @zhz8888/dsh-android-emulator-helper/settings
 */

/**
 * The kind of control the configuration page renders for a field.
 *
 * The kind decides both the control and the value's type, so the two are
 * declared together: a `boolean` field carries a boolean default, a `number`
 * field a number, and a text-like field a string.
 *
 * `select` and `discovery` are both choices and differ in where the list comes
 * from. A `select`'s options are the fixed `options` its descriptor carries,
 * so both halves of the plugin can hold them; a `discovery` field's options
 * are found on the host and served through the discovery route, so its
 * descriptor carries no list and the page renders whatever the machine has.
 *
 * @typedef {'text' | 'multiline' | 'number' | 'boolean' | 'select' | 'discovery'} FieldKind
 */

/**
 * One label or hint in both languages.
 *
 * @typedef {{zh: string, en: string}} LocalizedText
 */

/**
 * The metadata every field carries, whatever its kind.
 *
 * @typedef {object} FieldMetaBase
 * @property {string} key - the settings key; also the schema key and the client field key.
 * @property {FieldKind} kind - the control the configuration page renders.
 * @property {string} [env] - the legacy environment variable that configures the same value.
 * @property {string} [placeholder] - the placeholder the configuration page shows.
 * @property {LocalizedText} label - the field label.
 * @property {LocalizedText} [hint] - the field hint.
 */

/**
 * A free-text field.
 *
 * @typedef {FieldMetaBase & {kind: 'text' | 'multiline', default: string}} TextFieldMeta
 */

/**
 * A numeric field.
 *
 * @typedef {FieldMetaBase & {kind: 'number', default: number}} NumberFieldMeta
 */

/**
 * A boolean field.
 *
 * @typedef {FieldMetaBase & {kind: 'boolean', default: boolean}} BooleanFieldMeta
 */

/**
 * A field the user picks from a fixed list.
 *
 * @typedef {FieldMetaBase & {kind: 'select', default: string, options: readonly string[]}} SelectFieldMeta
 */

/**
 * A field the user picks from a list discovered on this machine.
 *
 * The options are deliberately not part of the table: the host serves them
 * through the discovery route, so an option list here would be a second,
 * staler copy. The value is therefore an ordinary string and the schema cannot
 * police the set; a saved value the discovery did not return is still shown by
 * the page, because the user has to be able to see, and fix, what is stored.
 *
 * @typedef {FieldMetaBase & {kind: 'discovery', default: string}} DiscoveryFieldMeta
 */

/**
 * One field of the configuration page.
 *
 * The union is discriminated on `kind`, so the `default` a field carries is
 * narrowed with it: a `boolean` field's default is a boolean, a `number`
 * field's is a number, and a text or choice field's is a string.
 *
 * @typedef {TextFieldMeta | NumberFieldMeta | BooleanFieldMeta | SelectFieldMeta | DiscoveryFieldMeta} FieldMeta
 */

/**
 * One group of fields on the configuration page.
 *
 * @typedef {object} FieldGroup
 * @property {string} id - the group id, also the dictionary namespace prefix.
 * @property {string} [env] - the legacy environment variable that configures the group.
 * @property {LocalizedText} title - the group title.
 * @property {LocalizedText} [hint] - the group hint.
 * @property {FieldMeta[]} fields - the group's fields, in page order.
 */

/**
 * The 17 live settings, as {@link readSettings} projects them.
 *
 * This interface is written by hand rather than derived from the schemastery
 * schema, because schemastery widens every object to `Record<string, any>`:
 * a derived type would accept a key nobody declared, which is exactly the
 * mistake this interface exists to catch. Two dozen places in this plugin read
 * a setting, and a key renamed at the table would leave every one of them
 * reading `undefined` — a timeout that collapses to a millisecond, or an
 * emulator that starts when the user asked it not to.
 *
 * `readSettings` fills one key per field of {@link FIELD_GROUPS}, so the two
 * declarations describe the same set; `test/settings.test.js` pins the
 * defaults, and `scripts/check-bundle.mjs` pins the key set against the
 * configuration page.
 *
 * @typedef {object} AndroidSettings
 * @property {string} sdkPath - the Android SDK root; empty means "probe".
 * @property {string} jdkMajor - the JDK major version the diagnostic and the install guidance name.
 * @property {string} buildToolsVersion - the Android SDK build-tools version the install guidance names.
 * @property {string} defaultAvd - the AVD the emulator tools start when the call names none.
 * @property {string} defaultSerial - the device serial the device tools prefer; empty means "any ready device".
 * @property {boolean} autoStartEmulator - whether a tool may start an emulator on demand.
 * @property {string} emulatorArgs - extra `emulator` arguments, one per line.
 * @property {number} bootTimeoutSeconds - longest wait for one emulator boot.
 * @property {string} apiLevel - the Android API level the SDK and project defaults use.
 * @property {string} systemImageVariant - the system-image variant `sdkmanager` installs.
 * @property {string} systemImageAbi - the system-image ABI; empty means "automatic".
 * @property {number} minSdk - the default `minSdk` of a generated project.
 * @property {number} buildTimeoutSeconds - longest wait for one Gradle assemble task.
 * @property {string} gradleExtraArgs - extra Gradle arguments, one per line.
 * @property {string} dataDir - the plugin's data root, relative to the workspace when set.
 * @property {string} screenshotDir - the screenshot root, relative to the workspace when set.
 * @property {number} logTailLines - how many logcat lines one call reads by default.
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
export const FIELD_GROUPS = /** @type {FieldGroup[]} */ ([
  {
    id: 'sdk',
    env: 'ANDROID_PLUGIN_SDK_PATH',
    // The heading and hint the settings page renders around this card. The
    // browser half cannot import this module, so it carries its own copy;
    // `scripts/check-bundle.mjs` compares the two word for word.
    title: { zh: 'SDK 与工具链', en: 'SDK and toolchain' },
    hint: {
      zh: '预检、编译与 sdkmanager 使用的 Android SDK 与 JDK 位置。',
      en: 'The Android SDK and JDK the diagnostic, the build and sdkmanager use.',
    },
    fields: [
      {
        key: 'sdkPath',
        kind: 'text',
        env: 'ANDROID_PLUGIN_SDK_PATH',
        default: '',
        placeholder: '~/Android/Sdk',
        label: { zh: 'Android SDK 根目录', en: 'Android SDK root' },
        hint: {
          zh: '留空时依次探测 ANDROID_HOME、ANDROID_SDK_ROOT、注册表、工程的 local.properties，以及各磁盘上的常见安装路径。',
          en: 'Empty falls back to ANDROID_HOME, ANDROID_SDK_ROOT, the registry, the project local.properties, then the common install paths on every drive.',
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
          zh: '用于预检与安装指引；下拉项来自本机已安装的 JDK。',
          en: "Used by the diagnostic and the install guidance; the suggestions come from this machine's JDKs.",
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
          zh: '生成工程时固定写入的 Android SDK build-tools 版本；留空则由 AGP 自行选择。',
          en: 'The Android SDK build-tools version pinned into a generated project; leave empty to let AGP choose.',
        },
      },
    ],
  },
  {
    id: 'emulator',
    title: { zh: '模拟器与设备', en: 'Emulator and devices' },
    hint: {
      zh: '选择默认 AVD、如何启动模拟器，以及传给 emulator 的命令行参数。',
      en: 'The default AVD, how the emulator starts, and the arguments it receives.',
    },
    fields: [
      {
        key: 'defaultAvd',
        kind: 'discovery',
        env: 'ANDROID_PLUGIN_DEFAULT_AVD',
        default: 'medium_phone',
        placeholder: 'medium_phone',
        label: { zh: '默认 AVD', en: 'Default AVD' },
        hint: {
          zh: '下拉项列出本机所有 AVD；需要启动模拟器时优先使用，不存在时退回第一个可用 AVD。',
          en: 'The dropdown lists every AVD on this machine; preferred when an emulator must be started, falling back to the first available AVD.',
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
        placeholder: '-no-snapshot-load\n-gpu\nswiftshader_indirect\n-memory\n4096',
        label: { zh: '额外 emulator 参数', en: 'Extra emulator arguments' },
        hint: {
          zh: '每行一个参数，选项和它的取值也各占一行；`#` 开头为注释。例如 -no-snapshot-load，或分两行写 -gpu 与 swiftshader_indirect。',
          en: 'One argument per line, and an option and its value each get their own line; `#` starts a comment. e.g. -no-snapshot-load, or -gpu and swiftshader_indirect on two lines.',
        },
      },
      {
        key: 'bootTimeoutSeconds',
        kind: 'number',
        default: 180,
        label: { zh: '模拟器启动超时（秒）', en: 'Emulator boot timeout (seconds)' },
        hint: {
          zh: '等待模拟器完成启动的最长时间，默认 180 秒。',
          en: 'Longest wait for the emulator to finish booting; 180 seconds by default.',
        },
      },
    ],
  },
  {
    id: 'image',
    title: { zh: 'API 级别与系统镜像', en: 'API level and system image' },
    hint: {
      zh: '生成项目、安装 SDK 包与创建 AVD 时使用的默认值。',
      en: 'Defaults used when generating a project, installing SDK packages and creating an AVD.',
    },
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
          zh: '自动时 Apple Silicon 用 arm64-v8a，其他宿主用 x86_64。',
          en: 'Automatic uses arm64-v8a on Apple Silicon and x86_64 elsewhere.',
        },
      },
      {
        key: 'minSdk',
        kind: 'number',
        default: 23,
        label: { zh: '默认 minSdk', en: 'Default minSdk' },
        hint: {
          zh: 'android_create_app 生成新项目时的默认 minSdk，默认 23。',
          en: 'Default minSdk for a project created by android_create_app; 23 by default.',
        },
      },
    ],
  },
  {
    id: 'build',
    title: { zh: '构建', en: 'Build' },
    hint: {
      zh: 'Gradle 构建的超时与附加参数。',
      en: 'Gradle timeouts and extra arguments.',
    },
    fields: [
      {
        key: 'buildTimeoutSeconds',
        kind: 'number',
        default: 600,
        label: { zh: 'Gradle 构建超时（秒）', en: 'Gradle build timeout (seconds)' },
        hint: {
          zh: '一次 assemble 任务的最长运行时间，默认 600 秒。',
          en: 'Longest runtime of one assemble task; 600 seconds by default.',
        },
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
    title: { zh: '输出目录与日志', en: 'Output and logs' },
    hint: {
      zh: '截图与构建日志的落盘位置。',
      en: 'Where screenshots and build logs are written.',
    },
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
        hint: {
          zh: 'android_logs 未指定行数时读取的最近行数，默认 500。',
          en: 'Lines android_logs reads when the call names none; 500 by default.',
        },
      },
    ],
  },
])

/** Flat `key -> field descriptor` view of {@link FIELD_GROUPS}. */
export const FIELDS = /** @type {Map<string, FieldMeta>} */ (
  new Map(FIELD_GROUPS.flatMap((group) => group.fields.map((field) => [field.key, field])))
)

/** Every field key, in declaration order. */
export const FIELD_KEYS = [...FIELDS.keys()]

/**
 * The three schemastery node shapes this module builds.
 *
 * The package does not export its `Schema` type alias, so each shape is
 * derived from the factory that produces it. The mode matters and moves twice:
 * a node is `plain` when it is created, `defined` once it carries a default,
 * and `volatile-defined` once it is made live.
 *
 * @typedef {ReturnType<ReturnType<typeof z.boolean>['default']>} BooleanDraft
 * @typedef {ReturnType<ReturnType<typeof z.natural>['default']>} NumberDraft
 * @typedef {ReturnType<ReturnType<typeof z.string>['default']>} StringDraft
 * @typedef {ReturnType<BooleanDraft['volatile']>} BooleanNode
 * @typedef {ReturnType<NumberDraft['volatile']>} NumberNode
 * @typedef {ReturnType<StringDraft['volatile']>} StringNode
 */

/**
 * Build the schemastery node for one field descriptor.
 *
 * The node is built per kind rather than through one variable, because the
 * three node types have different value types and a single variable would be
 * a union whose `default()` cannot be called. The field's own `kind` decides
 * which one, so the default that is passed along is always the right type.
 *
 * @param {FieldMeta} field - the field to describe.
 * @returns {BooleanNode | NumberNode | StringNode} the node.
 */
function schemaFor(field) {
  switch (field.kind) {
    case 'boolean':
      return describe(z.boolean().default(field.default), field).volatile()
    case 'number':
      return describe(z.natural().default(field.default), field).volatile()
    default:
      return describe(z.string().default(field.default), field).volatile()
  }
}

/**
 * Attach the field's description to a node.
 *
 * `.volatile()` is what makes the value live: DSH stores the reference and
 * the plugin re-reads `.get()` on every call, so a settings save reaches the
 * next tool invocation without remounting the entry. It is applied by the
 * caller, because it changes the node's mode and therefore its type.
 *
 * @param {BooleanDraft | NumberDraft | StringDraft} node - the node to describe.
 * @param {FieldMeta} field - the field the node describes.
 * @returns {BooleanDraft | NumberDraft | StringDraft} the described node.
 */
function describe(node, field) {
  const description = field.hint?.zh ?? field.hint?.en
  return description ? node.description(description) : node
}

/**
 * The plugin's `Config` export.
 *
 * One volatile node per field, so every field is both persisted as a normal
 * Cordis patch value and re-read live by {@link readSettings}.
 */
export const Config = z.object(Object.fromEntries([...FIELDS].map(([key, field]) => [key, schemaFor(field)])))

/**
 * Unwrap a live (volatile) reference, a plain value, or a missing field.
 *
 * @param {unknown} node - the stored value, which may be a live reference.
 * @param {unknown} fallback - the value to use when the node holds nothing usable.
 * @returns {unknown} the live value, or the fallback.
 */
function liveValue(node, fallback) {
  if (node === undefined || node === null) return fallback
  if (typeof node === 'object' && typeof /** @type {{get?: unknown}} */ (node).get === 'function') {
    const value = /** @type {{get: () => unknown}} */ (node).get()
    return value === undefined || value === null ? fallback : value
  }
  return node
}

/**
 * Coerce one setting to a non-empty trimmed string, else `undefined`.
 *
 * @param {unknown} value - the raw value.
 * @returns {string | undefined} the trimmed string, or `undefined`.
 */
function stringFrom(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Coerce one setting to a positive integer, else `undefined`.
 *
 * @param {unknown} value - the raw value.
 * @returns {number | undefined} the positive integer, or `undefined`.
 */
function positiveIntFrom(value) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  // 0 is treated as unset: the schema accepts natural numbers so an existing
  // profile that stored 0 keeps loading, while every consumer gets a usable
  // positive default. The configuration form refuses 0 so a new save cannot
  // create that state.
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
 * @returns {AndroidSettings} plain, validated setting values.
 */
export function readSettings(config, env = process.env) {
  const raw = config ?? {}
  /** @type {Record<string, string | number | boolean>} */
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
  // The loop writes exactly one key per field of `FIELD_GROUPS`, and each
  // branch writes the value type that field's `kind` declares, so the
  // accumulator has the shape of `AndroidSettings`. The cast is where that is
  // asserted; `test/settings.test.js` checks the key set and the value types
  // of the result against the same field table.
  return /** @type {AndroidSettings} */ (out)
}

/**
 * The system-image package id implied by the current settings.
 *
 * @param {AndroidSettings} settings - output of {@link readSettings}.
 * @returns {string} e.g. `system-images;android-35;google_apis;arm64-v8a`.
 */
export function systemImagePackage(settings) {
  const abi = settings.systemImageAbi || (process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64')
  return `system-images;android-${settings.apiLevel};${settings.systemImageVariant};${abi}`
}
