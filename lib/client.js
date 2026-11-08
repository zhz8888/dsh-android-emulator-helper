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
		 * The form belongs to the plugin's one row, so it lives on that row's own
		 * page: the Plugins page renders it through its `plugins.row.config`
		 * keyed slot, and the row list gives the row a **Configure** control —
		 * the row's title, which is this plugin's name — that opens the page. The
		 * key is `<package name>#<row id>`: the package name is what the plugin
		 * manager's inventory compares against, and the row id is the profile
		 * patch row this plugin mounts, which is also the settings namespace.
		 *
		 * The page is therefore one click deeper than the bundle's own detail
		 * page: the bundle page lists the row, and the form appears only after
		 * that row is opened. `plugins.bundle.config` would have put the whole
		 * form inline on the bundle page instead, which is what this placement
		 * deliberately avoids — the bundle page keeps its description, its rows
		 * and its source, and the parameters get a page of their own.
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
		 * The package name the Plugins page keys a row's configuration by.
		 *
		 * `plugins.row.config` is a keyed slot and the page renders it with
		 * `entryKey: <package name>#<row id>`, so this string must equal
		 * `package.json`'s name exactly; the settings namespace above is the row
		 * id half of that key and never a substitute for the package name.
		 * `scripts/check-bundle.mjs` compares both halves.
		 */
		const PACKAGE_NAME = "@zhz8888/dsh-android-emulator-helper";
		/** Dictionary namespace owned by this page. */
		const LOCALE_NS = "settings.androidEmulatorHelper";
		/** Exact Fetch routes registered by the host half. */
		const STATUS_ROUTE = "/api/android-emulator-helper/status";
		const INVENTORY_ROUTE = "/api/android-emulator-helper/inventory";
		/**
		 * The global the host half injects this page's copy under.
		 *
		 * Every label, hint and placeholder lives in `locale/en.json` and
		 * `locale/zh.json`; the host half reads those two files and publishes
		 * them as a page-initialization global, so this half carries no copy of
		 * its own. A client bundle cannot read a file of its own package, and the
		 * package asset route admits images only — the index-injection table is
		 * the channel across, and unlike a Fetch route it is already in place
		 * before this bundle runs, so the first render is never a page of keys.
		 */
		const LOCALE_GLOBAL = "__DSH_ANDROID_EMULATOR_HELPER_LOCALE__";

		/** CSS ownership tag; the framework reclaims this on unload. */
		const CSS_TAG = "@zhz8888/dsh-android-emulator-helper/PluginPage.module.css";

		const CSS = [
			// Page frame. The row's page draws the title, the icon and the crumb, and
			// the bundle's page draws the package description, so this half
			// contributes the form only: one line saying when the edits take effect,
			// then one card per category — the card outline is what separates the
			// categories, so no rule is needed between them and each group reads as
			// one block. The metrics are read from the platform's own field kit —
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
			// A switch is a row: label and hint on the left, the track on the far
			// right. `margin-left:auto` pins every switch to the same right edge
			// even when the hint wraps, and `align-items:center` keeps the track
			// level with the label rather than with the wrapped hint below it.
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
			"textarea.aemh_control{height:auto;min-height:96px;padding:10px 12px;line-height:1.6;resize:vertical;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px}",
			".aemh_selectWrap{position:relative;display:block}",
			// One chevron for every control that offers a list: fixed selects, the
			// discovery dropdown and the suggestion-backed text inputs. A stroked
			// SVG path replaces the old CSS-border triangle, whose 5px solid wedge
			// read as a coarse arrow next to the theme's 1px-line icons.
			".aemh_chevron{position:absolute;right:12px;top:50%;width:14px;height:14px;transform:translateY(-50%);fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}",
			".aemh_selectWrap:hover .aemh_chevron{stroke:var(--dsw-alias-label-secondary)}",
			".aemh_selectWrap:focus-within .aemh_chevron{stroke:var(--dsw-alias-state-business-primary)}",
			".aemh_selectWrap:has(:disabled) .aemh_chevron{opacity:.5}",
			".aemh_select{appearance:none;cursor:pointer;padding-right:28px}",
			// A datalist input paints its own native picker arrow in Chromium;
			// hiding it leaves the shared chevron as the only affordance, so the
			// suggestion fields cannot end up with two arrows side by side.
			".aemh_hasSuggest{appearance:none;padding-right:28px}",
			".aemh_hasSuggest::-webkit-calendar-picker-indicator{display:none;opacity:0;pointer-events:none}",
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
		 * The control kinds this half can render.
		 *
		 * Declared as a literal union and then enforced twice against
		 * {@link RENDERERS}: `RENDERERS` is annotated `Record<FieldKind, …>`, so a
		 * key missing from the map is a type error, and `FIELD_KINDS` is derived
		 * from the map's own keys, so a key the map does not have cannot reach the
		 * gate. The two directions are what make "in the exported list" and
		 * "the page renders it" the same property.
		 *
		 * `select` and `discovery` are both dropdowns: a `select` offers the
		 * fixed `options` its descriptor carries, a `discovery` field offers
		 * whatever the discovery route answered for its `suggest` source.
		 *
		 * @typedef {"text" | "number" | "boolean" | "select" | "multiline" | "discovery"} FieldKind
		 */

		/**
		 * One field as this half describes it.
		 *
		 * The host owns the schema and the persistence; this descriptor only says
		 * how the page renders the field. `kind` picks the control, `suggest`
		 * names one of the discovery-backed suggestion lists — a datalist behind
		 * a text field, or the option list of a `discovery` dropdown — and
		 * `optionLabel` lists the option values that carry a readable label.
		 *
		 * No copy is written here. Every label, hint and placeholder is looked up
		 * in the dictionaries the host injects, by the key this descriptor
		 * implies: `field.<key>`, `field.<key>.hint`, `field.<key>.placeholder`
		 * and `field.<key>.option.<optionKey(value)>`.
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
		 * A working dictionary: one flat `key -> text` map per language.
		 *
		 * The keys are the ones `locale/en.json` and `locale/zh.json` declare under
		 * `settings`, published verbatim by the host half. Nothing in this file
		 * spells a key's text, so the two languages cannot drift apart here — they
		 * are the same file pair the host half reads.
		 *
		 * @typedef {Record<string, string>} Dictionary
		 */

		/**
		 * The dictionaries the page renders from, keyed by language.
		 *
		 * @typedef {{en: Dictionary, zh: Dictionary}} Dictionaries
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
				fields: [
					{ key: "sdkPath", kind: "text", placeholder: true },
					{ key: "jdkMajor", kind: "text", suggest: "javaMajors", placeholder: true },
					{ key: "buildToolsVersion", kind: "text", suggest: "buildTools", placeholder: true },
				],
			},
			{
				id: "emulator",
				fields: [
					{ key: "defaultAvd", kind: "discovery", suggest: "avds", placeholder: true },
					{ key: "defaultSerial", kind: "text", suggest: "deviceSerials", placeholder: true },
					{ key: "autoStartEmulator", kind: "boolean" },
					{ key: "emulatorArgs", kind: "multiline", placeholder: true },
					{ key: "bootTimeoutSeconds", kind: "number" },
				],
			},
			{
				id: "image",
				fields: [
					{ key: "apiLevel", kind: "text", suggest: "apiLevels", placeholder: true },
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
		 * the host schema accepts any number and the host's own projection falls
		 * back to the declared default for one that is not a positive integer, so
		 * a negative or fractional draft would be staged happily and then
		 * silently replaced by the default. Rejecting it here turns that into an
		 * inline message instead of a value that never took effect.
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
		 * which is why the two share a renderer and differ only in `spec`. The two
		 * dropdowns are separate renderers for the same reason: their option lists
		 * come from different places.
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
		 * The page-chrome dictionary keys, spelled out.
		 *
		 * Every other key the page looks up is derived from the group table —
		 * `group.<id>`, `field.<key>` and their `.hint` / `.placeholder` /
		 * `.option.<value>` variants — so those cannot be forgotten. These are
		 * the ones written by hand at their call sites, and a typo in one of
		 * them is a raw key on the page. Listing them here is what lets the
		 * consistency gate require an entry for each in both locale files.
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
		 * The dictionaries the page renders from, read from the injected global.
		 *
		 * Every string this page shows lives in `locale/en.json` and
		 * `locale/zh.json`, which the host half reads and publishes as a
		 * page-initialization global through `webserver/index-inject`. This half
		 * carries no copy of its own: a client bundle cannot read a file of its
		 * own package — the shell's module table answers seed modules and other
		 * bundles only, and the package asset route admits images only.
		 *
		 * The read is synchronous and happens once, at module scope, because the
		 * global is rendered into the document head ahead of this bundle. That is
		 * the whole point of the channel: the first render already has the copy,
		 * so the page never draws a raw key and needs no "the copy has arrived"
		 * repaint.
		 *
		 * A missing global is a deployment that renders no index through the
		 * harness' web server (a static shell, or a host that never mounted one).
		 * The page then renders its keys — visibly wrong rather than silently
		 * wrong — and the rest of the plugin keeps working.
		 *
		 * @type {Dictionaries}
		 */
		const DICTIONARIES = readInjectedDictionaries();

		/**
		 * Read the dictionaries the host injected into the page.
		 *
		 * The two languages are named literally rather than iterated: the
		 * dictionary object is typed by language, and a loop over strings would
		 * need an index signature that would also admit a language the plugin
		 * does not ship.
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
		 * The dictionary key one option label is stored under.
		 *
		 * The empty option keeps the key it has always had — `option.empty` —
		 * because the rendered text and the render test depend on it. Every
		 * other option value is percent-encoded and carries a `v` marker:
		 * encoding is injective on its own, but the literal value "empty" would
		 * encode to the very word the empty option reserves, and the marker
		 * keeps the two apart. The lookup goes through this function, and
		 * `scripts/check-bundle.mjs` holds the locale files to the same keys.
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
		 * Human-readable option label, honoring a per-field override list.
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
			// A switch reads as a row, not as a stacked control: its label and
			// hint stay on the left and the track sits on the right edge, so
			// every switch lines up on one column. Text inputs, selects and
			// textareas keep the full-width stacked frame, where a 100%-wide
			// control under its label is the natural reading order.
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
		 * The shared frame for every control that offers a list of values.
		 *
		 * Fixed selects, the discovery dropdown and suggestion-backed text
		 * inputs all render through here, so the chevron is one stroked SVG
		 * path in one place rather than a CSS triangle per renderer. The
		 * browser half is a classic script with no filesystem of its own, so
		 * the icon has to be inline rather than an imported asset.
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
		 * The switch control for a `boolean` field.
		 *
		 * `Field` places this in the row's right-hand column, so the track sits
		 * on the page's right edge. The switch is its own state indicator: a
		 * neighbouring "on"/"off" label would only repeat what the track shows.
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
		 * The dropdown for a `discovery` field.
		 *
		 * It shares the `select` frame and differs only in where the options come
		 * from: the descriptor carries no list, so the values are the ones the
		 * discovery route answered for the field's `suggest` source. A saved value
		 * the discovery did not return is still rendered — {@link discoveryOptions}
		 * appends it — so a profile written by hand, or one that names an AVD that
		 * has since been deleted, never shows a blank selection.
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
		 * The options a `discovery` dropdown offers, given what the host found.
		 *
		 * The discovered values keep the order the host served, so the AVDs read
		 * from disk and the emulator's own list do not reshuffle on every render.
		 * The current value is appended when discovery did not return it: a saved
		 * default that has since been deleted, or one named before the SDK was
		 * installed, must still appear in the control that holds it — a `<select>`
		 * whose value matches no option otherwise renders as nothing selected,
		 * which would also make the next save commit an empty value.
		 *
		 * Exported for the tests: this is the one part of the control that can be
		 * exercised without a browser, and the renderer calls this same function.
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
		 * The placeholder one field's control shows, or `undefined`.
		 *
		 * The descriptor only says *whether* a field has one — the text itself is
		 * a dictionary entry, like every other string on this page. A field
		 * without a placeholder must pass `undefined` rather than an empty
		 * string, because React renders `placeholder=""` as an attribute and the
		 * control then shows an empty hint box.
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
			const { field, state, disabled, id, listId, suggestions, onChange, t } = input;
			// The arrow follows the field's *declared* source, not the length of
			// the live suggestion list: before discovery answers, every list is
			// empty, and an arrow that appeared only afterwards would make the
			// form shift and leave the SDK group unstyled on first paint.
			const offersList = field.suggest !== undefined;
			const control = h("input", {
				id,
				className: offersList ? "aemh_control aemh_hasSuggest" : "aemh_control",
				type: field.kind === "number" ? "number" : "text",
				inputMode: field.kind === "number" ? "numeric" : undefined,
				value: state.text,
				placeholder: placeholderFor(field, t),
				disabled,
				spellCheck: false,
				list: offersList ? listId : undefined,
				"aria-invalid": state.invalid ? "true" : undefined,
				onChange: (/** @type {import("react").ChangeEvent<HTMLInputElement>} */ event) =>
					onChange(event.target.value),
			});
			const datalist = offersList
				? h(
						"datalist",
						{ id: listId },
						suggestions.map((value) => h("option", { key: value, value })),
					)
				: null;
			// A suggestion-backed input is a dropdown too, so it takes the same
			// frame and chevron as the selects. The datalist sits outside the
			// wrapper: it is a data element, not a child the chevron should be
			// positioned against.
			return offersList
				? h(React.Fragment, null, renderSelectWrap(control), datalist)
				: h(React.Fragment, null, control);
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
		 * The tick a page should flash its confirmation for.
		 *
		 * The counter is cumulative for the life of the page's controller, while the
		 * toast is mounted and unmounted with the page itself, so a page mounted
		 * after an earlier save already sees a non-zero counter — and that save was
		 * confirmed on the visit that made it. Only growth is a write to announce.
		 *
		 * Exported for the render suite: this rule lives in an effect, and a server
		 * render never runs one, so the rule itself is what the suite can assert.
		 *
		 * @param {number} consumed - the tick this page has already accounted for.
		 * @param {number} tick - the counter the projection publishes now.
		 * @returns {number} the tick to flash, or 0 for nothing.
		 */
		function savedToastTick(consumed, tick) {
			return typeof tick === "number" && tick > consumed ? tick : 0;
		}

		/**
		 * The transient "written" confirmation.
		 *
		 * The shared `Toast` owns the hold, the fade and the teardown: it reports
		 * completion through `onDone`, which clears the sequence and unmounts it.
		 * Keying the toast by the sequence restarts the cycle when a later write
		 * lands, and a page that has never saved mounts nothing at all. Mounting is
		 * not a save, so the counter's value at mount is taken as already accounted
		 * for: a second visit must not repeat the confirmation the first one gave.
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
		 * The page asks for `view: 'page'` on the row's own page, which is where
		 * the form lives; `view: 'summary'` is the one-line stand-in the row's
		 * detail page renders under its title when the row's package description
		 * is absent, and the row list never asks for it. The page form therefore
		 * contributes its groups, the diagnostics card and the save bar, and
		 * nothing that repeats the page's own chrome.
		 *
		 * @param {PluginConfigProps} props - the injected form face, the dictionary lookup and the view.
		 * @returns {import("react").ReactNode} the form.
		 */
		function PluginConfig(props) {
			// The copy is already in place: the host injects it into the document
			// head ahead of this bundle, so the first render is the real one and
			// there is nothing to subscribe to.
			// The summary view is a sentence, not a form: the row's page draws the
			// title and the crumb, and a summary that rendered the whole form would
			// put it in the description slot of the page that already holds it.
			if (props.view === "summary") return props.t("rowSummary");
			const state = props.useAndroidEmulatorSettings((snapshot) => snapshot);
			const { t } = props;
			const diagnostics = useDiagnostics(props.loadStatus);
			const inventory = useInventory(props.loadInventory);

			const suggestions = buildSuggestions(inventory.data);

			// The default AVD's dropdown is only as good as the discovery behind
			// it: an option list that stays empty until the user finds the refresh
			// button is not "the AVDs on this machine". Read the inventory once when
			// the page opens; the button re-runs the same read afterwards.
			React.useEffect(() => {
				void inventory.run();
			}, [inventory.run]);

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
			const avds = data.avds ?? [];
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
				// The AVD directory is what the host scanned, named next to the list so
				// "no AVDs" cannot be read as "the scan never ran".
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
		 * The two reads of the shared form this half needs.
		 *
		 * Both are public: `SettingsFormScopeSnapshot` declares `user` — the stored
		 * user layer, whose presence is what marks a field overridden — and `value`,
		 * the section the Host resolved. Reaching into the model's private
		 * `stored`/`sectionValue` instead was a dependency the type gate could not
		 * see (an `unknown` assertion), and a primitives release is free to break it.
		 *
		 * @typedef {object} FormModelReads
		 * @property {(field: string) => boolean} stored - whether the user layer carries the key.
		 * @property {(field: string) => unknown} sectionValue - the value the host serves for the field.
		 */

		/**
		 * Bind the two reads to one shared form scope.
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
		 * Whether a draft would actually change anything.
		 *
		 * Mirrors `SettingsFormModel.plan()`: the shared model compares the draft
		 * TEXT with the formatted effective value, not the parsed values, and a
		 * reset (a staged clear) is a real write only while the user layer carries
		 * the key. Comparing parsed values instead hid the action bar for a draft
		 * the model would still write — e.g. a pasted value with surrounding
		 * whitespace — leaving no way to save or discard it.
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
			// A reset stages a clear with the base value's text while `overridden`
			// is false; the model writes an unset for it only when the user layer
			// still carries the key.
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
		 * Own the page's staged form and the face its slot entry injects.
		 *
		 * Mirrors the pattern the shipped settings pages use: the model is built
		 * once per mount over the shared config form, the projection is published
		 * through a snapshot store so the component reads it with a selector, and
		 * disposal releases the subscription.
		 * The first projection happens here, so this constructor is the one place a
		 * failure can still become a readable page — `apply` catches it and registers
		 * the notice component below instead of letting the client half die.
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
			// Taking the first projection is the one step that depends on the shared
			// model's behaviour, so a model this half cannot read must release the scope
			// subscription before the failure propagates: `apply` turns it into the
			// degraded page instead of an unhandled throw.
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
		 * The slot and key this half registers into.
		 *
		 * The Plugins page keys a row's own configuration by
		 * `<package name>#<row id>`: the package name is the value the plugin
		 * manager's inventory compares against, and the row id is the profile
		 * patch row this plugin mounts — the same string as the settings
		 * namespace. Registering here is what gives that row a **Configure**
		 * control, so the form opens on a page of its own instead of being
		 * inlined on the bundle's detail page.
		 *
		 * The registration below reads THIS object rather than repeating the two
		 * literals, so the slot it registers into and the slot the gate checks
		 * cannot drift apart: renaming only the registration used to leave the
		 * exported surface — and therefore the gate — untouched and green while
		 * the page had silently moved somewhere nothing renders.
		 */
		const PLUGIN_SURFACE = Object.freeze({
			slot: "plugins.row.config",
			key: `${PACKAGE_NAME}#${NS}`,
		});

		/**
		 * The Settings surface this half registers into, when the page's own
		 * `showInSettings` switch asks for it.
		 *
		 * A section is registered by name and id, and the shell finds its icon by
		 * that same id: the two contributions are therefore declared here together,
		 * and both registrations read this object rather than repeating the
		 * literals, so the section, its icon and the switch that gates them cannot
		 * drift apart. `field` names the setting the registration is gated on; it
		 * is a browser-half preference, so the Host only persists it.
		 */
		const SETTINGS_SURFACE = Object.freeze({
			section: "settings.section",
			icon: "settings.section.icon",
			id: NS,
			order: 100,
			field: "showInSettings",
		});

		/**
		 * Whether the page's own switch asks for a Settings entry.
		 *
		 * The answer comes from the shared form's public snapshot — `value` is the
		 * section the Host resolved — rather than from anything the primitives
		 * model keeps private. The switch is a preference the Host stores without
		 * reading: it exists so a deployment can decide whether this page is
		 * configured on the plugin detail or in the Settings dialog as well.
		 *
		 * @param {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFormScope<Record<string, unknown>>} scope -
		 *   the shared configuration form for this namespace.
		 * @returns {boolean} whether the plugin's page should also be a Settings section.
		 */
		function settingsSectionVisible(scope) {
			return scope.getSnapshot().value?.[SETTINGS_SURFACE.field] === true;
		}

		/**
		 * The face a page with no form behind it still has to hand over.
		 *
		 * The renderer reads `face.hooks`; an empty object there is what "no hooks"
		 * looks like, and it keeps the member present for a renderer that reads it
		 * without falling back.
		 *
		 * @typedef {{hooks: Record<string, never>}} EmptyFace
		 */
		/** The face a page without a controller injects: no hooks, no actions. */
		const EMPTY_FACE = Object.freeze({ hooks: {} });

		/**
		 * The page a failed controller leaves behind.
		 *
		 * Nothing was written and no draft exists when the shared form could not be
		 * built, so the page says exactly that and offers no control it could not
		 * honour — the alternative is this plugin's whole page disappearing because
		 * one constructor threw.
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
		 * The Settings rail icon, published as a package asset.
		 *
		 * A client bundle cannot read its own package: the shell's `require`
		 * answers seed modules and other bundles only, and throws for a file of
		 * its own package. The sanctioned way through is a package asset — declare
		 * it in `package.json`'s `exports` as `./assets/*` and `require.asset`
		 * compiles `<package>/assets/<path>` into the URL this page's carrier can
		 * fetch. The Host resolves the file against this package's own manifest,
		 * so `exports` decides which files exist.
		 *
		 * A shell older than the asset route answers the empty string; the icon
		 * then draws nothing rather than throwing.
		 */
		const ANDROID_HEAD_ASSET = `plugins/${PACKAGE_NAME}/assets/android-head.svg`;
		const androidHeadUrl =
			typeof require.asset === "function" ? require.asset(ANDROID_HEAD_ASSET) : "";

		/**
		 * The Settings navigation icon: the supplied Android glyph, masked.
		 *
		 * The Settings dialog draws a section's `settings.section.icon`
		 * contribution in its navigation rail, handing it the item's size and
		 * whether that item is the active one. The artwork is its own file,
		 * `lib/assets/android-head.svg`: a bold-outline Android head whose second
		 * subpath knocks the face out and whose two dot eyes are filled back in.
		 *
		 * The rail paints the icon in the nav item's own colour, so the file is
		 * used as a mask over `currentColor` rather than as an `<img>`: an image
		 * freezes the file's own ink and disappears in whichever theme it does
		 * not match. A mask takes whatever colour the item resolves — normal,
		 * hovered or active — which is also why the active state needs no second
		 * artwork.
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
		 * Mount the plugin's parameter form on the Plugins page and, optionally, in Settings.
		 *
		 * The slot is the row's own: `plugins.row.config` renders the entry on the
		 * page its **Configure** control opens, keyed by
		 * `<package name>#<row id>`, and only while the Host serves the settings
		 * namespace this form binds to. The bundle's detail page therefore lists
		 * the row rather than carrying the form inline.
		 *
		 * The same form is also offered to the Settings dialog's navigation while
		 * the page's own `showInSettings` switch is on: the section and its icon
		 * are registered together and disposed together, so the second placement
		 * exists exactly while the saved value asks for it.
		 *
		 * @param {BrowserContext} ctx - the browser plugin context.
		 */
		function apply(ctx) {
			const NS_T = LOCALE_NS;
			// Registered once, already complete: the dictionaries were read from
			// the injected global at module scope, so there is no second
			// registration and no in-place fill to wait for.
			ctx.effect(
				() => ctx.locale.register(NS_T, { zh: DICTIONARIES.zh, en: DICTIONARIES.en }),
				"android-emulator-helper: dictionaries",
			);
			const t = ctx.locale.bind(NS_T);

			// Building the controller takes the first projection, which is where a
			// primitives release this half cannot read would throw. A throw here must not
			// take the plugin page down with it, so the failure is caught and the page is
			// registered with the notice component below instead.
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
						// The Settings entry is opt-in and live: the page's own switch decides
						// whether the plugin has a second place to be configured, and a save
						// republishes the namespace snapshot, so the entry appears and
						// disappears with the value instead of at the next reload.
						const scope = ctx.configForms.get(NS);
						/** @type {(() => void)|undefined} */
						let disposeSettings;
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
			fields: group.fields.map((field) => field.key),
		}));
		/**
		 * The slot and key this half registers into, exported for the drift check
		 * in `scripts/check-bundle.mjs`. The value is the `const` declared above
		 * `apply`, which the registration itself also reads.
		 */
		exports.PLUGIN_SURFACE = PLUGIN_SURFACE;
		/**
		 * The Settings surface, exported for the drift check in
		 * `scripts/check-bundle.mjs`: the gate compares the section and icon slots,
		 * the shared id, the order and the switch that gates them with the
		 * registration itself, which reads this same object.
		 */
		exports.SETTINGS_SURFACE = SETTINGS_SURFACE;
		/**
		 * Whether a shared form's live value asks for the Settings entry.
		 *
		 * Exported for the render suite: the decision is one predicate the page and
		 * the tests both read, so a test cannot pass while the page asks a
		 * different question. Nothing else reads the export.
		 */
		exports.SETTINGS_SECTION_VISIBLE = settingsSectionVisible;
		/**
		 * The line-art Android icon the Settings navigation shows.
		 *
		 * Exported for the render suite, which renders it directly and checks that
		 * the registered icon is this very component. Nothing at runtime reads the
		 * export, because the registration holds the component itself.
		 */
		exports.AndroidIcon = AndroidIcon;
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
		 * The option list the `discovery` dropdown builds from a discovered list.
		 *
		 * Exported so the tests can exercise the rule that keeps a saved value
		 * visible without a browser; the renderer calls this same function.
		 * Nothing else reads the export.
		 */
		exports.DISCOVERY_OPTIONS = discoveryOptions;
		/**
		 * Whether a landed-write counter should flash the confirmation.
		 *
		 * Exported for the render suite: the rule lives in an effect, which a server
		 * render never runs, so the rule itself is what the suite pins — a page mounted
		 * after an earlier save must not repeat that save's confirmation. Nothing at
		 * runtime reads this.
		 */
		exports.SAVED_TOAST_TICK = savedToastTick;
		/**
		 * The complete dictionaries the page renders from.
		 *
		 * Exported for the drift check in `scripts/check-bundle.mjs` and for the
		 * render suite: the page reads these from the injected global, so a test
		 * that wants the copy a real page shows has to install that global before
		 * the bundle is evaluated. The objects are the ones registered with the
		 * shell's locale service, so a reader sees exactly what the page renders
		 * from.
		 */
		exports.DICTIONARY = DICTIONARIES;
		/**
		 * The page-chrome dictionary keys this half looks up.
		 *
		 * The group and field keys are derived from the table above, so the gate
		 * can walk those itself; these are the ones written by hand at their call
		 * sites, and they are the ones that can go missing from a locale file
		 * without anything else noticing. Exported for the drift check; nothing
		 * at runtime reads this.
		 */
		exports.FIXED_KEYS = FIXED_KEYS;
		/**
		 * The global the host injects this page's copy under.
		 *
		 * Exported so the drift check compares the name the page reads with the
		 * name the host publishes, instead of reading the literal out of this
		 * file's source text. Nothing at runtime reads the export.
		 */
		exports.LOCALE_GLOBAL = LOCALE_GLOBAL;
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
