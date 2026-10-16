window.__ModuleLoader__.load({
	id: "dsh-android-emulator-helper",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const P = require("@deepseek-ai/dsh-client-ui-primitives");
		const h = React.createElement;

		/**
		 * Browser half of dsh-android-emulator-helper: the "Android emulator"
		 * settings section.
		 *
		 * The page is a whole navigation section rather than a tab, because the
		 * values it edits are the plugin's own emulator parameters and nothing
		 * else owns them. It registers only while the Host actually serves this
		 * plugin's settings namespace, so a deployment without the host half
		 * shows no trace of the page.
		 *
		 * Everything the user edits goes through the shared config form
		 * (`ctx.configForms.get`): staged edits, invalid-draft detection,
		 * optimistic-concurrency revisions and the write itself are the
		 * harness' behaviour, not reimplemented here. The two buttons at the
		 * bottom call the host half's exact Fetch routes.
		 *
		 * @module dsh-android-emulator-helper/client
		 */

		/** Settings namespace = the profile entry id, spelled literally. */
		const NS = "android-emulator-helper";
		/** Dictionary namespace owned by this page. */
		const LOCALE_NS = "settings.androidEmulatorHelper";
		/** Exact Fetch routes registered by the host half. */
		const STATUS_ROUTE = "/api/android-emulator-helper/status";
		const INVENTORY_ROUTE = "/api/android-emulator-helper/inventory";

		/** CSS ownership tag; the framework reclaims this on unload. */
		const CSS_TAG = "dsh-android-emulator-helper/Settings.module.css";

		const CSS = [
			".aemh_page{flex-direction:column;gap:20px;display:flex;max-width:760px;color:var(--dsw-alias-label-primary)}",
			".aemh_intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}",
			".aemh_group{flex-direction:column;gap:14px;display:flex}",
			".aemh_groupHead{flex-direction:column;gap:2px;display:flex}",
			".aemh_groupTitle{margin:0;font-size:15px;font-weight:600;line-height:22px}",
			".aemh_groupHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}",
			".aemh_field{flex-direction:column;gap:6px;display:flex;min-width:0}",
			".aemh_fieldHead{align-items:center;gap:8px;display:flex;min-width:0}",
			".aemh_label{font-size:13px;font-weight:500;line-height:20px}",
			".aemh_reset{font:inherit;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;padding:0;font-size:12px;line-height:18px;text-decoration:underline}",
			".aemh_reset:hover{color:var(--dsw-alias-label-primary)}",
			".aemh_control{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);height:36px;font:inherit;color:var(--dsw-alias-label-primary);outline:none;padding:0 12px;font-size:13px;width:100%;box-sizing:border-box}",
			".aemh_control:focus{border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-state-business-primary)}",
			".aemh_control[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary);box-shadow:none}",
			".aemh_control:disabled{opacity:.6;cursor:default}",
			"textarea.aemh_control{height:auto;min-height:84px;padding:8px 12px;line-height:20px;resize:vertical;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px}",
			".aemh_select{appearance:none;cursor:pointer;padding-right:30px;background-repeat:no-repeat;background-position:right 10px center;background-size:12px;background-image:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 14 14' fill='none'><path d='M3.5 5.5L7 9l3.5-3.5' stroke='%23888' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>\")}",
			".aemh_switchRow{align-items:center;gap:10px;display:flex}",
			".aemh_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}",
			".aemh_error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}",
			".aemh_tools{border-top:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:12px;padding-top:16px;display:flex}",
			".aemh_toolRow{flex-wrap:wrap;align-items:center;gap:10px;display:flex}",
			".aemh_checks{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}",
			".aemh_check{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:flex-start;gap:10px;padding:8px 0;display:flex}",
			".aemh_check:last-child{border-bottom:0}",
			".aemh_checkBody{flex-direction:column;gap:2px;min-width:0;flex:1;display:flex}",
			".aemh_checkName{font-size:13px;line-height:20px}",
			".aemh_checkDetail{color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;white-space:pre-wrap;margin:0;font-size:12px;line-height:18px}",
			".aemh_checkFix{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary));overflow-wrap:anywhere;margin:0;font-size:12px;line-height:18px}",
			".aemh_verdict{align-items:center;gap:8px;font-size:13px;line-height:20px;display:flex}",
			".aemh_note{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}",
			".aemh_mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);overflow-wrap:anywhere}",
		].join("");

		/**
		 * Field metadata, mirrored from `lib/settings.js`.
		 *
		 * The browser bundle cannot import a Host module (the client purity gate
		 * forbids cross-plugin value imports), so the descriptors are spelled
		 * here as well. `key`, `kind` and `options` must match the host schema:
		 * the host is what validates and persists, and the client only renders.
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
						placeholder: "/Users/me/Library/Android/sdk",
						label: { zh: "Android SDK 根目录", en: "Android SDK root" },
						hint: {
							zh: "留空时依次探测 ANDROID_HOME、ANDROID_SDK_ROOT 与常见安装路径。",
							en: "Empty falls back to ANDROID_HOME, ANDROID_SDK_ROOT, then the common install paths.",
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
							zh: "安装指引中引用的 Android SDK build-tools 版本。",
							en: "The Android SDK build-tools version named by the install guidance.",
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
						key: "bootTimeoutMs",
						kind: "number",
						label: { zh: "模拟器启动超时 (ms)", en: "Emulator boot timeout (ms)" },
						hint: {
							zh: "等待模拟器完成启动的最长时间，默认 180000。",
							en: "Longest wait for the emulator to finish booting; 180000 by default.",
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
							zh: "compileSdk 与系统镜像包名中的 API 级别。",
							en: "The API level used for compileSdk and the system-image package id.",
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
						key: "buildTimeoutMs",
						kind: "number",
						label: { zh: "Gradle 构建超时 (ms)", en: "Gradle build timeout (ms)" },
						hint: {
							zh: "一次 assemble 任务的最长运行时间，默认 600000。",
							en: "Longest runtime of one assemble task; 600000 by default.",
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
		 */
		function naturalField(field) {
			return {
				field,
				format: (value) => (typeof value === "number" ? String(value) : ""),
				parse: (text) => {
					const trimmed = text.trim();
					if (trimmed === "") return { kind: "clear" };
					if (!/^\d+$/.test(trimmed)) return undefined;
					return { kind: "set", value: Number(trimmed) };
				},
			};
		}

		/** A boolean field, staged as the literal `true`/`false` the switch renders. */
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

		/** The conversion spec for one field descriptor. */
		function specFor(field) {
			switch (field.kind) {
				case "number":
					return naturalField(field.key);
				case "boolean":
					return booleanField(field.key);
				case "select":
					return wholeValueField(field.key);
				case "multiline":
					return P.settingsTextField(field.key);
				default:
					return P.settingsTextField(field.key);
			}
		}

		/** The dictionary keys this page owns, generated from the metadata above. */
		function buildDictionaries() {
			const en = {
				nav: "Android emulator",
				intro:
					"Parameters for the android_* tools: which Android SDK and JDK to use, how an emulator starts, and where captures and build logs are written. Changes are saved to this profile and take effect on the next tool call.",
				invalid: "Enter a whole number, or leave blank to use the default.",
				overridden: "Overridden",
				reset: "Reset to default",
				save: "Save",
				saving: "Saving…",
				saveFailed: "The deployment did not accept these values; they were left for you to correct.",
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
			const zh = {
				nav: "Android 模拟器",
				intro:
					"android_* 工具的运行参数：使用哪个 Android SDK 与 JDK、模拟器如何启动、截图与构建日志写到哪里。保存后写入当前 profile，并在下一次工具调用时生效。",
				invalid: "请填整数；留空表示使用默认值。",
				overridden: "已覆盖",
				reset: "恢复默认",
				save: "保存",
				saving: "保存中…",
				saveFailed: "本部署没有接受这些值，已保留供你修改。",
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
					if (field.optionLabel?.[""]) {
						en[`field.${field.key}.option.empty`] = field.optionLabel[""].en;
						zh[`field.${field.key}.option.empty`] = field.optionLabel[""].zh;
					}
				}
			}
			return { zh, en };
		}

		/**
		 * The option list a select renders.
		 *
		 * A value persisted by an older version, or typed into the profile patch
		 * by hand, is kept visible rather than silently rendering as an empty
		 * selection: the user must be able to see what is stored in order to fix it.
		 */
		function selectOptions(field, current) {
			if (current === undefined || current === "" || field.options.includes(current)) return field.options;
			return [...field.options, current];
		}

		/** Human-readable option label, honoring a per-field override map. */
		function optionLabel(field, value, t) {
			if (value === "" && field.optionLabel?.[""]) {
				return t(`field.${field.key}.option.empty`);
			}
			return value;
		}

		/**
		 * One labelled control.
		 *
		 * The chrome (label, hint, invalid message, override badge, reset) is
		 * rebuilt here rather than borrowed from `SettingsValueField`, because
		 * that control only renders a single-line text input and this page needs
		 * selects, switches and textareas to share the same frame.
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

		/** The control element for one field descriptor. */
		function renderControl(input) {
			const { field, state, disabled, id, listId, suggestions, onChange, t } = input;
			switch (field.kind) {
				case "boolean":
					return h(
						"div",
						{ className: "aemh_switchRow" },
						h(P.Switch, {
							checked: state.text === "true",
							disabled,
							label: t(`field.${field.key}`),
							onChange: (next) => onChange(next ? "true" : "false"),
						}),
						h("span", { className: "aemh_hint" }, state.text === "true" ? "on" : "off"),
					);
				case "select":
					return h(
						"select",
						{
							id,
							className: "aemh_control aemh_select",
							value: state.text,
							disabled,
							"aria-invalid": state.invalid ? "true" : undefined,
							onChange: (event) => onChange(event.target.value),
						},
						selectOptions(field, state.text).map((value) =>
							h("option", { key: value === "" ? "__auto__" : value, value }, optionLabel(field, value, t)),
						),
					);
				case "multiline":
					return h("textarea", {
						id,
						className: "aemh_control",
						value: state.text,
						rows: 4,
						spellCheck: false,
						placeholder: field.placeholder,
						disabled,
						"aria-invalid": state.invalid ? "true" : undefined,
						onChange: (event) => onChange(event.target.value),
					});
				default:
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
							onChange: (event) => onChange(event.target.value),
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
		}

		/** The full settings page. */
		function SettingsPage(props) {
			const state = props.useAndroidEmulatorSettings((snapshot) => snapshot);
			const { t } = props;
			const diagnostics = useDiagnostics(props.loadStatus);
			const inventory = useInventory(props.loadInventory);

			const suggestions = {
				avds: inventory.data?.avds ?? [],
				javaMajors: (inventory.data?.javaHomes ?? []).map((item) => item.major).filter(Boolean),
				deviceSerials: (inventory.data?.devices ?? []).map((item) => item.serial),
				apiLevels: unique([
					...(inventory.data?.platforms ?? []).map((id) => (id.split(";")[1] ?? "").replace(/^android-/, "")).filter(Boolean),
					...(inventory.data?.systemImages ?? [])
						.map((id) => (id.split(";")[1] ?? "").replace(/^android-/, ""))
						.filter(Boolean),
				]).sort((left, right) => Number(right) - Number(left)),
				buildTools: unique((inventory.data?.buildTools ?? []).map((id) => id.split(";")[1] ?? "").filter(Boolean)).sort(),
			};

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
				h(
					P.SettingsForm,
					{
						state,
						labels: {
							unavailable: t("unavailable"),
							readOnly: t("readOnly"),
							saveFailed: t("saveFailed"),
							save: t("save"),
							saving: t("saving"),
						},
						onSave: props.save,
						onDiscard: props.discard,
					},
					GROUPS.map((group) =>
						h(
							"section",
							{ className: "aemh_group", key: group.id },
							h(
								"div",
								{ className: "aemh_groupHead" },
								h("h3", { className: "aemh_groupTitle" }, t(`group.${group.id}`)),
								h("p", { className: "aemh_groupHint" }, t(`group.${group.id}.hint`)),
							),
							group.fields.map((field) =>
								h(Field, {
									key: field.key,
									field,
									state: state.fields[field.key],
									disabled: !state.writable || state.saving,
									suggestions: field.suggest ? suggestions[field.suggest] : undefined,
									onChange: (text) => props.edit(field.key, text),
									onReset: () => props.resetField(field.key),
									t,
								}),
							),
						),
					),
					h(
						"section",
						{ className: "aemh_tools" },
						h("h3", { className: "aemh_groupTitle" }, t("toolsTitle")),
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
				),
			);
		}

		/** The diagnostic result list, or nothing before the first run. */
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

		/** The discovery summary, or nothing before the first run. */
		function renderInventory(inventory, t) {
			if (inventory.error !== undefined) {
				return h("p", { className: "aemh_error", role: "status" }, `${t("inventoryFailed")}: ${inventory.error}`);
			}
			const data = inventory.data;
			if (data === undefined) return null;
			const images = data.systemImages ?? [];
			return h(
				"div",
				{ className: "aemh_group" },
				h(
					"p",
					{ className: "aemh_checkDetail" },
					`${t("detectedSdk")}: ${data.detectedSdkRoot ?? t("none")}`,
				),
				h(
					"p",
					{ className: "aemh_checkDetail" },
					`${t("installedImages")} (${images.length}): ${images.length === 0 ? t("none") : images.join(", ")}`,
				),
				data.devices?.length
					? h(
							"p",
							{ className: "aemh_checkDetail" },
							data.devices.map((device) => `${device.serial}:${device.state}`).join(", "),
						)
					: null,
			);
		}

		/**
		 * Fetch-on-demand state for one host route.
		 *
		 * The loader is read through a ref so the returned `run` identity stays
		 * stable across renders: the injected face is rebuilt on every render,
		 * and a `run` that changed identity each time would defeat memoization
		 * deeper in the tree for no benefit.
		 */
		function useRemote(get) {
			const [state, setState] = React.useState({ loading: false, data: undefined, error: undefined });
			const latest = React.useRef(get);
			latest.current = get;
			const run = React.useCallback(async () => {
				setState({ loading: true, data: undefined, error: undefined });
				try {
					const data = await latest.current();
					setState({ loading: false, data, error: undefined });
				} catch (error) {
					setState({ loading: false, data: undefined, error: String(error?.message ?? error) });
				}
			}, []);
			return { ...state, run };
		}

		/** The environment diagnostic behind the "检测环境" button. */
		function useDiagnostics(get) {
			return useRemote(get);
		}

		/** The machine inventory behind the "刷新设备与 AVD" button. */
		function useInventory(get) {
			return useRemote(get);
		}

		/** Order-preserving de-duplication for suggestion lists. */
		function unique(items) {
			return [...new Set(items)];
		}

		/** Fetch one JSON host route, failing loudly on a non-2xx answer. */
		async function fetchJson(url) {
			const response = await fetch(url, { headers: { accept: "application/json" } });
			const body = await response.json().catch(() => undefined);
			if (!response.ok) {
				throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
			}
			return body;
		}

		/**
		 * Own the page's staged form and the face its slot entry injects.
		 *
		 * Mirrors the pattern the shipped settings pages use: the model is built
		 * once per mount over the shared config form, the projection is published
		 * through a snapshot store so the component reads it with a selector, and
		 * disposal releases the subscription.
		 */
		function Controller(scope) {
			this.scope = scope;
			this.model = new P.SettingsFormModel(
				scope,
				FIELDS.map((field) => specFor(field)),
			);
			this.store = this.model.bind(() => this.projection());
		}

		Controller.prototype.projection = function projection() {
			const shell = this.model.shell();
			const fields = {};
			for (const field of FIELDS) fields[field.key] = this.model.field(field.key);
			return { ...shell, status: this.scope.getSnapshot().status, fields };
		};

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
		 * Mount the Android emulator settings section.
		 *
		 * @param ctx - the browser plugin context.
		 */
		function apply(ctx) {
			const NS_T = LOCALE_NS;
			const t = ctx.locale.bind(NS_T);
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
				tag.dataset.plugin = "dsh-android-emulator-helper";
				tag.dataset.pluginCss = CSS_TAG;
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return () => {
					tag.remove();
				};
			}, "android-emulator-helper: settings styles");

			ctx.effect(
				() =>
					ctx.configForms.whileServed([NS], () =>
						ctx.slots.inject("settings.section", () =>
							ctx.slots.register(
								{
									name: "settings.section",
									id: "android-emulator",
									order: 16,
									label: () => t("nav"),
									locale: NS_T,
									inject: () => controller.inject(),
								},
								SettingsPage,
							),
						),
					),
				"android-emulator-helper: settings page",
			);
		}

		exports.NS = NS;
		/**
		 * Field descriptors as this half sees them.
		 *
		 * Exported for the drift check in `scripts/check-bundle.mjs` only: the
		 * browser cannot import the host's `lib/settings.js`, so the two field
		 * tables are written twice and must be kept identical by construction.
		 * Nothing at runtime reads this.
		 */
		exports.FIELD_META = FIELDS.map((field) => ({
			key: field.key,
			kind: field.kind,
			options: field.options,
		}));
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
