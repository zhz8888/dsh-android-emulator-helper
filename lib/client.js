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
		 * Browser half of this plugin: emulator parameters on the Plugins page.
		 *
		 * Renders through the row's `plugins.row.config` keyed slot
		 * (`<package name>#<row id>`), so the row's Configure control opens a
		 * page of its own rather than inlining the form on the bundle's detail
		 * page. Registers only while the host serves the settings namespace.
		 * Edits go through the shared config form; the diagnostics buttons call
		 * the host's Fetch routes.
		 *
		 * @module @zhz8888/dsh-android-emulator-helper/client
		 */

		/** Settings namespace = the profile entry id, spelled literally. */
		const NS = "android-emulator-helper";
		/**
		 * Package name for the Plugins page's keyed `plugins.row.config` slot
		 * (`<package name>#<row id>`); must equal `package.json`'s name.
		 */
		const PACKAGE_NAME = "@zhz8888/dsh-android-emulator-helper";
		/** Dictionary namespace owned by this page. */
		const LOCALE_NS = "settings.androidEmulatorHelper";
		/** Exact Fetch routes registered by the host half. */
		const STATUS_ROUTE = "/api/android-emulator-helper/status";
		const INVENTORY_ROUTE = "/api/android-emulator-helper/inventory";
		/**
		 * Global the host injects this page's copy under; injected before the
		 * bundle runs so the first render is never raw keys.
		 */
		const LOCALE_GLOBAL = "__DSH_ANDROID_EMULATOR_HELPER_LOCALE__";

		/** CSS ownership tag; the framework reclaims this on unload. */
		const CSS_TAG = "@zhz8888/dsh-android-emulator-helper/PluginPage.module.css";

		const CSS = [
			// Page frame: this half contributes only the form (intro line + one card
			// per category, separated by card outlines). Metrics come from the
			// platform's field kit so this form matches the built-in pages; the
			// denser 7px-per-field, 16px card gap is this page's own rhythm.
			".aemh_page{flex-direction:column;display:flex;max-width:100%;color:var(--dsw-alias-label-primary)}",
			".aemh_intro{margin:0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary)}",
			".aemh_readOnly{margin:12px 0 0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}",
			".aemh_group{margin-top:16px;padding:12px 16px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);flex-direction:column;display:flex}",
			".aemh_groupHead{align-items:baseline;gap:8px;display:flex}",
			".aemh_groupTitle{margin:0;font-size:14px;font-weight:600;line-height:1.5}",
			".aemh_groupHint{color:var(--dsw-alias-label-tertiary);margin:4px 0 0;font-size:12px;line-height:1.5}",
			// 7px above/below each field (14px between two); the card's padding
			// closes the last field so it never ends in a pocket of empty space.
			".aemh_field{flex-direction:column;gap:6px;display:flex;padding:7px 0;min-width:0}",
			".aemh_group>.aemh_field:last-child{padding-bottom:0}",
			".aemh_fieldHead{align-items:center;gap:8px;display:flex;min-width:0}",
			// Switch rows: `margin-left:auto` pins the track to one right edge even
			// when the hint wraps; `align-items:center` levels it with the label.
			".aemh_fieldRow{flex-direction:row;align-items:center;gap:16px}",
			".aemh_fieldRowText{flex:1 1 auto;flex-direction:column;gap:6px;min-width:0;display:flex}",
			".aemh_fieldRowControl{flex:none;align-items:center;display:flex;margin-left:auto}",
			".aemh_label{font-size:13px;font-weight:500;line-height:1.5}",
			".aemh_reset{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary);text-decoration:underline;cursor:pointer;background:none;border:0;padding:0}",
			".aemh_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
			".aemh_reset:disabled{cursor:default;opacity:.5}",
			".aemh_control{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);outline:none;padding:0 12px;font-size:13px;line-height:1.5;width:100%}",
			".aemh_control:focus-visible{border-color:var(--dsw-alias-state-business-primary)}",
			".aemh_control[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}",
			".aemh_control:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",
			// Number fields take the short width: a timeout is three digits, while a
			// path or device name needs the whole column.
			".aemh_short{max-width:200px}",
			"textarea.aemh_control{height:auto;min-height:96px;padding:10px 12px;line-height:1.6;resize:vertical;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px}",
			".aemh_selectWrap{position:relative;display:block}",
			// One stroked SVG chevron for every list control (fixed and discovery
			// selects); the old CSS-border triangle read as a coarse arrow.
			".aemh_chevron{position:absolute;right:12px;top:50%;width:14px;height:14px;transform:translateY(-50%);fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}",
			".aemh_selectWrap:hover .aemh_chevron{stroke:var(--dsw-alias-label-secondary)}",
			".aemh_selectWrap:focus-within .aemh_chevron{stroke:var(--dsw-alias-state-business-primary)}",
			".aemh_selectWrap:has(:disabled) .aemh_chevron{opacity:.5}",
			".aemh_select{appearance:none;cursor:pointer;padding-right:28px}",
			// Every paragraph states its own margin: the bundle cannot rely on a
			// bare-element reset, so without it the UA's `p { margin: 1em 0 }` shows
			// through (24px per hint; 2992px page vs 2440px tightened).
			".aemh_hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}",
			".aemh_error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.6}",
			// The button row is the only non-paragraph child, so it carries the gap
			// that paragraphs get from their margins.
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
			// A sticky, content-width pill: `position: sticky` keeps it at the bottom
			// of the in-flow column so it never covers a field or needs reserved room.
			".aemh_actions{position:sticky;bottom:16px;z-index:1;box-sizing:border-box;margin:20px auto 0;padding:6px 8px 6px 14px;width:max-content;max-width:min(560px,100%);border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-soft,0 4px 14px -6px rgba(0,0,0,.2));align-items:center;gap:8px;display:flex}",
			".aemh_actionsText{flex:0 1 auto;min-width:0;margin:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:1.5}",
			".aemh_actionsError .aemh_actionsText{color:var(--dsw-alias-state-error-primary)}",
		].join("");

		/**
		 * Control kinds this half renders. Kept in sync with {@link RENDERERS} twice:
		 * the map's `Record<FieldKind, …>` type and `FIELD_KINDS` derived from its
		 * keys. `select` offers fixed `options`; `discovery` offers the values the
		 * discovery route returned for the field's `suggest` source.
		 *
		 * @typedef {"text" | "number" | "boolean" | "select" | "multiline" | "discovery"} FieldKind
		 */

		/**
		 * Rendering-only field descriptor (the host owns schema and persistence).
		 * `kind` picks the control, `suggest` names a discovery-backed list,
		 * `optionLabel` lists option values with a readable label. All copy is
		 * looked up from the injected dictionaries via `field.<key>*` keys.
		 *
		 * @typedef {object} FieldDescriptor
		 * @property {string} key - the field name inside the settings section.
		 * @property {FieldKind} kind - the control the field renders as.
		 * @property {string} [suggest] - the suggestion source the field offers.
		 * @property {boolean} [placeholder] - whether the control shows a placeholder.
		 * @property {string[]} [options] - the values a select offers.
		 * @property {string[]} [optionLabel] - the option values that carry a label.
		 */

		/**
		 * One group of fields as this half describes it.
		 *
		 * @typedef {object} GroupDescriptor
		 * @property {string} id - the group id, which is part of its dictionary keys.
		 * @property {FieldDescriptor[]} fields - the fields the card holds.
		 */

		/**
		 * The dictionary lookup the page renders with.
		 *
		 * @typedef {(key: string, params?: Record<string, unknown>) => string} Translate
		 */

		/**
		 * One flat `key -> text` map per language, published verbatim from the
		 * locale files by the host; this half never spells a key's text.
		 *
		 * @typedef {Record<string, string>} Dictionary
		 */

		/**
		 * The dictionaries the page renders from, keyed by language.
		 *
		 * @typedef {{en: Dictionary, zh: Dictionary}} Dictionaries
		 */

		/**
		 * Field metadata mirrored from `lib/settings.js` (the bundle cannot import
		 * a host module); `key`, `kind` and `options` must match the host schema.
		 *
		 * @type {GroupDescriptor[]}
		 */
		const GROUPS = [
			{
				id: "sdk",
				fields: [
					{ key: "sdkPath", kind: "text", placeholder: true },
					{ key: "jdkMajor", kind: "discovery", suggest: "javaMajors" },
					{ key: "buildToolsVersion", kind: "discovery", suggest: "buildTools" },
				],
			},
			{
				id: "emulator",
				fields: [
					{ key: "defaultAvd", kind: "discovery", suggest: "avds", placeholder: true },
					{ key: "defaultSerial", kind: "text", placeholder: true },
					{ key: "autoStartEmulator", kind: "boolean" },
					{ key: "emulatorArgs", kind: "multiline", placeholder: true },
					{ key: "bootTimeoutSeconds", kind: "number" },
				],
			},
			{
				id: "image",
				fields: [
					{ key: "apiLevel", kind: "discovery", suggest: "apiLevels" },
					{ key: "systemImageVariant", kind: "select", options: ["default", "google_apis", "google_apis_playstore"] },
					{ key: "systemImageAbi", kind: "select", options: ["", "arm64-v8a", "x86_64", "x86", "armeabi-v7a"], optionLabel: [""] },
					{ key: "minSdk", kind: "number" },
				],
			},
			{
				id: "build",
				fields: [
					{ key: "buildTimeoutSeconds", kind: "number" },
					{ key: "gradleExtraArgs", kind: "multiline", placeholder: true },
				],
			},
			{
				id: "output",
				fields: [
					{ key: "dataDir", kind: "text", placeholder: true },
					{ key: "screenshotDir", kind: "text", placeholder: true },
					{ key: "logTailLines", kind: "number" },
				],
			},
			{
				id: "interface",
				fields: [
					{ key: "showInSettings", kind: "boolean" },
				],
			},
		];

		/** Flat field list, in declaration order. */
		const FIELDS = GROUPS.flatMap((group) => group.fields);

		/**
		 * Whole-value spec for selects: every non-empty draft is valid; an empty
		 * draft clears the override.
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
		 * Positive-integer spec: rejects a draft the host's projection would
		 * silently replace with the default.
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
		 * Per-kind staging spec and renderer; `FIELD_KINDS` is derived from its keys
		 * so the exported list matches what the page actually renders.
		 *
		 * @type {Record<FieldKind, {spec: (field: FieldDescriptor) => import("@deepseek-ai/dsh-client-ui-primitives").SettingsFieldSpec, render: (input: ControlInput) => import("react").ReactNode}>}
		 */
		const RENDERERS = {
			text: { spec: (field) => P.settingsTextField(field.key), render: renderTextInput },
			number: { spec: (field) => naturalField(field.key), render: renderTextInput },
			boolean: { spec: (field) => booleanField(field.key), render: renderSwitch },
			select: { spec: (field) => wholeValueField(field.key), render: renderSelect },
			discovery: { spec: (field) => wholeValueField(field.key), render: renderDiscoverySelect },
			multiline: { spec: (field) => P.settingsTextField(field.key), render: renderTextarea },
		};

		/**
		 * Kinds this half renders, derived from {@link RENDERERS} so the gate's list
		 * and the page's renderers cannot drift.
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
		 * Page-chrome dictionary keys written by hand at their call sites; the gate
		 * requires an entry for each in both locales. All other keys are derived
		 * from the group table.
		 *
		 * @type {readonly string[]}
		 */
		const FIXED_KEYS = Object.freeze([
			"intro",
			"invalid",
			"overridden",
			"reset",
			"save",
			"saving",
			"discard",
			"pendingWrite",
			"writeBlocked",
			"writeFailed",
			"written",
			"readOnly",
			"unavailable",
			"formFailed",
			"loading",
			"toolsTitle",
			"toolsHint",
			"runCheck",
			"checking",
			"refresh",
			"refreshing",
			"ready",
			"notReady",
			"statusFailed",
			"inventoryFailed",
			"detectedSdk",
			"avds",
			"avdDir",
			"installedImages",
			"none",
			"sectionNav",
			"rowSummary",
		]);

		/**
		 * Dictionaries read synchronously once from the injected global. A missing
		 * global renders raw keys (visibly wrong) while the plugin keeps working.
		 *
		 * @type {Dictionaries}
		 */
		const DICTIONARIES = readInjectedDictionaries();

		/**
		 * Read the host-injected dictionaries (`en`/`zh` named literally to keep
		 * the type exact), empty when nothing was injected.
		 *
		 * @returns {Dictionaries} the dictionaries, empty when nothing was injected.
		 */
		function readInjectedDictionaries() {
			/** @type {Dictionaries} */
			const dictionaries = { en: {}, zh: {} };
			/** @type {unknown} */
			let injected;
			try {
				injected = /** @type {Record<string, unknown>} */ (globalThis)[LOCALE_GLOBAL];
			} catch {
				// A realm that refuses the property read has nothing to offer.
				return dictionaries;
			}
			if (typeof injected !== "object" || injected === null) return dictionaries;
			for (const language of /** @type {const} */ (["en", "zh"])) {
				const dictionary = /** @type {Record<string, unknown>} */ (injected)[language];
				if (typeof dictionary !== "object" || dictionary === null) continue;
				for (const [key, value] of Object.entries(dictionary)) {
					if (typeof value === "string") dictionaries[language][key] = value;
				}
			}
			return dictionaries;
		}

		/**
		 * Key suffix for one option's label: `empty` for the empty option, else
		 * `v.<percent-encoded>` (the `v` marker keeps the literal "empty" apart).
		 *
		 * @param {string} value - one option's value.
		 * @returns {string} the key suffix the label is stored under.
		 */
		function optionKey(value) {
			return value === "" ? "empty" : `v.${encodeURIComponent(value)}`;
		}

		/**
		 * Options a select renders: declared options plus `current` when it is
		 * missing, so a stored value stays visible and can be fixed.
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
		 * Option label, honoring any per-field override list via {@link optionKey}.
		 *
		 * @param {FieldDescriptor} field - the field descriptor.
		 * @param {string} value - the option value.
		 * @param {Translate} t - the page's dictionary lookup.
		 * @returns {string} the label to render.
		 */
		function optionLabel(field, value, t) {
			const labels = field.optionLabel;
			// `includes`, not a lookup: the descriptor lists the values that carry
			// a label, and an option value spelled like an `Object.prototype`
			// member must not be mistaken for one.
			if (labels === undefined || !labels.includes(value)) return value;
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
		 * @property {string[]} suggestions - the values the control offers.
		 * @property {(text: string) => void} onChange - stage draft text.
		 * @property {Translate} t - the page's dictionary lookup.
		 */

		/**
		 * One labelled control and its chrome (shared by text, select, switch,
		 * textarea) rather than the single-line-only `SettingsValueField`.
		 *
		 * @param {FieldProps} props - the field, its staged state and the two actions.
		 * @returns {import("react").ReactNode} the labelled control.
		 */
		function Field(props) {
			const { field, state, disabled, onChange, onReset, t } = props;
			const id = React.useId();
			const suggestions = props.suggestions ?? [];
			const control = renderControl({
				field,
				state,
				disabled,
				id,
				suggestions,
				onChange,
				t,
			});
			const head = h(
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
			);
			const message = state.invalid
				? h("p", { className: "aemh_error", role: "status" }, t("invalid"))
				: h("p", { className: "aemh_hint" }, t(`field.${field.key}.hint`));
			// A switch is a row (label/hint left, track pinned right) so switches
			// line up; text/select/textarea keep the full-width stacked frame.
			if (field.kind === "boolean") {
				return h(
					"div",
					{ className: "aemh_field aemh_fieldRow" },
					h("div", { className: "aemh_fieldRowText" }, head, message),
					h("div", { className: "aemh_fieldRowControl" }, control),
				);
			}
			return h("div", { className: "aemh_field" }, head, control, message);
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
		 * Shared frame for every list control: one inline SVG chevron (a classic
		 * script cannot import an asset).
		 *
		 * @param {import("react").ReactNode} control - the input or select itself.
		 * @returns {import("react").ReactNode} the framed control.
		 */
		function renderSelectWrap(control) {
			return h(
				"span",
				{ className: "aemh_selectWrap" },
				control,
				h(
					"svg",
					{
						className: "aemh_chevron",
						viewBox: "0 0 16 16",
						"aria-hidden": "true",
						focusable: "false",
					},
					h("path", { d: "M4 6l4 4 4-4" }),
				),
			);
		}

		/**
		 * Switch for a `boolean` field; the track is its own state indicator, so
		 * no redundant "on"/"off" label is drawn.
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
		 * Native select for a `select` field; the wrapper draws the chevron (a
		 * native select cannot carry a pseudo-element).
		 *
		 * @param {ControlInput} input - the field, its staged state and the control's wiring.
		 * @returns {import("react").ReactNode} the control.
		 */
		function renderSelect(input) {
			const { field, state, disabled, id, onChange, t } = input;
			return renderSelectWrap(
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
		 * Dropdown for a `discovery` field: options come from the discovery route
		 * for the field's `suggest` source, with the saved value appended by
		 * {@link discoveryOptions} so a deleted AVD never shows a blank selection.
		 *
		 * @param {ControlInput} input - the field, its staged state and the control's wiring.
		 * @returns {import("react").ReactNode} the control.
		 */
		function renderDiscoverySelect(input) {
			const { field, state, disabled, id, suggestions, onChange, t } = input;
			return renderSelectWrap(
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
					discoveryOptions(state.text, suggestions).map((value) =>
						h("option", { key: value, value }, optionLabel(field, value, t)),
					),
				),
			);
		}

		/**
		 * Discovery dropdown options, host order preserved; append `current` when
		 * absent so a <select> never renders blank or commits an empty value.
		 *
		 * @param {string} current - the value the field currently holds.
		 * @param {string[]} suggestions - the values discovery returned.
		 * @returns {string[]} the options to render.
		 */
		function discoveryOptions(current, suggestions) {
			const options = unique(suggestions ?? []);
			if (current !== undefined && current !== "" && !options.includes(current)) options.push(current);
			return options;
		}

		/**
		 * Field's placeholder text, or `undefined` (passing `""` would render an
		 * empty hint box).
		 *
		 * @param {FieldDescriptor} field - the field descriptor.
		 * @param {Translate} t - the page's dictionary lookup.
		 * @returns {string | undefined} the placeholder text.
		 */
		function placeholderFor(field, t) {
			if (field.placeholder !== true) return undefined;
			return t(`field.${field.key}.placeholder`);
		}

		/**
		 * The textarea for a `multiline` field.
		 *
		 * @param {ControlInput} input - the field, its staged state and the control's wiring.
		 * @returns {import("react").ReactNode} the control.
		 */
		function renderTextarea(input) {
			const { field, state, disabled, id, onChange, t } = input;
			return h("textarea", {
				id,
				className: "aemh_control",
				value: state.text,
				rows: 4,
				spellCheck: false,
				placeholder: placeholderFor(field, t),
				disabled,
				"aria-invalid": state.invalid ? "true" : undefined,
				onChange: (/** @type {import("react").ChangeEvent<HTMLTextAreaElement>} */ event) =>
					onChange(event.target.value),
			});
		}

		/**
		 * Single-line input for `text`/`number` (differ only in type/inputMode;
		 * numbers take the short width); no chevron — dropdowns are real selects.
		 *
		 * @param {ControlInput} input - the field, its staged state and the control's wiring.
		 * @returns {import("react").ReactNode} the control.
		 */
		function renderTextInput(input) {
			const { field, state, disabled, id, onChange, t } = input;
			return h("input", {
				id,
				className: field.kind === "number" ? "aemh_control aemh_short" : "aemh_control",
				type: field.kind === "number" ? "number" : "text",
				inputMode: field.kind === "number" ? "numeric" : undefined,
				value: state.text,
				placeholder: placeholderFor(field, t),
				disabled,
				spellCheck: false,
				"aria-invalid": state.invalid ? "true" : undefined,
				onChange: (/** @type {import("react").ChangeEvent<HTMLInputElement>} */ event) =>
					onChange(event.target.value),
			});
		}

		/**
		 * Action bar state: `null` when the form is clean, otherwise tone/message
		 * and the save/discard permissions in one flat rule.
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
		 * Sticky action bar: status plus save/discard, built from the shared
		 * `Button` and `StateDot` primitives.
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
				// The pill hugs its content, so a long failure text is truncated;
				// the title attribute keeps the whole sentence reachable.
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
		 * Tick to flash (> `consumed`), or 0; only growth is a new write to announce.
		 *
		 * @param {number} consumed - the tick this page has already accounted for.
		 * @param {number} tick - the counter the projection publishes now.
		 * @returns {number} the tick to flash, or 0 for nothing.
		 */
		function savedToastTick(consumed, tick) {
			return typeof tick === "number" && tick > consumed ? tick : 0;
		}

		/**
		 * Transient "written" toast; keyed by the landed-write tick, with the
		 * mount-time counter treated as already confirmed.
		 *
		 * @param {SavedToastProps} props - the landed-write counter and the dictionary lookup.
		 * @returns {import("react").ReactNode} the toast, or nothing.
		 */
		function SavedToast(props) {
			const { tick, t } = props;
			const [shown, setShown] = React.useState(0);
			const consumed = React.useRef(tick);
			React.useEffect(() => {
				const next = savedToastTick(consumed.current, tick);
				if (next > consumed.current) consumed.current = next;
				if (next > 0) setShown(next);
			}, [tick]);
			if (shown === 0) return null;
			return h(P.Toast, { key: shown, tone: "success", text: t("written"), onDone: () => setShown(0) });
		}

		/**
		 * Host diagnostic route answer.
		 *
		 * @typedef {object} StatusReport
		 * @property {boolean} ok - whether every check passed.
		 * @property {string} backend - the backend the diagnostic ran against.
		 * @property {Array<{name: string, ok: boolean, detail: string, fix?: string}>} checks - the checks it ran.
		 */

		/**
		 * What the host's discovery route answers.
		 *
		 * @typedef {object} InventoryReport
		 * @property {string|null} detectedSdkRoot - the SDK root it found, if any.
		 * @property {string[]} avds - the AVDs on this machine.
		 * @property {string} [avdHome] - the AVD directory the host scanned for them.
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
		 * Page's view of the form: shared shell plus landed-write count, namespace
		 * status and every field's state.
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
		 * @property {string} view - the view the page asks for: `page` for the form, `summary` for the one-line stand-in.
		 * @property {() => void} [close] - the Settings shell's close handle; the page does not draw it.
		 * @property {(field: string, text: string) => void} edit - stage draft text.
		 * @property {(field: string) => void} resetField - stage a clear.
		 * @property {() => void} save - write every staged edit.
		 * @property {() => void} discard - drop every staged edit.
		 * @property {() => Promise<StatusReport>} loadStatus - read the diagnostic route.
		 * @property {() => Promise<InventoryReport>} loadInventory - read the discovery route.
		 */

		/**
		 * Build the named suggestion lists from one inventory answer; names are the
		 * field `suggest` contract checked by the gate.
		 *
		 * @param {InventoryReport|undefined} data - the inventory the host served.
		 * @returns {Record<string, string[]>} one list per suggestion source.
		 */
		function buildSuggestions(data) {
			return {
				avds: data?.avds ?? [],
				javaMajors: unique((data?.javaHomes ?? []).map((item) => item.major).filter(Boolean)),
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
		 * Suggestion source names, derived from {@link buildSuggestions} so the gate
		 * and the builder cannot drift.
		 */
		const SUGGEST_SOURCES = Object.freeze(Object.keys(buildSuggestions(undefined)));

		/**
		 * Live placements of the shared form; `discard()` runs only when the last
		 * one unmounts so the row page and Settings dialog share staged drafts.
		 *
		 * @type {number}
		 */
		let mountedPlacements = 0;

		/**
		 * The parameter form: `view: 'page'` draws groups, diagnostics and save bar;
		 * `view: 'summary'` renders one sentence for the row's description slot.
		 *
		 * @param {PluginConfigProps} props - the injected form face, the dictionary lookup and the view.
		 * @returns {import("react").ReactNode} the form.
		 */
		function PluginConfig(props) {
			// Copy is injected ahead of this bundle, so the first render is real;
			// `summary` is one sentence, not a second copy of the form.
			if (props.view === "summary") return props.t("rowSummary");
			const state = props.useAndroidEmulatorSettings((snapshot) => snapshot);
			const { t } = props;
			const diagnostics = useDiagnostics(props.loadStatus);
			const inventory = useInventory(props.loadInventory);

			const suggestions = buildSuggestions(inventory.data);

			// Read inventory on open so discovery-backed dropdowns are never empty
			// until the user finds refresh; the button re-runs the same read.
			React.useEffect(() => {
				void inventory.run();
			}, [inventory.run]);

			// Discard staged edits only when the last placement unmounts, so closing
			// Settings cannot throw away an edit staged on the page underneath.
			const discard = React.useRef(props.discard);
			discard.current = props.discard;
			React.useEffect(() => {
				mountedPlacements += 1;
				return () => {
					mountedPlacements -= 1;
					if (mountedPlacements === 0) discard.current();
				};
			}, []);

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
								// The projection carries every declared field; the cast only
								// satisfies the index signature.
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
			const avds = data.avds ?? [];
			// Render each probe's failure reason too: a list alone would turn "SDK
			// directory could not be listed" into "no images installed".
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
				// Name the scanned AVD directory beside the list so "no AVDs" is not
				// read as "the scan never ran".
				h("p", { className: "aemh_checkDetail" }, `${t("avdDir")}: ${data.avdHome ?? t("none")}`),
				h(
					"p",
					{ className: "aemh_checkDetail" },
					`${t("avds")} (${avds.length}): ${avds.length === 0 ? t("none") : avds.join(", ")}`,
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
		 * Fetch-on-demand state for one host route; the loader lives in a ref so
		 * `run` keeps a stable identity across renders.
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
				// The previous answer stays on screen while a refresh is in flight:
				// dropping it emptied every discovery dropdown until the route
				// answered, which reads as "this machine has no AVDs".
				setState((previous) => ({ loading: true, data: previous.data, error: undefined }));
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
		 * Fetch one JSON host route, failing loudly on a non-2xx or non-JSON answer.
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
			// A 2xx with a non-JSON body (SPA fallback / empty answer) is a failure,
			// not an empty result that leaves the card silently blank.
			if (body === undefined) throw new Error(`${response.status} ${response.statusText}: the answer was not JSON`);
			return body;
		}

		/**
		 * The two public shared-form reads used here (private model members are an
		 * unchecked dependency a primitives release could break).
		 *
		 * @typedef {object} FormModelReads
		 * @property {(field: string) => boolean} stored - whether the user layer carries the key.
		 * @property {(field: string) => unknown} sectionValue - the value the host serves for the field.
		 */

		/**
		 * Bind the two public reads to one shared form scope.
		 *
		 * @param {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFormScope<Record<string, unknown>>} scope - the shared configuration form.
		 * @returns {FormModelReads} the reads the page needs.
		 */
		function formReads(scope) {
			return {
				stored: (field) => {
					const user = scope.getSnapshot().user;
					return typeof user === "object" && user !== null && Object.hasOwn(user, field);
				},
				sectionValue: (field) => scope.getSnapshot().value?.[field],
			};
		}

		/**
		 * `noop`/`real`/`invalid` for a draft, mirroring `SettingsFormModel.plan()`
		 * (compares draft text with the formatted value, not parsed values).
		 *
		 * @param {FormModelReads} reads - the form's live reads.
		 * @param {FieldDescriptor} field - the field descriptor.
		 * @param {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFieldState} state - the control's staged state.
		 * @returns {"noop"|"real"|"invalid"} `noop` when a save would change nothing,
		 *   `invalid` when the draft is not a value the field accepts.
		 */
		function draftDelta(reads, field, state) {
			const spec = specFor(field);
			const write = spec.parse(state.text);
			if (write === undefined) return "invalid";
			// A reset stages a clear while `overridden` is false; it writes an unset
			// only when the user layer still carries the key.
			if (!state.overridden && reads.stored(field.key)) return "real";
			return state.text === spec.format(reads.sectionValue(field.key)) ? "noop" : "real";
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
		 * Owns the staged form and its injected face: builds the model once, publishes
		 * the projection through a snapshot store, releases it on dispose. The first
		 * projection happens here so `apply` can turn a failure into a notice page.
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
			// Release the scope subscription before a failed first projection throws;
			// `apply` then shows the degraded page instead of an unhandled throw.
			try {
				this.store = this.model.bind(() => this.projection());
			} catch (error) {
				this.model.dispose();
				throw error;
			}
		}

		/**
		 * The page's view of the form.
		 *
		 * @returns {FormProjection} the projection the page reads.
		 */
		Controller.prototype.projection = function projection() {
			const shell = this.model.shell();
			// A landed save is the transition out of "saving" with no failure/dirty;
			// counting it here keeps confirmation free of timers.
			if (shell.saving) this.saveInFlight = true;
			else if (this.saveInFlight) {
				this.saveInFlight = false;
				if (!shell.failed && !shell.dirty) this.savedCount += 1;
			}
			/** @type {Record<string, import("@deepseek-ai/dsh-client-ui-primitives").SettingsFieldState>} */
			const fields = {};
			const reads = formReads(this.scope);
			let changes = 0;
			for (const field of FIELDS) {
				const state = this.model.field(field.key);
				const delta = draftDelta(reads, field, state);
				if (delta !== "noop") changes += 1;
				fields[field.key] =
					delta === "noop" && state.overridden ? { ...state, overridden: reads.stored(field.key) } : state;
			}
			return {
				...shell,
				// Follow `changes`, not the model's dirty flag: a draft that writes the
				// same value must not keep the bar dirty after it is reverted.
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

		/** Release the shared form model on disposal. */
		Controller.prototype.dispose = function dispose() {
			this.model.dispose();
		};

		/** Required client services: slots, locale and shared config forms. */
		const inject = ["slots", "locale", "configForms"];

		/**
		 * Browser plugin context this half runs against; a classic script cannot
		 * import the shell's types, so the touched services are described here.
		 *
		 * @typedef {object} BrowserContext
		 * @property {(callback: () => void | (() => void), key?: string) => void} effect - run an effect with its teardown.
		 * @property {{warn: (message: string) => void}} [logger] - the client logger, when the shell provides one.
		 * @property {{
		 *   register: (ns: string, dictionaries: {zh: Dictionary, en: Dictionary}) => () => void,
		 *   bind: (ns: string) => Translate,
		 * }} locale - the dictionary registry.
		 * @property {{
		 *   get: (ns: string) => import("@deepseek-ai/dsh-client-ui-primitives").SettingsFormScope<Record<string, unknown>>,
		 *   whileServed: (namespaces: string[], register: (namespaces: Set<string>) => void) => () => void,
		 * }} configForms - the shared configuration forms.
		 * @property {{
		 *   inject: (name: string, callback: () => () => void) => () => void,
		 *   register: (
		 *     entry: {
		 *       name: string,
		 *       key?: string,
		 *       id?: string,
		 *       order?: number,
		 *       label?: string | (() => string),
		 *       locale?: string,
		 *       inject?: () => Partial<InjectedFace> | EmptyFace,
		 *     },
		 *     component: (props: PluginConfigProps & {size?: number, active?: boolean}) => import("react").ReactNode,
		 *   ) => () => void,
		 * }} slots - the slot registry.
		 */

		/**
		 * Row-page slot/key (`<package name>#<row id>`), read by both the
		 * registration and the gate so they cannot drift.
		 */
		const PLUGIN_SURFACE = Object.freeze({
			slot: "plugins.row.config",
			key: `${PACKAGE_NAME}#${NS}`,
		});

		/**
		 * Settings section/icon surface, gated by `showInSettings`. Section and
		 * icon share one id, and both registrations read this object so they cannot
		 * drift; the host only persists the switch.
		 */
		const SETTINGS_SURFACE = Object.freeze({
			section: "settings.section",
			icon: "settings.section.icon",
			id: NS,
			order: 100,
			field: "showInSettings",
		});

		/**
		 * Whether the `showInSettings` switch asks for a Settings entry, read from
		 * the shared form's public snapshot (the host stores but never reads it).
		 *
		 * @param {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFormScope<Record<string, unknown>>} scope -
		 *   the shared configuration form for this namespace.
		 * @returns {boolean} whether the plugin's page should also be a Settings section.
		 */
		function settingsSectionVisible(scope) {
			return scope.getSnapshot().value?.[SETTINGS_SURFACE.field] === true;
		}

		/**
		 * Face handed over when no controller exists: an empty `hooks` object that
		 * keeps the member present for renderers that read it.
		 *
		 * @typedef {{hooks: Record<string, never>}} EmptyFace
		 */
		/** The face a page without a controller injects: no hooks, no actions. */
		const EMPTY_FACE = Object.freeze({ hooks: {} });

		/**
		 * Notice page when the controller failed to build; no draft or controls, so
		 * one throw cannot take the whole plugin page down.
		 *
		 * @param {PluginConfigProps} props - the dictionary lookup; the rest of the face is absent.
		 * @returns {import("react").ReactNode} the notice.
		 */
		function PluginUnavailable(props) {
			return h(
				"div",
				{ className: "aemh_page" },
				h("p", { className: "aemh_intro", role: "status" }, props.t("formFailed")),
			);
		}

		/**
		 * Settings rail icon served via `require.asset` (a bundle cannot read its
		 * own package); older shells yield an empty URL and the icon draws nothing.
		 */
		const ANDROID_HEAD_ASSET = `plugins/${PACKAGE_NAME}/assets/android-head.svg`;
		const androidHeadUrl =
			typeof require.asset === "function" ? require.asset(ANDROID_HEAD_ASSET) : "";

		/**
		 * The Android glyph as a `currentColor` mask (not an `<img>`, so it works
		 * in every theme and needs no separate active-state artwork).
		 *
		 * @param {{size?: number, active?: boolean}} [props] - the shell's icon props.
		 * @returns {import("react").ReactNode} the masked Android head.
		 */
		function AndroidIcon(props) {
			const size = props?.size ?? 16;
			const mask = `url("${androidHeadUrl}") center / contain no-repeat`;
			return h("span", {
				"aria-hidden": "true",
				style: {
					display: "inline-block",
					width: size,
					height: size,
					backgroundColor: "currentColor",
					mask,
					WebkitMask: mask,
				},
			});
		}

		/**
		 * Mount the form into the Plugins row's slot and, while `showInSettings`
		 * is on, into a Settings section plus its icon; all disposed on unload.
		 *
		 * @param {BrowserContext} ctx - the browser plugin context.
		 */
		function apply(ctx) {
			const NS_T = LOCALE_NS;
			// Dictionaries were read complete at module scope; register once, no fill.
			ctx.effect(
				() => ctx.locale.register(NS_T, { zh: DICTIONARIES.zh, en: DICTIONARIES.en }),
				"android-emulator-helper: dictionaries",
			);
			const t = ctx.locale.bind(NS_T);

			// The first projection can throw on an unreadable primitives release;
			// catch it and register the notice page instead of killing the plugin.
			/** @type {Controller|undefined} */
			let controller;
			try {
				controller = new Controller(ctx.configForms.get(NS));
			} catch (error) {
				ctx.logger?.warn?.(
					`android-emulator-helper: the settings form could not be built: ${String(/** @type {{message?: unknown}} */ (error)?.message ?? error)}`,
				);
			}
			ctx.effect(() => () => controller?.dispose(), "android-emulator-helper: settings form");

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
					ctx.configForms.whileServed([NS], () => {
						/** @type {Array<() => void>} */
						const disposers = [
							ctx.slots.inject(PLUGIN_SURFACE.slot, () =>
								ctx.slots.register(
									{
										name: PLUGIN_SURFACE.slot,
										key: PLUGIN_SURFACE.key,
										locale: NS_T,
										inject: () => (controller === undefined ? EMPTY_FACE : controller.inject()),
									},
									controller === undefined ? PluginUnavailable : PluginConfig,
								),
							),
						];
						// Settings entry is live from the saved switch: it appears and
						// disappears with the value, without a reload.
						const scope = ctx.configForms.get(NS);
						/** @type {(() => void)|undefined} */
						let disposeSettings;
						/** Republish the Settings entries from the live `showInSettings` value. */
						const sync = () => {
							const wanted = settingsSectionVisible(scope);
							if (wanted === (disposeSettings !== undefined)) return;
							if (!wanted) {
								disposeSettings?.();
								disposeSettings = undefined;
								return;
							}
							const entries = [
								ctx.slots.inject(SETTINGS_SURFACE.icon, () =>
									ctx.slots.register({ name: SETTINGS_SURFACE.icon, id: SETTINGS_SURFACE.id }, AndroidIcon),
								),
								ctx.slots.inject(SETTINGS_SURFACE.section, () =>
									ctx.slots.register(
										{
											name: SETTINGS_SURFACE.section,
											id: SETTINGS_SURFACE.id,
											order: SETTINGS_SURFACE.order,
											label: () => t("sectionNav"),
											locale: NS_T,
											inject: () => (controller === undefined ? EMPTY_FACE : controller.inject()),
										},
										controller === undefined ? PluginUnavailable : PluginConfig,
									),
								),
							];
							disposeSettings = () => {
								for (const dispose of entries.reverse()) dispose();
							};
						};
						disposers.push(scope.subscribe(sync));
						disposers.push(() => {
							disposeSettings?.();
							disposeSettings = undefined;
						});
						sync();
						return () => {
							for (const dispose of disposers.reverse()) dispose();
						};
					}),
				"android-emulator-helper: plugin page",
			);
		}

		exports.NS = NS;
		/**
		 * Full field table, exported only for the drift gate; nothing reads it at
		 * runtime. The whole descriptor is exported so a reworded label is caught.
		 */
		exports.FIELD_META = FIELDS.map((field) => ({
			key: field.key,
			kind: field.kind,
			suggest: field.suggest,
			options: field.options,
			placeholder: field.placeholder,
			optionLabel: field.optionLabel,
		}));
		/**
		 * Group table (headings, hints and field keys), for the drift gate only.
		 */
		exports.GROUP_META = GROUPS.map((group) => ({
			id: group.id,
			fields: group.fields.map((field) => field.key),
		}));
		/**
		 * Row slot/key for the drift gate; the registration reads this same object.
		 */
		exports.PLUGIN_SURFACE = PLUGIN_SURFACE;
		/**
		 * Settings surface for the drift gate (slots, id, order, gating field),
		 * read by the registration too.
		 */
		exports.SETTINGS_SURFACE = SETTINGS_SURFACE;
		/**
		 * Settings-section predicate, shared by the page and the render suite;
		 * nothing else reads the export.
		 */
		exports.SETTINGS_SECTION_VISIBLE = settingsSectionVisible;
		/**
		 * Android icon component, exported for the render suite; the registration
		 * holds the component itself.
		 */
		exports.AndroidIcon = AndroidIcon;
		/**
		 * Rendered field kinds, exported for the drift gate; a kind only one side
		 * knows would degrade into a plain text box.
		 */
		exports.FIELD_KINDS = FIELD_KINDS;
		/**
		 * Suggestion sources, exported for the drift gate; a mistyped `suggest`
		 * name used to silently drop the datalist.
		 */
		exports.SUGGEST_SOURCES = SUGGEST_SOURCES;
		/**
		 * Discovery option builder, exported for the render suite; the renderer
		 * calls the same function.
		 */
		exports.DISCOVERY_OPTIONS = discoveryOptions;
		/**
		 * Confirmation-tick predicate, exported for the render suite so a page
		 * mounted after an earlier save does not repeat its confirmation.
		 */
		exports.SAVED_TOAST_TICK = savedToastTick;
		/**
		 * Dictionaries from the injected global, exported for the gate and render
		 * suite; these are the same objects registered with the shell's locale.
		 */
		exports.DICTIONARY = DICTIONARIES;
		/**
		 * Hand-written page-chrome keys, exported for the drift gate; the other
		 * keys are derived from the group/field table.
		 */
		exports.FIXED_KEYS = FIXED_KEYS;
		/**
		 * Locale global name, exported so the gate compares it with the host's
		 * published name.
		 */
		exports.LOCALE_GLOBAL = LOCALE_GLOBAL;
		/**
		 * Status/inventory routes, exported so the gate compares them with the
		 * host's registered routes.
		 */
		exports.ROUTES = Object.freeze({ status: STATUS_ROUTE, inventory: INVENTORY_ROUTE });
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
