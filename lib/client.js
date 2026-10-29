window.__ModuleLoader__.load({
	id: "@zhz8888/dsh-android-emulator-helper",
	factory: (require) => {
		/** @type {{exports: Record<string, unknown>}} */
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const P = require("@deepseek-ai/dsh-client-ui-primitives");
		const h = React.createElement;

		/**
		 * Browser half of @zhz8888/dsh-android-emulator-helper: the emulator
		 * parameters, rendered on the Plugins page.
		 *
		 * The form belongs to the plugin, so it lives on the plugin's own page:
		 * the Plugins page renders it inside the plugin detail, between the
		 * package description and the component rows, through its
		 * `plugins.bundle.config` keyed slot. The key is the BUNDLE's package
		 * name — the value the plugin manager's inventory compares against — not
		 * the settings namespace: the namespace is the patch row id this plugin
		 * mounts, and a deployment may mount the same code under another row.
		 *
		 * It registers only while the Host actually serves this plugin's settings
		 * namespace, so a deployment without the host half shows no trace of the
		 * form, and it is disposed again when the namespace stops being served.
		 *
		 * Everything the user edits goes through the shared config form
		 * (`ctx.configForms.get`): staged edits, invalid-draft detection,
		 * optimistic-concurrency revisions and the write itself are the
		 * harness' behaviour, not reimplemented here. The two buttons in the
		 * diagnostics card call the host half's exact Fetch routes.
		 *
		 * @module @zhz8888/dsh-android-emulator-helper/client
		 */

		/** Settings namespace = the profile entry id, spelled literally. */
		const NS = "android-emulator-helper";
		/**
		 * The package name the Plugins page keys a bundle's own configuration by.
		 *
		 * `plugins.bundle.config` is a keyed slot and the page renders it with
		 * `entryKey: pkg.name`, so this string must equal `package.json`'s name
		 * exactly; the settings namespace above is a different string and never
		 * a substitute. `scripts/check-bundle.mjs` compares the two.
		 */
		const PACKAGE_NAME = "@zhz8888/dsh-android-emulator-helper";
		/** Dictionary namespace owned by this page. */
		const LOCALE_NS = "settings.androidEmulatorHelper";
		/** Exact Fetch routes registered by the host half. */
		const STATUS_ROUTE = "/api/android-emulator-helper/status";
		const INVENTORY_ROUTE = "/api/android-emulator-helper/inventory";

		/** CSS ownership tag; the framework reclaims this on unload. */
		const CSS_TAG = "@zhz8888/dsh-android-emulator-helper/PluginPage.module.css";

		const CSS = [
			// Page frame. The Plugins page draws the title, the icon, the crumb and
			// the package description itself, so this half contributes the form
			// only: one line saying when the edits take effect, then one card per
			// category — the card outline is what separates the categories, so no
			// rule is needed between them and each group reads as one block. The
			// metrics are read from the platform's own field kit —
			// `@deepseek-ai/dsh-client-ui-primitives/lib/settings-form/fields.module.css`
			// (MIT), which every built-in settings page uses — so the form sits
			// beside them: a 13/1.5 label, a 12px hint, a 34px control on a 0.5px
			// border-l4 edge. The composition above those pieces is this page's own.
			// The form is dense on purpose: a field is 8px of own padding, a card
			// closes 16px below its last hint, and the cards sit 16px apart — which
			// is tighter than the platform kit's 12px-per-field rhythm, because a
			// card supplies the separation a bare form gets from its dividers.
			".aemh_page{flex-direction:column;display:flex;max-width:100%;color:var(--dsw-alias-label-primary)}",
			".aemh_intro{margin:0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary)}",
			".aemh_readOnly{margin:12px 0 0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}",
			".aemh_group{margin-top:16px;padding:12px 16px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);flex-direction:column;display:flex}",
			".aemh_groupHead{align-items:baseline;gap:8px;display:flex}",
			".aemh_groupTitle{margin:0;font-size:14px;font-weight:600;line-height:1.5}",
			".aemh_groupHint{color:var(--dsw-alias-label-tertiary);margin:4px 0 0;font-size:12px;line-height:1.5}",
			// One rhythm per card: 7px above and below every field, so two of them
			// sit 14px apart, and nothing below the last — the card's own padding
			// is what closes it, so a card does not end in a pocket of empty space
			// when its last row is a 12px hint rather than a control.
			".aemh_field{flex-direction:column;gap:6px;display:flex;padding:7px 0;min-width:0}",
			".aemh_group>.aemh_field:last-child{padding-bottom:0}",
			".aemh_fieldHead{align-items:center;gap:8px;display:flex;min-width:0}",
			".aemh_label{font-size:13px;font-weight:500;line-height:1.5}",
			".aemh_reset{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary);text-decoration:underline;cursor:pointer;background:none;border:0;padding:0}",
			".aemh_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
			".aemh_reset:disabled{cursor:default;opacity:.5}",
			".aemh_control{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);outline:none;padding:0 12px;font-size:13px;line-height:1.5;width:100%}",
			".aemh_control:focus-visible{border-color:var(--dsw-alias-state-business-primary)}",
			".aemh_control[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}",
			".aemh_control:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",
			"textarea.aemh_control{height:auto;min-height:96px;padding:10px 12px;line-height:1.6;resize:vertical;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px}",
			".aemh_selectWrap{position:relative;display:block}",
			".aemh_selectWrap::after{content:\"\";position:absolute;right:12px;top:calc(50% - 2px);border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--dsw-alias-label-tertiary);pointer-events:none}",
			".aemh_select{appearance:none;cursor:pointer;padding-right:28px}",
			// Every paragraph states its own margin. The bundle is compiled on its
			// own, so it cannot lean on a bare-element reset from wherever it is
			// mounted, and without this each hint picks up the UA's
			// `p { margin: 1em 0 }` — 12px above and below one line of 12px text,
			// which is what made the fields read as far apart however tightly the
			// boxes were packed. Measured in Chromium at 760px wide: 24px per hint,
			// and a 2992px page before the tightening against 2440px after.
			".aemh_hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}",
			".aemh_error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.6}",
			// A row of buttons is the only child that is not a paragraph, so it
			// carries the gap the page's 12px paragraphs get from their margins.
			".aemh_toolRow{flex-wrap:wrap;align-items:center;gap:10px;display:flex;margin-top:8px}",
			".aemh_checks{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}",
			".aemh_check{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:flex-start;gap:10px;padding:8px 0;display:flex}",
			".aemh_check:last-child{border-bottom:0;padding-bottom:0}",
			".aemh_checkBody{flex-direction:column;gap:2px;min-width:0;flex:1;display:flex}",
			".aemh_checkName{font-size:13px;line-height:1.5}",
			".aemh_checkDetail{color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;white-space:pre-wrap;margin:0;font-size:12px;line-height:1.5}",
			".aemh_checkFix{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary));overflow-wrap:anywhere;margin:0;font-size:12px;line-height:1.5}",
			".aemh_verdict{align-items:center;gap:8px;font-size:13px;line-height:1.5;display:flex}",
			".aemh_note{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}",
			".aemh_mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);overflow-wrap:anywhere}",
			// A small pill, not a full-width panel: it hugs its message and buttons and
			// centres itself in the page column with auto margins, so it reads as a
			// floating notice. It is still one in-flow child held at the bottom by
			// `position: sticky`, so it never covers a field and nothing has to
			// reserve room for it.
			".aemh_actions{position:sticky;bottom:16px;z-index:1;box-sizing:border-box;margin:20px auto 0;padding:6px 8px 6px 14px;width:max-content;max-width:min(560px,100%);border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-soft,0 4px 14px -6px rgba(0,0,0,.2));align-items:center;gap:8px;display:flex}",
			".aemh_actionsText{flex:0 1 auto;min-width:0;margin:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:1.5}",
			".aemh_actionsError .aemh_actionsText{color:var(--dsw-alias-state-error-primary)}",
		].join("");

		/**
		 * A piece of copy in both languages.
		 *
		 * @typedef {{zh: string, en: string}} LocalizedText
		 */

		/**
		 * The control kinds this half can render.
		 *
		 * Declared as a literal union and then enforced twice against
		 * {@link RENDERERS}: `RENDERERS` is annotated `Record<FieldKind, …>`, so a
		 * key missing from the map is a type error, and `FIELD_KINDS` is derived
		 * from the map's own keys, so a key the map does not have cannot reach the
		 * gate. The two directions are what make "in the exported list" and
		 * "the page renders it" the same property.
		 *
		 * @typedef {"text" | "number" | "boolean" | "select" | "multiline"} FieldKind
		 */

		/**
		 * One field as this half describes it.
		 *
		 * The host owns the schema and the persistence; this descriptor only says
		 * how the page renders the field. `kind` picks the control, `suggest`
		 * names one of the discovery-backed suggestion lists, and `optionLabel`
		 * carries a per-option label the dictionary has an entry for.
		 *
		 * @typedef {object} FieldDescriptor
		 * @property {string} key - the field name inside the settings section.
		 * @property {FieldKind} kind - the control the field renders as.
		 * @property {string} [suggest] - the suggestion source the field offers.
		 * @property {string} [placeholder] - the placeholder the control shows.
		 * @property {string[]} [options] - the values a select offers.
		 * @property {LocalizedText} label - the field's label.
		 * @property {LocalizedText} hint - the field's hint.
		 * @property {Record<string, LocalizedText>} [optionLabel] - per-option labels.
		 */

		/**
		 * One group of fields as this half describes it.
		 *
		 * @typedef {object} GroupDescriptor
		 * @property {string} id - the group id, which is part of its dictionary keys.
		 * @property {LocalizedText} title - the card's heading.
		 * @property {LocalizedText} hint - the card's hint.
		 * @property {FieldDescriptor[]} fields - the fields the card holds.
		 */

		/**
		 * The dictionary lookup the page renders with.
		 *
		 * @typedef {(key: string, params?: Record<string, unknown>) => string} Translate
		 */

		/**
		 * The fixed dictionary keys, spelled out.
		 *
		 * The generated keys — `group.<id>`, `field.<key>`, `field.<key>.hint` and
		 * the option labels — cannot be known statically, so the working
		 * dictionaries add an index signature on top of this. The fixed keys stay
		 * listed here, so a typo in one of them is still a type error where it is
		 * written.
		 *
		 * @typedef {object} FixedDictionary
		 * @property {string} intro
		 * @property {string} invalid
		 * @property {string} overridden
		 * @property {string} reset
		 * @property {string} save
		 * @property {string} saving
		 * @property {string} discard
		 * @property {string} pendingWrite
		 * @property {string} writeBlocked
		 * @property {string} writeFailed
		 * @property {string} written
		 * @property {string} readOnly
		 * @property {string} unavailable
		 * @property {string} loading
		 * @property {string} toolsTitle
		 * @property {string} toolsHint
		 * @property {string} runCheck
		 * @property {string} checking
		 * @property {string} refresh
		 * @property {string} refreshing
		 * @property {string} ready
		 * @property {string} notReady
		 * @property {string} statusFailed
		 * @property {string} inventoryFailed
		 * @property {string} detectedSdk
		 * @property {string} installedImages
		 * @property {string} none
		 */

		/**
		 * A working dictionary: the fixed keys plus the generated ones.
		 *
		 * @typedef {Record<string, string> & FixedDictionary} Dictionary
		 */

		/**
		 * Field metadata, mirrored from `lib/settings.js`.
		 *
		 * The browser bundle cannot import a Host module (the client purity gate
		 * forbids cross-plugin value imports), so the descriptors are spelled
		 * here as well. `key`, `kind` and `options` must match the host schema:
		 * the host is what validates and persists, and the client only renders.
		 *
		 * @type {GroupDescriptor[]}
		 */
		const GROUPS = [
			{
				id: "sdk",
				title: { zh: "SDK 与工具链", en: "SDK and toolchain" },
				hint: {
					zh: "预检、编译与 sdkmanager 使用的 Android SDK 与 JDK 位置。",
					en: "The Android SDK and JDK the diagnostic, the build and sdkmanager use.",
				},
				fields: [
					{
						key: "sdkPath",
						kind: "text",
						placeholder: "~/Android/Sdk",
						label: { zh: "Android SDK 根目录", en: "Android SDK root" },
						hint: {
							zh: "留空时依次探测 ANDROID_HOME、ANDROID_SDK_ROOT、注册表、工程的 local.properties，以及各磁盘上的常见安装路径。",
							en: "Empty falls back to ANDROID_HOME, ANDROID_SDK_ROOT, the registry, the project local.properties, then the common install paths on every drive.",
						},
					},
					{
						key: "jdkMajor",
						kind: "text",
						suggest: "javaMajors",
						placeholder: "17",
						label: { zh: "JDK 主版本", en: "JDK major version" },
						hint: {
							zh: "用于预检与安装指引；下拉项来自本机已安装的 JDK。",
							en: "Used by the diagnostic and the install guidance; the suggestions come from this machine's JDKs.",
						},
					},
					{
						key: "buildToolsVersion",
						kind: "text",
						suggest: "buildTools",
						placeholder: "35.0.0",
						label: { zh: "Build-tools 版本", en: "Build-tools version" },
						hint: {
							zh: "生成工程时固定写入的 Android SDK build-tools 版本；留空则由 AGP 自行选择。",
							en: "The Android SDK build-tools version pinned into a generated project; leave empty to let AGP choose.",
						},
					},
				],
			},
			{
				id: "emulator",
				title: { zh: "模拟器与设备", en: "Emulator and devices" },
				hint: {
					zh: "选择默认 AVD、如何启动模拟器，以及传给 emulator 的命令行参数。",
					en: "The default AVD, how the emulator starts, and the arguments it receives.",
				},
				fields: [
					{
						key: "defaultAvd",
						kind: "text",
						suggest: "avds",
						placeholder: "medium_phone",
						label: { zh: "默认 AVD", en: "Default AVD" },
						hint: {
							zh: "需要启动模拟器时优先使用；不存在时退回第一个可用 AVD。",
							en: "Preferred when an emulator must be started; falls back to the first available AVD.",
						},
					},
					{
						key: "defaultSerial",
						kind: "text",
						suggest: "deviceSerials",
						placeholder: "emulator-5554",
						label: { zh: "默认设备序列号", en: "Default device serial" },
						hint: {
							zh: "留空时优先选择已就绪的模拟器，其次任意已就绪设备。",
							en: "Empty prefers a ready emulator, then any ready device.",
						},
					},
					{
						key: "autoStartEmulator",
						kind: "boolean",
						label: { zh: "自动启动模拟器", en: "Start an emulator automatically" },
						hint: {
							zh: "关闭后，没有已就绪设备时相关工具会直接报错，而不是启动模拟器。",
							en: "When off, tools fail instead of starting an emulator when no device is ready.",
						},
					},
					{
						key: "emulatorArgs",
						kind: "multiline",
						placeholder: "-no-snapshot-load\n-gpu swiftshader_indirect\n-memory 4096",
						label: { zh: "额外 emulator 参数", en: "Extra emulator arguments" },
						hint: {
							zh: "每行一个参数，`#` 开头为注释。例如 -no-snapshot-load、-gpu swiftshader_indirect、-memory 4096。",
							en: "One argument per line; `#` starts a comment. e.g. -no-snapshot-load, -gpu swiftshader_indirect, -memory 4096.",
						},
					},
					{
						key: "bootTimeoutSeconds",
						kind: "number",
						label: { zh: "模拟器启动超时（秒）", en: "Emulator boot timeout (seconds)" },
						hint: {
							zh: "等待模拟器完成启动的最长时间，默认 180 秒。",
							en: "Longest wait for the emulator to finish booting; 180 seconds by default.",
						},
					},
				],
			},
			{
				id: "image",
				title: { zh: "API 级别与系统镜像", en: "API level and system image" },
				hint: {
					zh: "生成项目、安装 SDK 包与创建 AVD 时使用的默认值。",
					en: "Defaults used when generating a project, installing SDK packages and creating an AVD.",
				},
				fields: [
					{
						key: "apiLevel",
						kind: "text",
						suggest: "apiLevels",
						placeholder: "35",
						label: { zh: "Android API 级别", en: "Android API level" },
						hint: {
							zh: "生成项目、安装 SDK 包与选择系统镜像时使用的 API 级别。",
							en: "API level used when generating projects, installing SDK packages and picking a system image.",
						},
					},
					{
						key: "systemImageVariant",
						kind: "select",
						options: ["default", "google_apis", "google_apis_playstore"],
						label: { zh: "系统镜像变体", en: "System image variant" },
						hint: {
							zh: "default / google_apis / google_apis_playstore。",
							en: "default / google_apis / google_apis_playstore.",
						},
					},
					{
						key: "systemImageAbi",
						kind: "select",
						options: ["", "arm64-v8a", "x86_64", "x86", "armeabi-v7a"],
						optionLabel: { "": { zh: "自动（按宿主架构）", en: "Automatic (from the host)" } },
						label: { zh: "系统镜像 ABI", en: "System image ABI" },
						hint: {
							zh: "自动时 Apple Silicon 用 arm64-v8a，其他宿主用 x86_64。",
							en: "Automatic uses arm64-v8a on Apple Silicon and x86_64 elsewhere.",
						},
					},
					{
						key: "minSdk",
						kind: "number",
						label: { zh: "默认 minSdk", en: "Default minSdk" },
						hint: {
							zh: "android_create_app 生成新项目时的默认 minSdk，默认 23。",
							en: "Default minSdk for a project created by android_create_app; 23 by default.",
						},
					},
				],
			},
			{
				id: "build",
				title: { zh: "构建", en: "Build" },
				hint: { zh: "Gradle 构建的超时与附加参数。", en: "Gradle timeouts and extra arguments." },
				fields: [
					{
						key: "buildTimeoutSeconds",
						kind: "number",
						label: { zh: "Gradle 构建超时（秒）", en: "Gradle build timeout (seconds)" },
						hint: {
							zh: "一次 assemble 任务的最长运行时间，默认 600 秒。",
							en: "Longest runtime of one assemble task; 600 seconds by default.",
						},
					},
					{
						key: "gradleExtraArgs",
						kind: "multiline",
						placeholder: "--offline\n-Pandroid.injected.testOnly=false",
						label: { zh: "额外 Gradle 参数", en: "Extra Gradle arguments" },
						hint: { zh: "每行一个参数，`#` 开头为注释。", en: "One argument per line; `#` starts a comment." },
					},
				],
			},
			{
				id: "output",
				title: { zh: "输出目录与日志", en: "Output and logs" },
				hint: { zh: "截图与构建日志的落盘位置。", en: "Where screenshots and build logs are written." },
				fields: [
					{
						key: "dataDir",
						kind: "text",
						placeholder: "~/.dsh/android-emulator-helper",
						label: { zh: "数据目录", en: "Data directory" },
						hint: {
							zh: "截图与构建日志的根目录；留空时使用 $DSH_HOME/android-emulator-helper。",
							en: "Root for screenshots and build logs; empty uses $DSH_HOME/android-emulator-helper.",
						},
					},
					{
						key: "screenshotDir",
						kind: "text",
						placeholder: "<数据目录>/screenshots",
						label: { zh: "截图目录", en: "Screenshot directory" },
						hint: {
							zh: "留空时使用数据目录下的 screenshots。",
							en: "Empty uses `screenshots` under the data directory.",
						},
					},
					{
						key: "logTailLines",
						kind: "number",
						label: { zh: "默认 logcat 行数", en: "Default logcat lines" },
						hint: {
							zh: "android_logs 未指定行数时读取的最近行数，默认 500。",
							en: "Lines android_logs reads when the call names none; 500 by default.",
						},
					},
				],
			},
		];

		/** Flat field list, in declaration order. */
		const FIELDS = GROUPS.flatMap((group) => group.fields);

		/**
		 * A whole-value field whose draft is the exact text the user typed.
		 *
		 * Used for selects: the control can only produce one of its options, so
		 * every non-empty draft is a valid value and an empty draft clears the
		 * override. `systemImageAbi`'s empty option is therefore spelled as a
		 * clear, which lands on the same inherited default.
		 *
		 * @param {string} field - the field name inside the namespace section.
		 * @returns {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFieldSpec} the spec.
		 */
		function wholeValueField(field) {
			return {
				field,
				format: (value) => (typeof value === "string" ? value : value === undefined || value === null ? "" : String(value)),
				parse: (text) => {
					const trimmed = text.trim();
					return trimmed === "" ? { kind: "clear" } : { kind: "set", value: trimmed };
				},
			};
		}

		/**
		 * A non-negative whole-number field.
		 *
		 * Stricter than `settingsNumberField`, which accepts any finite number:
		 * the host schema is `Schema.natural()`, so a negative or fractional
		 * draft would be staged happily and then rejected by the write. Rejecting
		 * it here turns that into an inline message instead of a failed save.
		 *
		 * @param {string} field - the field name inside the namespace section.
		 * @returns {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFieldSpec} the spec.
		 */
		function naturalField(field) {
			return {
				field,
				format: (value) => (typeof value === "number" ? String(value) : ""),
				parse: (text) => {
					const trimmed = text.trim();
					if (trimmed === "") return { kind: "clear" };
					if (!/^\d+$/.test(trimmed)) return undefined;
					const value = Number(trimmed);
					// The host reads these settings as positive integers: a saved 0
					// would be treated as "unset" and silently fall back to the
					// default, so the form must refuse it instead of persisting it.
					return value > 0 ? { kind: "set", value } : undefined;
				},
			};
		}

		/**
		 * A boolean field, staged as the literal `true`/`false` the switch renders.
		 *
		 * @param {string} field - the field name inside the namespace section.
		 * @returns {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFieldSpec} the spec.
		 */
		function booleanField(field) {
			return {
				field,
				format: (value) => (value === true ? "true" : "false"),
				parse: (text) => {
					const trimmed = text.trim().toLowerCase();
					if (trimmed === "") return { kind: "clear" };
					if (trimmed === "true" || trimmed === "1") return { kind: "set", value: true };
					if (trimmed === "false" || trimmed === "0") return { kind: "set", value: false };
					return undefined;
				},
			};
		}

		/**
		 * How one field kind is staged and rendered.
		 *
		 * This map is the single source of truth for both questions the page used
		 * to answer with two independent `switch` statements: what conversion spec
		 * the shared form stages the value through (`spec`) and what control the
		 * row draws (`render`). Deriving `FIELD_KINDS` from its keys is what makes
		 * the exported list and the renderer the same object — a kind added to the
		 * list cannot be a kind nothing renders, and a kind nothing renders cannot
		 * be added to the list.
		 *
		 * The `text` renderer is the generic input: it carries the datalist, and it
		 * is the only one that has to tell a number apart (input type, input mode),
		 * which is why the two share a renderer and differ only in `spec`.
		 *
		 * @type {Record<FieldKind, {spec: (field: FieldDescriptor) => import("@deepseek-ai/dsh-client-ui-primitives").SettingsFieldSpec, render: (input: ControlInput) => import("react").ReactNode}>}
		 */
		const RENDERERS = {
			text: { spec: (field) => P.settingsTextField(field.key), render: renderTextInput },
			number: { spec: (field) => naturalField(field.key), render: renderTextInput },
			boolean: { spec: (field) => booleanField(field.key), render: renderSwitch },
			select: { spec: (field) => wholeValueField(field.key), render: renderSelect },
			multiline: { spec: (field) => P.settingsTextField(field.key), render: renderTextarea },
		};

		/**
		 * The field kinds this half actually renders.
		 *
		 * Derived from {@link RENDERERS}, so the list the gate compares against and
		 * the set of kinds the page can draw are the same set by construction. A
		 * kind the page does not render cannot appear here, which is exactly the
		 * invariant the consistency gate exists to enforce.
		 *
		 * @type {readonly FieldKind[]}
		 */
		const FIELD_KINDS = Object.freeze(/** @type {FieldKind[]} */ (Object.keys(RENDERERS)));

		/**
		 * The conversion spec for one field descriptor.
		 *
		 * @param {FieldDescriptor} field - the field descriptor.
		 * @returns {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFieldSpec} the spec the shared form stages through.
		 */
		function specFor(field) {
			return RENDERERS[field.kind].spec(field);
		}

		/**
		 * The fixed dictionary, in English.
		 *
		 * These are the only keys of the page's dictionary that are not
		 * generated from the field table, so they are the only ones that can
		 * drift: delete one here and the page renders the key itself. They live
		 * at module scope, and are exported as `FIXED_DICTIONARY`, so the
		 * consistency gate can compare the two languages' key sets.
		 *
		 * @type {FixedDictionary}
		 */
		const FIXED_EN = {
			intro: "Changes are saved to this profile and take effect on the next tool call.",
			invalid: "Enter a positive whole number, or leave blank to use the default.",
			overridden: "Overridden",
			reset: "Reset to default",
			save: "Save",
			saving: "Saving…",
			discard: "Discard changes",
			pendingWrite: "Unsaved changes",
			writeBlocked: "One value is invalid; fix it before saving",
			writeFailed: "These values were not accepted, so they are still staged.",
			written: "Saved to this profile",
			readOnly: "This deployment stores settings read-only.",
			unavailable: "This plugin's settings are not served, so it cannot be configured right now.",
			loading: "Loading saved values…",
			toolsTitle: "Diagnostics and discovery",
			toolsHint:
				"The diagnostic runs the same checks as android_preflight in the app. Discovery refreshes the suggestions offered by the fields above.",
			runCheck: "Run diagnostic",
			checking: "Checking…",
			refresh: "Refresh devices and AVDs",
			refreshing: "Refreshing…",
			ready: "Android environment: ready.",
			notReady: "Android environment: not ready.",
			statusFailed: "The diagnostic request failed",
			inventoryFailed: "Discovery failed",
			detectedSdk: "Detected SDK root",
			installedImages: "Installed system images",
			none: "none found",
		};

		/**
		 * The fixed dictionary, in Chinese.
		 *
		 * The mirror of {@link FIXED_EN}: the two carry the same keys, and the
		 * consistency gate compares them.
		 *
		 * @type {FixedDictionary}
		 */
		const FIXED_ZH = {
			intro: "改动会写入当前 profile，并在下一次工具调用时生效。",
			invalid: "请填正整数；留空表示使用默认值。",
			overridden: "已覆盖",
			reset: "恢复默认",
			save: "保存",
			saving: "保存中…",
			discard: "放弃改动",
			pendingWrite: "有改动尚未保存",
			writeBlocked: "有取值不合法，修正后才能保存",
			writeFailed: "这批取值未被接受，仍保留在表单里。",
			written: "已保存到当前 profile",
			readOnly: "本部署的设置为只读。",
			unavailable: "该插件的设置当前未被服务，暂时无法配置。",
			loading: "正在读取已保存的值…",
			toolsTitle: "环境检测与探测",
			toolsHint: "检测按钮在应用内运行与 android_preflight 相同的检查；探测按钮刷新上方字段的下拉建议。",
			runCheck: "检测环境",
			checking: "检测中…",
			refresh: "刷新设备与 AVD",
			refreshing: "刷新中…",
			ready: "Android 环境：就绪。",
			notReady: "Android 环境：尚未就绪。",
			statusFailed: "检测请求失败",
			inventoryFailed: "探测失败",
			detectedSdk: "探测到的 SDK 根目录",
			installedImages: "已安装的系统镜像",
			none: "未发现",
		};

		/**
		 * The dictionary keys this page owns, generated from the metadata above.
		 *
		 * @returns {{zh: Dictionary, en: Dictionary}} the dictionaries the page renders from.
		 */
		function buildDictionaries() {
			/** @type {Dictionary} */
			const en = { ...FIXED_EN };
			/** @type {Dictionary} */
			const zh = { ...FIXED_ZH };
			for (const group of GROUPS) {
				en[`group.${group.id}`] = group.title.en;
				en[`group.${group.id}.hint`] = group.hint.en;
				zh[`group.${group.id}`] = group.title.zh;
				zh[`group.${group.id}.hint`] = group.hint.zh;
				for (const field of group.fields) {
					en[`field.${field.key}`] = field.label.en;
					en[`field.${field.key}.hint`] = field.hint.en;
					zh[`field.${field.key}`] = field.label.zh;
					zh[`field.${field.key}.hint`] = field.hint.zh;
					// Every declared option label gets an entry in both languages,
					// not only the empty one: a label without a dictionary entry
					// renders as its own key.
					for (const [value, label] of Object.entries(field.optionLabel ?? {})) {
						en[`field.${field.key}.option.${optionKey(value)}`] = label.en;
						zh[`field.${field.key}.option.${optionKey(value)}`] = label.zh;
					}
				}
			}
			return { zh, en };
		}

		/**
		 * The dictionary key one option label is stored under.
		 *
		 * The empty option keeps the key it has always had — `option.empty` —
		 * because the rendered text and the render test depend on it. Every
		 * other option value is percent-encoded and carries a `v` marker:
		 * encoding is injective on its own, but the literal value "empty" would
		 * encode to the very word the empty option reserves, and the marker
		 * keeps the two apart. The builder and the lookup both go through this
		 * function, so they cannot disagree about a value's key.
		 *
		 * @param {string} value - one option's value.
		 * @returns {string} the key suffix the label is stored under.
		 */
		function optionKey(value) {
			return value === "" ? "empty" : `v.${encodeURIComponent(value)}`;
		}

		/**
		 * The option list a select renders.
		 *
		 * A value persisted by an older version, or typed into the profile patch
		 * by hand, is kept visible rather than silently rendering as an empty
		 * selection: the user must be able to see what is stored in order to fix it.
		 *
		 * @param {FieldDescriptor} field - the field descriptor.
		 * @param {string} current - the value the field currently holds.
		 * @returns {string[]} the options to render.
		 */
		function selectOptions(field, current) {
			const options = field.options ?? [];
			if (current === undefined || current === "" || options.includes(current)) return options;
			return [...options, current];
		}

		/**
		 * Human-readable option label, honoring a per-field override map.
		 *
		 * A label for *any* option value is honored, not only the empty one: the
		 * lookup used to answer the empty option alone, so a per-field label
		 * for any other option was a silent no-op — and the dictionary had no
		 * entry for it either. Both halves are fixed now, and both go through
		 * {@link optionKey}, so a label always has the text it renders.
		 *
		 * @param {FieldDescriptor} field - the field descriptor.
		 * @param {string} value - the option value.
		 * @param {Translate} t - the page's dictionary lookup.
		 * @returns {string} the label to render.
		 */
		function optionLabel(field, value, t) {
			const labels = field.optionLabel;
			// `Object.hasOwn`, not a lookup: an option value spelled like an
			// `Object.prototype` member must not be mistaken for a label.
			if (labels === undefined || !Object.hasOwn(labels, value)) return value;
			return t(`field.${field.key}.option.${optionKey(value)}`);
		}

		/**
		 * What one field's control needs.
		 *
		 * @typedef {object} FieldProps
		 * @property {FieldDescriptor} field - the field descriptor.
		 * @property {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFieldState} state - the staged state.
		 * @property {boolean} disabled - whether the control refuses input.
		 * @property {(text: string) => void} onChange - stage draft text.
		 * @property {() => void} onReset - stage a clear.
		 * @property {Translate} t - the page's dictionary lookup.
		 * @property {string[]|undefined} [suggestions] - the values the control offers.
		 */

		/**
		 * What the control renderer needs for one field.
		 *
		 * @typedef {object} ControlInput
		 * @property {FieldDescriptor} field - the field descriptor.
		 * @property {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFieldState} state - the staged state.
		 * @property {boolean} disabled - whether the control refuses input.
		 * @property {string} id - the control's element id.
		 * @property {string} listId - the id of the datalist the control offers.
		 * @property {string[]} suggestions - the values the control offers.
		 * @property {(text: string) => void} onChange - stage draft text.
		 * @property {Translate} t - the page's dictionary lookup.
		 */

		/**
		 * One labelled control.
		 *
		 * The chrome (label, hint, invalid message, override badge, reset) is
		 * rebuilt here rather than borrowed from `SettingsValueField`, because
		 * that control only renders a single-line text input and this page needs
		 * selects, switches and textareas to share the same frame.
		 *
		 * @param {FieldProps} props - the field, its staged state and the two actions.
		 * @returns {import("react").ReactNode} the labelled control.
		 */
		function Field(props) {
			const { field, state, disabled, onChange, onReset, t } = props;
			const id = React.useId();
			const listId = `${id}-options`;
			const suggestions = props.suggestions ?? [];
			const control = renderControl({
				field,
				state,
				disabled,
				id,
				listId,
				suggestions,
				onChange,
				t,
			});
			return h(
				"div",
				{ className: "aemh_field" },
				h(
					"div",
					{ className: "aemh_fieldHead" },
					h("label", { className: "aemh_label", htmlFor: field.kind === "boolean" ? undefined : id }, t(`field.${field.key}`)),
					state.overridden ? h(P.Tag, { tone: "outline" }, t("overridden")) : null,
					state.overridden
						? h(
								"button",
								{ type: "button", className: "aemh_reset", onClick: onReset, disabled },
								t("reset"),
							)
						: null,
				),
				control,
				state.invalid
					? h("p", { className: "aemh_error", role: "status" }, t("invalid"))
					: h("p", { className: "aemh_hint" }, t(`field.${field.key}.hint`)),
			);
		}

		/**
		 * The control element for one field descriptor.
		 *
		 * @param {ControlInput} input - the field, its staged state and the control's wiring.
		 * @returns {import("react").ReactNode} the control.
		 */
		function renderControl(input) {
			return RENDERERS[input.field.kind].render(input);
		}

		/**
		 * The switch control for a `boolean` field.
		 *
		 * The switch is its own state indicator: a neighbouring "on"/"off" label
		 * would only repeat what the track already shows.
		 *
		 * @param {ControlInput} input - the field, its staged state and the control's wiring.
		 * @returns {import("react").ReactNode} the control.
		 */
		function renderSwitch(input) {
			const { field, state, disabled, onChange, t } = input;
			return h(P.Switch, {
				checked: state.text === "true",
				disabled,
				label: t(`field.${field.key}`),
				onChange: (next) => onChange(next ? "true" : "false"),
			});
		}

		/**
		 * The native select for a `select` field.
		 *
		 * The chevron is drawn by the wrapper: a native select cannot carry a
		 * pseudo-element of its own, and the CSS triangle follows the theme where a
		 * data-URI glyph could not.
		 *
		 * @param {ControlInput} input - the field, its staged state and the control's wiring.
		 * @returns {import("react").ReactNode} the control.
		 */
		function renderSelect(input) {
			const { field, state, disabled, id, onChange, t } = input;
			return h(
				"span",
				{ className: "aemh_selectWrap" },
				h(
					"select",
					{
						id,
						className: "aemh_control aemh_select",
						value: state.text,
						disabled,
						"aria-invalid": state.invalid ? "true" : undefined,
						onChange: (/** @type {import("react").ChangeEvent<HTMLSelectElement>} */ event) =>
							onChange(event.target.value),
					},
					selectOptions(field, state.text).map((value) =>
						h("option", { key: value === "" ? "__auto__" : value, value }, optionLabel(field, value, t)),
					),
				),
			);
		}

		/**
		 * The textarea for a `multiline` field.
		 *
		 * @param {ControlInput} input - the field, its staged state and the control's wiring.
		 * @returns {import("react").ReactNode} the control.
		 */
		function renderTextarea(input) {
			const { field, state, disabled, id, onChange } = input;
			return h("textarea", {
				id,
				className: "aemh_control",
				value: state.text,
				rows: 4,
				spellCheck: false,
				placeholder: field.placeholder,
				disabled,
				"aria-invalid": state.invalid ? "true" : undefined,
				onChange: (/** @type {import("react").ChangeEvent<HTMLTextAreaElement>} */ event) =>
					onChange(event.target.value),
			});
		}

		/**
		 * The single-line input shared by the `text` and `number` kinds.
		 *
		 * The two differ only in the input type, the input mode and the conversion
		 * spec; everything else — the datalist, the placeholder, the invalid state —
		 * is identical, so they share one renderer.
		 *
		 * @param {ControlInput} input - the field, its staged state and the control's wiring.
		 * @returns {import("react").ReactNode} the control.
		 */
		function renderTextInput(input) {
			const { field, state, disabled, id, listId, suggestions, onChange } = input;
			return h(
				React.Fragment,
				null,
				h("input", {
					id,
					className: "aemh_control",
					type: field.kind === "number" ? "number" : "text",
					inputMode: field.kind === "number" ? "numeric" : undefined,
					value: state.text,
					placeholder: field.placeholder,
					disabled,
					spellCheck: false,
					list: suggestions.length > 0 ? listId : undefined,
					"aria-invalid": state.invalid ? "true" : undefined,
					onChange: (/** @type {import("react").ChangeEvent<HTMLInputElement>} */ event) =>
						onChange(event.target.value),
				}),
				suggestions.length > 0
					? h(
							"datalist",
							{ id: listId },
							suggestions.map((value) => h("option", { key: value, value })),
						)
					: null,
			);
		}

		/**
		 * The action bar's state for one projection of the form.
		 *
		 * The bar is the only place a save starts, and it exists only while there is
		 * something to act on: a staged edit waiting to be written, a write in
		 * flight, or a failure worth retrying. A clean form answers `null`, which is
		 * what removes the bar from the page — nothing lingers in a hidden state.
		 *
		 * The shape is flat on purpose: the component below only maps it to
		 * elements, so every rule about what may be pressed lives here, in one place.
		 *
		 * @param {{dirty: boolean, invalid: boolean, saving: boolean, failed: boolean}} shell -
		 *   the form-level state the shared model publishes.
		 * @param {Translate} t - the page's dictionary lookup.
		 * @returns {{tone: string, message: string, canSave: boolean, canDiscard: boolean}|null}
		 *   the bar state, or `null` when the bar has nothing to say.
		 */
		function actionBarState(shell, t) {
			if (shell.failed) {
				return { tone: "error", message: t("writeFailed"), canDiscard: true, canSave: shell.dirty && !shell.invalid };
			}
			if (shell.saving) return { tone: "pending", message: t("saving"), canDiscard: false, canSave: false };
			if (!shell.dirty) return null;
			if (shell.invalid) return { tone: "error", message: t("writeBlocked"), canDiscard: true, canSave: false };
			return { tone: "pending", message: t("pendingWrite"), canDiscard: true, canSave: true };
		}

		/**
		 * What the action bar needs.
		 *
		 * @typedef {object} ActionBarProps
		 * @property {{tone: string, message: string, canSave: boolean, canDiscard: boolean}|null} view - the bar state, or nothing.
		 * @property {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFormShell} shell - the form-level state.
		 * @property {Translate} t - the page's dictionary lookup.
		 * @property {() => void} onDiscard - drop every staged edit.
		 * @property {() => void} onSave - write every staged edit.
		 */

		/**
		 * The action bar: the staged form's status plus the two ways out of it.
		 *
		 * A plain element at the end of the page column, kept on screen by the
		 * stylesheet while the page scrolls. Both buttons are the shared `Button`
		 * primitive and the leading mark is the shared `StateDot`, so what it looks
		 * like comes from the platform rather than from this page.
		 *
		 * @param {ActionBarProps} props - the bar state, the form shell and the two actions.
		 * @returns {import("react").ReactNode} the bar, or nothing while the form is clean.
		 */
		function ActionBar(props) {
			const { view, shell, t, onDiscard, onSave } = props;
			if (view === null) return null;
			const failed = view.tone === "error";
			return h(
				"div",
				{ className: failed ? "aemh_actions aemh_actionsError" : "aemh_actions" },
				h(P.StateDot, { state: failed ? "error" : "warning", size: 8 }),
				// The pill is as wide as its content, so a long failure message is
				// truncated; the title attribute keeps the whole sentence reachable.
				h(
					"p",
					{ className: "aemh_actionsText", role: "status", "aria-live": "polite", title: view.message },
					view.message,
				),
				h(
					P.Button,
					{ variant: "ghost", size: "sm", disabled: !view.canDiscard || shell.saving, onClick: onDiscard },
					t("discard"),
				),
				h(
					P.Button,
					{ variant: "primary", size: "sm", disabled: !view.canSave || shell.saving, onClick: onSave },
					shell.saving ? t("saving") : t("save"),
				),
			);
		}

		/**
		 * What the confirmation toast needs.
		 *
		 * @typedef {object} SavedToastProps
		 * @property {number} tick - the landed-write counter.
		 * @property {Translate} t - the page's dictionary lookup.
		 */

		/**
		 * The transient "written" confirmation.
		 *
		 * The shared `Toast` owns the hold, the fade and the teardown: it reports
		 * completion through `onDone`, which clears the sequence and unmounts it.
		 * Keying the toast by the sequence restarts the cycle when a later write
		 * lands, and a page that has never saved mounts nothing at all.
		 *
		 * @param {SavedToastProps} props - the landed-write counter and the dictionary lookup.
		 * @returns {import("react").ReactNode} the toast, or nothing.
		 */
		function SavedToast(props) {
			const { tick, t } = props;
			const [shown, setShown] = React.useState(0);
			React.useEffect(() => {
				if (tick > 0) setShown(tick);
			}, [tick]);
			if (shown === 0) return null;
			return h(P.Toast, { key: shown, tone: "success", text: t("written"), onDone: () => setShown(0) });
		}

		/**
		 * What the host's diagnostic route answers.
		 *
		 * @typedef {object} StatusReport
		 * @property {boolean} ok - whether the environment passed every check.
		 * @property {string} backend - the backend the diagnostic ran against.
		 * @property {Array<{name: string, ok: boolean, detail: string, fix?: string}>} checks - the checks it ran.
		 */

		/**
		 * What the host's discovery route answers.
		 *
		 * @typedef {object} InventoryReport
		 * @property {string|null} detectedSdkRoot - the SDK root it found, if any.
		 * @property {string[]} avds - the AVDs on this machine.
		 * @property {Array<{serial: string, state: string, kind: string, model?: string}>} devices - the devices it sees.
		 * @property {Array<{major: string, version: string, home: string}>} javaHomes - the JDKs it found.
		 * @property {string[]} systemImages - the installed system images.
		 * @property {string[]} platforms - the installed platform packages.
		 * @property {string[]} buildTools - the installed build-tools packages.
		 * @property {string} [avdsError] - why the AVD probe failed, when it did.
		 * @property {string} [devicesError] - why the device probe failed, when it did.
		 * @property {string} [installedError] - why the installed-package probe failed, when it did.
		 */

		/**
		 * The page's view of the form.
		 *
		 * The shared shell, plus what this half adds: the number of writes that
		 * landed, the namespace's status, and the state of every field.
		 *
		 * @typedef {object} FormProjection
		 * @property {boolean} available - whether the host serves the namespace.
		 * @property {boolean} writable - whether the host document accepts writes.
		 * @property {boolean} dirty - whether a save would write anything.
		 * @property {boolean} invalid - whether a staged draft blocks the save.
		 * @property {boolean} saving - whether a save is crossing the wire.
		 * @property {boolean} failed - whether the last save did not land.
		 * @property {number} savedCount - the writes that landed.
		 * @property {"loading"|"ready"|"unavailable"} status - the namespace's status.
		 * @property {Record<string, import("@deepseek-ai/dsh-client-ui-primitives").SettingsFieldState>} fields - every field's state.
		 */

		/**
		 * What the Plugins page injects into the form.
		 *
		 * @typedef {object} PluginConfigProps
		 * @property {<T>(selector: (snapshot: FormProjection) => T) => T} useAndroidEmulatorSettings - read the form's projection.
		 * @property {Translate} t - the page's dictionary lookup.
		 * @property {string} view - the view the page asks for.
		 * @property {(field: string, text: string) => void} edit - stage draft text.
		 * @property {(field: string) => void} resetField - stage a clear.
		 * @property {() => void} save - write every staged edit.
		 * @property {() => void} discard - drop every staged edit.
		 * @property {() => Promise<StatusReport>} loadStatus - read the diagnostic route.
		 * @property {() => Promise<InventoryReport>} loadInventory - read the discovery route.
		 */

		/**
		 * The suggestion lists the fields offer, built from one inventory answer.
		 *
		 * The names are the contract: a field's `suggest` names one of them, and
		 * the list is exported so the consistency gate can refuse a name this
		 * half does not provide. A mistyped name used to yield `undefined`, which
		 * became an empty list and silently dropped the datalist.
		 *
		 * @param {InventoryReport|undefined} data - the inventory the host served.
		 * @returns {Record<string, string[]>} one list per suggestion source.
		 */
		function buildSuggestions(data) {
			return {
				avds: data?.avds ?? [],
				javaMajors: unique((data?.javaHomes ?? []).map((item) => item.major).filter(Boolean)),
				deviceSerials: (data?.devices ?? []).map((item) => item.serial),
				apiLevels: unique([
					...(data?.platforms ?? []).map((id) => (id.split(";")[1] ?? "").replace(/^android-/, "")).filter(Boolean),
					...(data?.systemImages ?? [])
						.map((id) => (id.split(";")[1] ?? "").replace(/^android-/, ""))
						.filter(Boolean),
				]).sort((left, right) => Number(right) - Number(left)),
				buildTools: unique((data?.buildTools ?? []).map((id) => id.split(";")[1] ?? "").filter(Boolean)).sort(),
			};
		}

		/**
		 * The suggestion sources this half provides.
		 *
		 * Derived from the builder above, so the two cannot drift: a source the
		 * builder stops providing is a source the gate stops accepting.
		 */
		const SUGGEST_SOURCES = Object.freeze(Object.keys(buildSuggestions(undefined)));

		/**
		 * The plugin's parameter form, as the Plugins page asks for it.
		 *
		 * The page asks for `view: 'page'` only — `plugins.bundle.config` has no
		 * summary view, because the page already draws the plugin's title and
		 * description above this section. The form therefore contributes its
		 * groups, the diagnostics card and the save bar, and nothing that repeats
		 * the page's own chrome.
		 *
		 * @param {PluginConfigProps} props - the injected form face, the dictionary lookup and the view.
		 * @returns {import("react").ReactNode} the form.
		 */
		function PluginConfig(props) {
			const state = props.useAndroidEmulatorSettings((snapshot) => snapshot);
			const { t } = props;
			const diagnostics = useDiagnostics(props.loadStatus);
			const inventory = useInventory(props.loadInventory);

			const suggestions = buildSuggestions(inventory.data);

			// Leaving the page abandons staged edits, exactly as the harness's own
			// settings forms do: the controller outlives the page, so without this a
			// half-finished edit would still be staged on the next visit.
			const discard = React.useRef(props.discard);
			discard.current = props.discard;
			React.useEffect(() => () => discard.current(), []);

			const bar = actionBarState(state, t);

			if (!state.available) {
				return h(
					"div",
					{ className: "aemh_page" },
					h("p", { className: "aemh_intro", role: "status" }, t(state.status === "loading" ? "loading" : "unavailable")),
				);
			}

			return h(
				"div",
				{ className: "aemh_page" },
				h("p", { className: "aemh_intro" }, t("intro")),
				state.writable ? null : h("p", { className: "aemh_readOnly", role: "status" }, t("readOnly")),
				GROUPS.map((group) =>
					h(
						"section",
						{ className: "aemh_group", key: group.id },
						h(
							"div",
							{ className: "aemh_groupHead" },
							h("h3", { className: "aemh_groupTitle" }, t(`group.${group.id}`)),
						),
						h("p", { className: "aemh_groupHint" }, t(`group.${group.id}.hint`)),
						group.fields.map((field) =>
							h(Field, {
								key: field.key,
								field,
								// The projection carries every field the table declares, so
								// the lookup cannot miss; the index signature cannot
								// know that.
								state: /** @type {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFieldState} */ (
									state.fields[field.key]
								),
								disabled: !state.writable || state.saving,
								suggestions: field.suggest ? suggestions[field.suggest] : undefined,
								onChange: (/** @type {string} */ text) => props.edit(field.key, text),
								onReset: () => props.resetField(field.key),
								t,
							}),
						),
					),
				),
				h(
					"section",
					{ className: "aemh_group" },
					h("div", { className: "aemh_groupHead" }, h("h3", { className: "aemh_groupTitle" }, t("toolsTitle"))),
					h("p", { className: "aemh_groupHint" }, t("toolsHint")),
					h(
							"div",
							{ className: "aemh_toolRow" },
							h(
								P.Button,
								{
									variant: "outline",
									size: "sm",
									disabled: diagnostics.loading,
									onClick: () => void diagnostics.run(),
								},
								diagnostics.loading ? t("checking") : t("runCheck"),
							),
							h(
								P.Button,
								{
									variant: "outline",
									size: "sm",
									disabled: inventory.loading,
									onClick: () => void inventory.run(),
								},
								inventory.loading ? t("refreshing") : t("refresh"),
							),
						),
						renderDiagnostics(diagnostics, t),
						renderInventory(inventory, t),
					),
				h(ActionBar, { view: bar, shell: state, t, onDiscard: props.discard, onSave: props.save }),
				h(SavedToast, { tick: state.savedCount, t }),
			);
		}

		/**
		 * The diagnostic result list, or nothing before the first run.
		 *
		 * @param {RemoteState<StatusReport>} diagnostics - the diagnostic state.
		 * @param {Translate} t - the page's dictionary lookup.
		 * @returns {import("react").ReactNode} the list, or nothing.
		 */
		function renderDiagnostics(diagnostics, t) {
			if (diagnostics.error !== undefined) {
				return h(
					"p",
					{ className: "aemh_error", role: "status" },
					`${t("statusFailed")}: ${diagnostics.error}`,
				);
			}
			const report = diagnostics.data;
			if (report === undefined) return null;
			return h(
				"div",
				{ className: "aemh_group" },
				h(
					"div",
					{ className: "aemh_verdict" },
					h(P.StateDot, { state: report.ok ? "done" : "error" }),
					h("span", null, report.ok ? t("ready") : t("notReady")),
				),
				h(
					"ul",
					{ className: "aemh_checks" },
					report.checks.map((check) =>
						h(
							"li",
							{ className: "aemh_check", key: check.name },
							h(P.StateDot, { state: check.ok ? "done" : "error", size: 8 }),
							h(
								"div",
								{ className: "aemh_checkBody" },
								h("span", { className: "aemh_checkName" }, check.name),
								h("p", { className: "aemh_checkDetail" }, check.detail),
								check.ok || !check.fix ? null : h("p", { className: "aemh_checkFix" }, check.fix),
							),
						),
					),
				),
			);
		}

		/**
		 * The discovery summary, or nothing before the first run.
		 *
		 * @param {RemoteState<InventoryReport>} inventory - the discovery state.
		 * @param {Translate} t - the page's dictionary lookup.
		 * @returns {import("react").ReactNode} the summary, or nothing.
		 */
		function renderInventory(inventory, t) {
			if (inventory.error !== undefined) {
				return h("p", { className: "aemh_error", role: "status" }, `${t("inventoryFailed")}: ${inventory.error}`);
			}
			const data = inventory.data;
			if (data === undefined) return null;
			const images = data.systemImages ?? [];
			// Each probe is failure-tolerant on the Host: it answers with the list it
			// could read plus the reason it could not read another. Rendering only
			// the list would turn "the SDK directory could not be listed" into
			// "no system images are installed", which is a different claim.
			const errors = [data.avdsError, data.devicesError, data.installedError].filter(
				(/** @type {string|undefined} */ message) => typeof message === "string" && message.length > 0,
			);
			return h(
				"div",
				{ className: "aemh_group" },
				errors.length > 0
					? h(
							React.Fragment,
							null,
							errors.map((message) =>
								h(
									"p",
									{ className: "aemh_error", role: "status", key: message },
									`${t("inventoryFailed")}: ${message}`,
								),
							),
						)
					: null,
				h(
					"p",
					{ className: "aemh_checkDetail" },
					`${t("detectedSdk")}: ${data.detectedSdkRoot ?? t("none")}`,
				),
				data.installedError === undefined
					? h(
							"p",
							{ className: "aemh_checkDetail" },
							`${t("installedImages")} (${images.length}): ${images.length === 0 ? t("none") : images.join(", ")}`,
						)
					: null,
				data.devicesError === undefined && data.devices?.length
					? h(
							"p",
							{ className: "aemh_checkDetail" },
							data.devices.map((device) => `${device.serial}:${device.state}`).join(", "),
						)
					: null,
			);
		}

		/**
		 * The state one host route is read into.
		 *
		 * @template T
		 * @typedef {object} RemoteState
		 * @property {boolean} loading - whether a read is in flight.
		 * @property {T|undefined} data - the answer, once it landed.
		 * @property {string|undefined} error - the failure message, if it failed.
		 */

		/**
		 * Fetch-on-demand state for one host route.
		 *
		 * The loader is read through a ref so the returned `run` identity stays
		 * stable across renders: the injected face is rebuilt on every render,
		 * and a `run` that changed identity each time would defeat memoization
		 * deeper in the tree for no benefit.
		 *
		 * @template T
		 * @param {() => Promise<T>} get - the loader the route is read through.
		 * @returns {{loading: boolean, data: T|undefined, error: string|undefined, run: () => Promise<void>}}
		 *   the state and the runner that refreshes it.
		 */
		function useRemote(get) {
			const [state, setState] = React.useState(
				/** @type {RemoteState<T>} */ ({ loading: false, data: undefined, error: undefined }),
			);
			const latest = React.useRef(get);
			latest.current = get;
			const run = React.useCallback(async () => {
				setState({ loading: true, data: undefined, error: undefined });
				try {
					const data = await latest.current();
					setState({ loading: false, data, error: undefined });
				} catch (error) {
					setState({
						loading: false,
						data: undefined,
						error: String(/** @type {{message?: unknown}} */ (error)?.message ?? error),
					});
				}
			}, []);
			return { ...state, run };
		}

		/**
		 * The environment diagnostic behind the "检测环境" button.
		 *
		 * @param {() => Promise<StatusReport>} get - the status route loader.
		 * @returns {{loading: boolean, data: StatusReport|undefined, error: string|undefined, run: () => Promise<void>}}
		 *   the diagnostic state.
		 */
		function useDiagnostics(get) {
			return useRemote(get);
		}

		/**
		 * The machine inventory behind the "刷新设备与 AVD" button.
		 *
		 * @param {() => Promise<InventoryReport>} get - the inventory route loader.
		 * @returns {{loading: boolean, data: InventoryReport|undefined, error: string|undefined, run: () => Promise<void>}}
		 *   the inventory state.
		 */
		function useInventory(get) {
			return useRemote(get);
		}

		/**
		 * Order-preserving de-duplication for suggestion lists.
		 *
		 * @param {string[]} items - the values to de-duplicate.
		 * @returns {string[]} the distinct values, in first-seen order.
		 */
		function unique(items) {
			return [...new Set(items)];
		}

		/**
		 * Fetch one JSON host route, failing loudly on a non-2xx answer.
		 *
		 * @template T
		 * @param {string} url - the route to read.
		 * @returns {Promise<T>} the parsed body.
		 */
		async function fetchJson(url) {
			const response = await fetch(url, { headers: { accept: "application/json" } });
			const body = await response.json().catch(() => undefined);
			if (!response.ok) {
				throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
			}
			// A 2xx with a non-JSON body (an SPA fallback page or an empty answer)
			// must read as a failure, not as an empty result that leaves the card
			// silently blank.
			if (body === undefined) throw new Error(`${response.status} ${response.statusText}: the answer was not JSON`);
			return body;
		}

		/**
		 * The two reads of the shared form model this half needs.
		 *
		 * The shipped `SettingsFormModel` keeps `stored` and `sectionValue`
		 * private, but they are the only way to ask whether a draft would change
		 * anything — which is what the override badge and the dirty count need.
		 * They exist on the prototype, so the page reads them through this local
		 * view of the model.
		 *
		 * @typedef {object} FormModelReads
		 * @property {(field: string) => boolean} stored - whether the user layer carries the key.
		 * @property {(field: string) => unknown} sectionValue - the value the host serves for the field.
		 */

		/**
		 * The model's private reads, as this half sees them.
		 *
		 * @param {unknown} model - the shared form model.
		 * @returns {FormModelReads} the reads the page needs.
		 */
		function modelReads(model) {
			return /** @type {FormModelReads} */ (model);
		}

		/**
		 * Whether a draft would actually change anything.
		 *
		 * Mirrors `SettingsFormModel.plan()`: the shared model compares the draft
		 * TEXT with the formatted effective value, not the parsed values, and a
		 * reset (a staged clear) is a real write only while the user layer carries
		 * the key. Comparing parsed values instead hid the action bar for a draft
		 * the model would still write — e.g. a pasted value with surrounding
		 * whitespace — leaving no way to save or discard it.
		 *
		 * @param {FormModelReads} model - the form model's reads.
		 * @param {FieldDescriptor} field - the field descriptor.
		 * @param {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFieldState} state - the control's staged state.
		 * @returns {"noop"|"real"|"invalid"} `noop` when a save would change nothing,
		 *   `invalid` when the draft is not a value the field accepts.
		 */
		function draftDelta(model, field, state) {
			const spec = specFor(field);
			const write = spec.parse(state.text);
			if (write === undefined) return "invalid";
			// A reset stages a clear with the base value's text while `overridden`
			// is false; the model writes an unset for it only when the user layer
			// still carries the key.
			if (!state.overridden && model.stored(field.key)) return "real";
			return state.text === spec.format(model.sectionValue(field.key)) ? "noop" : "real";
		}

		/**
		 * The face the slot entry injects into the page.
		 *
		 * @typedef {object} InjectedFace
		 * @property {{androidEmulatorSettings: unknown}} hooks - the snapshot stores the page reads through.
		 * @property {(field: string, text: string) => void} edit - stage draft text.
		 * @property {(field: string) => void} resetField - stage a clear.
		 * @property {() => void} save - write every staged edit.
		 * @property {() => void} discard - drop every staged edit.
		 * @property {() => Promise<StatusReport>} loadStatus - read the diagnostic route.
		 * @property {() => Promise<InventoryReport>} loadInventory - read the discovery route.
		 */

		/**
		 * Own the page's staged form and the face its slot entry injects.
		 *
		 * Mirrors the pattern the shipped settings pages use: the model is built
		 * once per mount over the shared config form, the projection is published
		 * through a snapshot store so the component reads it with a selector, and
		 * disposal releases the subscription.
		 *
		 * @param {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFormScope<Record<string, unknown>>} scope -
		 *   the shared configuration form for this namespace.
		 */
		function Controller(scope) {
			this.scope = scope;
			this.model = new P.SettingsFormModel(
				scope,
				FIELDS.map((field) => specFor(field)),
			);
			/** Saves that landed; the page flashes its confirmation when this grows. */
			this.savedCount = 0;
			/** Whether a write was in flight at the last projection. */
			this.saveInFlight = false;
			this.store = this.model.bind(() => this.projection());
		}

		/**
		 * The page's view of the form.
		 *
		 * @returns {FormProjection} the projection the page reads.
		 */
		Controller.prototype.projection = function projection() {
			const shell = this.model.shell();
			// The primitive reports its state, not its outcome, so a save that landed
			// is observed as the transition out of "saving" with no failure and no
			// edits left staged. Counting it here keeps the page's confirmation free
			// of timers of its own.
			if (shell.saving) this.saveInFlight = true;
			else if (this.saveInFlight) {
				this.saveInFlight = false;
				if (!shell.failed && !shell.dirty) this.savedCount += 1;
			}
			/** @type {Record<string, import("@deepseek-ai/dsh-client-ui-primitives").SettingsFieldState>} */
			const fields = {};
			let changes = 0;
			for (const field of FIELDS) {
				const state = this.model.field(field.key);
				const delta = draftDelta(modelReads(this.model), field, state);
				if (delta !== "noop") changes += 1;
				fields[field.key] =
					delta === "noop" && state.overridden
						? { ...state, overridden: modelReads(this.model).stored(field.key) }
						: state;
			}
			return {
				...shell,
				// The model counts any staged draft as dirty, including one that would
				// write the value already in effect; the bar and the save button follow
				// this count instead, so reverting an edit really does clean the form.
				dirty: shell.dirty && changes > 0,
				savedCount: this.savedCount,
				status: this.scope.getSnapshot().status,
				fields,
			};
		};

		/**
		 * The face the slot entry injects.
		 *
		 * @returns {InjectedFace} the injected face.
		 */
		Controller.prototype.inject = function inject() {
			return {
				hooks: { androidEmulatorSettings: this.store },
				...this.model.actions(),
				loadStatus: () => fetchJson(STATUS_ROUTE),
				loadInventory: () => fetchJson(INVENTORY_ROUTE),
			};
		};

		Controller.prototype.dispose = function dispose() {
			this.model.dispose();
		};

		/** Required services: the slot registry, the dictionary, and the shared config forms. */
		const inject = ["slots", "locale", "configForms"];

		/**
		 * The browser plugin context this half is applied to.
		 *
		 * The bundle cannot import the shell's own types — it is a classic
		 * script whose `require` the shell resolves at run time — so the few
		 * services this half touches are described here.
		 *
		 * @typedef {object} BrowserContext
		 * @property {(callback: () => void | (() => void), key?: string) => void} effect - run an effect with its teardown.
		 * @property {{register: (ns: string, dictionaries: {zh: Dictionary, en: Dictionary}) => () => void}} locale - the dictionary registry.
		 * @property {{
		 *   get: (ns: string) => import("@deepseek-ai/dsh-client-ui-primitives").SettingsFormScope<Record<string, unknown>>,
		 *   whileServed: (namespaces: string[], register: (namespaces: Set<string>) => void) => () => void,
		 * }} configForms - the shared configuration forms.
		 * @property {{
		 *   inject: (name: string, callback: () => unknown) => unknown,
		 *   register: (
		 *     entry: {name: string, key: string, locale: string, inject: () => InjectedFace},
		 *     component: (props: PluginConfigProps) => import("react").ReactNode,
		 *   ) => () => void,
		 * }} slots - the slot registry.
		 */

		/**
		 * The slot and key this half registers into.
		 *
		 * The Plugins page keys a bundle's own configuration by the BUNDLE's npm
		 * package name, so the key must equal `package.json`'s name.
		 *
		 * The registration below reads THIS object rather than repeating the two
		 * literals, so the slot it registers into and the slot the gate checks
		 * cannot drift apart: renaming only the registration used to leave the
		 * exported surface — and therefore the gate — untouched and green while
		 * the page had silently moved somewhere nothing renders.
		 */
		const PLUGIN_SURFACE = Object.freeze({
			slot: "plugins.bundle.config",
			key: PACKAGE_NAME,
		});

		/**
		 * Mount the plugin's parameter form on the Plugins page.
		 *
		 * The slot is the page's own: it renders the entry inside the plugin
		 * detail, keyed by the bundle's package name, and only while the Host
		 * serves the settings namespace this form binds to.
		 *
		 * @param {BrowserContext} ctx - the browser plugin context.
		 */
		function apply(ctx) {
			const NS_T = LOCALE_NS;
			const dictionaries = buildDictionaries();
			ctx.effect(
				() => ctx.locale.register(NS_T, { zh: dictionaries.zh, en: dictionaries.en }),
				"android-emulator-helper: dictionaries",
			);

			const controller = new Controller(ctx.configForms.get(NS));
			ctx.effect(() => () => controller.dispose(), "android-emulator-helper: settings form");

			ctx.effect(() => {
				if (typeof document === "undefined") return () => {};
				if (document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_TAG)}]`) !== null) return () => {};
				const tag = document.createElement("style");
				tag.dataset.plugin = "@zhz8888/dsh-android-emulator-helper";
				tag.dataset.pluginCss = CSS_TAG;
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return () => {
					tag.remove();
				};
			}, "android-emulator-helper: form styles");

			ctx.effect(
				() =>
					ctx.configForms.whileServed([NS], () =>
						ctx.slots.inject(PLUGIN_SURFACE.slot, () =>
							ctx.slots.register(
								{
									name: PLUGIN_SURFACE.slot,
									key: PLUGIN_SURFACE.key,
									locale: NS_T,
									inject: () => controller.inject(),
								},
								PluginConfig,
							),
						),
					),
				"android-emulator-helper: plugin page",
			);
		}

		exports.NS = NS;
		/**
		 * The field table as this half sees it, complete.
		 *
		 * Exported for the drift check in `scripts/check-bundle.mjs` only: the
		 * browser cannot import the host's `lib/settings.js`, so the labels,
		 * hints and options are written twice and must be kept identical by
		 * construction. Exporting the *whole* descriptor rather than a projection
		 * is what lets the gate catch a reworded label, not just a renamed field.
		 * Nothing at runtime reads this.
		 */
		exports.FIELD_META = FIELDS.map((field) => ({
			key: field.key,
			kind: field.kind,
			suggest: field.suggest,
			options: field.options,
			label: field.label,
			hint: field.hint,
			placeholder: field.placeholder,
			optionLabel: field.optionLabel,
		}));
		/**
		 * The group table as this half sees it: the headings and hints the page
		 * renders around each card, plus the field keys each card holds.
		 *
		 * Also for the drift check. Nothing at runtime reads this.
		 */
		exports.GROUP_META = GROUPS.map((group) => ({
			id: group.id,
			title: group.title,
			hint: group.hint,
			fields: group.fields.map((field) => field.key),
		}));
		/**
		 * The slot and key this half registers into, exported for the drift check
		 * in `scripts/check-bundle.mjs`. The value is the `const` declared above
		 * `apply`, which the registration itself also reads.
		 */
		exports.PLUGIN_SURFACE = PLUGIN_SURFACE;
		/**
		 * The field kinds this half renders a control for.
		 *
		 * Exported for the drift check: both halves switch on the kind with a
		 * `default:` that falls through to a text input, so a kind only one side
		 * knows degrades into a text box holding a string. Nothing at runtime
		 * reads this.
		 */
		exports.FIELD_KINDS = FIELD_KINDS;
		/**
		 * The suggestion sources this half provides.
		 *
		 * A field's `suggest` names one of them, and a mistyped name used to
		 * yield `undefined`, which became an empty list and dropped the datalist
		 * without an error anywhere. Exported for the drift check; nothing at
		 * runtime reads this.
		 */
		exports.SUGGEST_SOURCES = SUGGEST_SOURCES;
		/**
		 * The two fixed dictionaries, without the generated keys.
		 *
		 * The group and field keys are generated symmetrically, but these are
		 * written by hand, so they are the ones that can drift apart: a key
		 * missing from one language renders as the key itself. Exported for the
		 * drift check; nothing at runtime reads this.
		 */
		exports.FIXED_DICTIONARY = { en: FIXED_EN, zh: FIXED_ZH };
		/**
		 * The complete dictionaries the page renders from.
		 *
		 * The option labels are generated per field from the `optionLabel` maps,
		 * so they are not in the fixed literals: a check that compared a
		 * declaration with itself would pass by construction, and the check has
		 * to read the dictionary the page actually renders from. Exported for the
		 * drift check; nothing at runtime reads this.
		 */
		exports.DICTIONARY = buildDictionaries();
		/**
		 * The two Fetch routes the page calls.
		 *
		 * Exported so the drift check compares the routes the page uses with the
		 * routes the host registers, instead of reading the values out of this
		 * file's source text. Nothing at runtime reads this.
		 */
		exports.ROUTES = Object.freeze({ status: STATUS_ROUTE, inventory: INVENTORY_ROUTE });
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
