# dsh-android-emulator-helper

**English** | [简体中文](README.zh-CN.md)

A DSH (DeepSeek Harness) port of the official ZCode `android-emulator@0.1.0`
plugin. All 23 tools keep their original names and argument names, and the
plugin adds a full **settings page** (Settings → Android emulator) so the SDK,
emulator, system-image, build and output parameters are configured in the app
instead of through environment variables.

## Contents

- [Install](#install)
- [Settings page](#settings-page)
- [Tools](#tools)
- [Skill and command](#skill-and-command)
- [Differences from the original](#differences-from-the-original)
- [Architecture](#architecture)
- [Development](#development)
- [Known limitations](#known-limitations)
- [License](#license)

## Install

### 1. Install dependencies

```bash
cd /path/to/dsh-android-emulator-helper
pnpm install                     # the @deepseek-ai/* peers + react for the tests
```

Every `@deepseek-ai/*` package this plugin imports — `cordis`, `dsh-tools` and
`schemastery` — is a **peer dependency the host provides**, not a dependency of
its own: the profile already carries them, and resolving them to the host's copy
keeps one `schemastery` instance behind the settings form. The local `pnpm
install` above installs them for development and tests only.

DSH's compatibility gate compares exactly the `@deepseek-ai/dsh*` peers against
the runtime version, so a mismatch refuses the install loudly. The ranges are
therefore lower-bound only (`>=0.2.0-rc.2`): an upper bound would have to be
widened by a new release on every harness bump, and a `^` range silently drops
the prereleases of the next version tuple.

### 2. Mount into a profile

**DSH Desktop**: the `desktop` profile is managed exclusively by the Electron
app — `dsh plugin --profile desktop` is refused by the CLI. Install through the
in-app plugin manager instead.

**CLI / any other profile**:

```bash
dsh plugin --profile <profile> add /absolute/path/to/dsh-android-emulator-helper
```

`dsh.bundle.patch` is declared, so DSH reconciles the package into
`dsh.profile.bundles` and merges `cordis.patch.yml` at boot. Do **not** also add
the same row to the profile's own `cordis.patch.yml`: a double mount registers
every tool name twice and fails the load.

### 3. Open the settings page

After a restart or hot reload, open **Settings → Android emulator**. The page
appears only while the host half actually serves the settings namespace, and
leaves no trace when it does not.

## Settings page

The settings namespace is the profile patch row id, `android-emulator-helper`.
The page reads and writes through `ctx.configForms`, so staged edits, dirty
detection, inline validation, optimistic-concurrency revisions and
"overridden / reset to default" all come from the harness.

| Group | Field | Kind | Default |
|---|---|---|---|
| SDK and toolchain | `sdkPath` | text | empty (auto-detect) |
| | `jdkMajor` | text, suggestions from this machine | `17` |
| | `buildToolsVersion` | text, suggestions | `35.0.0` |
| Emulator and devices | `defaultAvd` | text, suggestions | `medium_phone` |
| | `defaultSerial` | text, suggestions | empty |
| | `autoStartEmulator` | switch | on |
| | `emulatorArgs` | multiline, one argument per line | empty |
| | `bootTimeoutMs` | integer | `180000` |
| API and system image | `apiLevel` | text, suggestions | `35` |
| | `systemImageVariant` | select | `default` |
| | `systemImageAbi` | select (empty = host architecture) | auto |
| | `minSdk` | integer | `23` |
| Build | `buildTimeoutMs` | integer | `600000` |
| | `gradleExtraArgs` | multiline | empty |
| Output and logs | `dataDir` | text | `$DSH_HOME/android-emulator-helper` |
| | `screenshotDir` | text | `<data dir>/screenshots` |
| | `logTailLines` | integer | `500` |

Two buttons back the page with exact Fetch routes on the host half:

- **Run diagnostic** → `GET /api/android-emulator-helper/status`, the same
  checks as `android_preflight`, each with its detail and fix hint.
- **Refresh devices and AVDs** → `GET /api/android-emulator-helper/inventory`,
  detecting the SDK root, AVDs, connected devices, installed JDKs, system
  images, platforms and build-tools to populate the fields' suggestions.

The seven fields the original plugin exposed still fall back to their
`ANDROID_PLUGIN_*` environment variables, so an existing ZCode or CI setup keeps
working: the resolution order is settings page → environment variable →
declared default.

## Tools

`android_preflight`, `android_discover_project`, `android_create_app`,
`android_build_app`, `android_build_and_run`, `android_list_devices`,
`android_list_avds`, `android_start_emulator`, `android_stop_emulator`,
`android_create_avd`, `android_install_app`, `android_launch_app`,
`android_terminate_app`, `android_open_url`, `android_screenshot`,
`android_logs`, `android_ui_status`, `android_ui_describe`, `android_ui_resolve`,
`android_ui_tap`, `android_ui_swipe`, `android_ui_type_text`,
`android_ui_keyevent` — identical names and arguments to the original MCP
server.

`android_screenshot` always writes the PNG to disk and additionally submits it
to the host attachment store for a canonical image block. When the current model
does not declare image input, or the deployment stores no attachments, the
result degrades to text plus the file path rather than failing the call.

## Skill and command

- The bundled `android-dev` skill is registered through `ctx.skills.register()`
  with the skill directory as its `resourceBase`, so `INSTALL_ENVIRONMENT.md`
  keeps resolving. Its text is rewritten for DSH: no `mcp__…` prefixes,
  environment setup points at the settings page.
- `/android-dev [goal]` runs the diagnostic and reports the verdict, failures
  and fixes. DSH user commands deliberately create no model message, so the
  command does the one useful thing that needs no model.

## Differences from the original

| | Original (ZCode) | This port (DSH) |
|---|---|---|
| Tool exposure | stdio MCP server, `mcp__android_emulator__*` | native `ctx.tools.register()`, `android_*` |
| Configuration | `plugin.json` `userConfig` via `ANDROID_PLUGIN_*` | settings page + volatile `Config`; env vars still fall back |
| Working directory | `process.cwd()` | `exec.agent.session.header.cwd` (session workspace) |
| Data directory | `ANDROID_PLUGIN_DATA` / temp | `$DSH_HOME/android-emulator-helper`, configurable |
| Screenshot | MCP image content (base64) | host attachment reference; text fallback |
| Slash command | injects a model prompt | runs the diagnostic directly |
| Process execution | direct `node:child_process` | unchanged |

The direct `spawn` is a deliberate trade-off: `gradlew`, `adb` and `emulator`
behave byte-for-byte as they did in the original, and `adb exec-out` needs no
binary-stream adapter. The cost is bypassing DSH's subprocess seam — no managed
process ranges, env scrubbing, output spill or teardown termination. Every call
here has an explicit timeout and `SIGTERM`, and the plugin reads and forwards no
credential-bearing environment variables.

## Architecture

```
dsh-android-emulator-helper/
├── package.json            # dsh.bundle.patch, dsh.client, peer dependencies (the compatibility gate)
├── cordis.patch.yml        # - insert: [{ id: android-emulator-helper, name: 'dsh-android-emulator-helper' }]
├── lib/
│   ├── index.js            # host half: tools, skill, command and the two Fetch routes
│   ├── client.js           # browser half: a hand-written __ModuleLoader__ bundle, the settings page
│   ├── settings.js         # field declarations, the schemastery Config (every field .volatile()), live reads
│   ├── runtime.js          # one runtime per call: session cwd + live settings → data directory
│   ├── tools/index.js      # the 23 defineTool definitions, argument/result schemas, image admission
│   ├── providers/          # ported from the original plugin file by file, now taking an explicit runtime
│   └── util/               # process execution, paths, content blocks
├── skills/android-dev/     # SKILL.md + INSTALL_ENVIRONMENT.md
├── scripts/                # check-bundle.mjs (consistency gate), smoke.mjs (real-machine), verify-mount.mjs
└── test/                   # node:test unit and integration suites
```

Two constraints shape everything above:

1. **The settings namespace has exactly one source of truth**: the profile patch
   row id. The `id` in `cordis.patch.yml`, `SETTINGS_NAMESPACE` in
   `lib/settings.js` and the literal in `lib/client.js` must agree;
   `scripts/check-bundle.mjs` verifies them, and also that the host and client
   field tables have not drifted apart.
2. **A browser bundle cannot import a host module** — the client purity gate
   forbids cross-plugin value imports — so the field table is written twice and
   held together by that gate. The bundle may `require` only the shell's nine
   static modules (React, Cordis, `dsh-client-store`, `dsh-client-ui-slots`,
   `dsh-client-ui-primitives`, `dsh-client-ui-dockkit`, …).

## Development

```bash
pnpm install                 # the @deepseek-ai/* peers plus react/react-dom for the tests
pnpm test                    # 62 tests, no Android SDK needed
pnpm run check               # tests + host/client gate + real-Cordis mount
pnpm run verify:mount        # real Cordis Context and real ToolRuntime
pnpm run smoke               # read-only real-machine probes
pnpm run smoke:emulator      # also boot an AVD, screenshot, logs, stop
pnpm run link:dsh-deps       # offline dev: symlink a local DSH's @deepseek-ai packages
```

The package manager is pnpm: `packageManager` pins `pnpm@11.8.0`, and
`pnpm-lock.yaml` is the only lockfile (npm's `package-lock.json` is gone).
[`pnpm-workspace.yaml`](pnpm-workspace.yaml) does not open a workspace — this is a
single-package repository — it only carries the install-script policy:
`strictDepBuilds: true`. pnpm v10+ skips a dependency's build scripts *silently*
by default, which is the wrong failure mode here, so the strict mode makes
`pnpm install` fail immediately with `ERR_PNPM_IGNORED_BUILDS` and forces an
explicit per-package decision. The current tree (27 packages) was scanned and
contains no install-time build scripts, so no `allowBuilds` entry is needed.

Four layers of verification:

| Layer | Command | What it proves |
|---|---|---|
| Unit and parsers | `pnpm test` | Bundle load contract, manifest/patch contract, settings projection (live volatile reads, env fallback, out-of-range fallback), every ported parser, and the lossless-JSON projection |
| Settings page render | `pnpm test` | The whole page rendered with real React and `react-dom/server`: every group, field and dictionary key present, controlled inputs holding live values, switch and select state correct, override badge and reset, both route buttons and the save control |
| Consistency gate | `scripts/check-bundle.mjs` | Bundle id equals the package name, namespace equals the patch row id, the two field tables match key-for-key, both routes agree on both sides, and the bundle is still a classic script |
| Real host mount | `scripts/verify-mount.mjs` | Mounted on a **real** Cordis `Context` with the **real** `ToolRuntime`: 23 tools registered, four read-only tools dispatched through the registry and validated against their argument and result schemas, malformed arguments refused, unknown names unresolved, 17 volatile fields, full unregistration on dispose |

### Registry constraints that shape the tools

Two constraints come from the real tool registry and cannot be seen through a
hand-written test double:

- A result must match the tool's declared `output.schema`, so the two listing
  tools return `{ devices: [...] }` and `{ avds: [...] }` rather than a bare
  array, which the registry rejects as invalid output.
- A result must be lossless JSON, and the registry's snapshot rejects
  `undefined` outright. Every ported provider models an absent field as
  `undefined` — a device without a `model`, a UI node without `bounds`, a
  discovery report with no Gradle root — so `toLosslessJson()` normalizes the
  value on the single path every tool result travels, instead of 23 providers
  each handling it.

`docs/research/` documents the DSH plugin contracts this port depends on, with
line-level citations into the shipped packages. It is the closest thing to a
"DSH plugin development spec" that exists, because the application bundle ships
no developer documentation.

## Known limitations

- Linux is unsupported, exactly as in the original; `android_preflight` reports
  it.
- `android_start_emulator` always starts a new emulator and never reuses one.
  Pass `serial` to the other tools to reuse a target.
- `android_create_avd` always answers `no` to `avdmanager`'s confirmation, so it
  can never silently trigger a multi-gigabyte image download.
- The settings page's installed-image list comes from scanning the SDK
  directory, not from `sdkmanager --list_installed`, which fails in restricted
  environments and prefixes its output with deprecation notices.
- **The settings page has not been visually confirmed in the real GUI**: the
  delivery choice was source-only, so it was never installed into the `desktop`
  profile. Its render layer is covered by the server-render test above, but
  spacing, dark theme and narrow-width wrapping should be checked after
  installing.
- `@deepseek-ai/dsh-client-ui-primitives` publishes only `0.0.1-rc.1` on npm,
  which does not match the runtime API, so the render test uses a faithful double
  for the primitives while React and `react-dom/server` stay real.

## License

[MIT](LICENSE), copyright (c) 2026 zhz8888.

Tools and provider logic are ported from the ZCode official `android-emulator`
plugin (also MIT, copyright Z.ai); the Kotlin/Compose project template files are
kept verbatim. See the note at the end of [LICENSE](LICENSE) for the full
provenance.
