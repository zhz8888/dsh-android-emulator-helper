# AGENTS.md

Repository conventions for `@zhz8888/dsh-android-emulator-helper`. Read this
before changing anything.

## What this repository is

A DSH (DeepSeek Harness) plugin: a **host half** (`lib/index.js` and
`lib/providers/**`) that registers 23 `android_*` tools, one embedded skill, one
slash command and two configuration-page Fetch routes, plus a **client half**
(`lib/client.js`) that is a hand-written classic script rendering the plugin's
parameter page on the **Plugins page**. `lib/**` is committed on purpose — the
browser bundle is written, not generated.

## Commands

```bash
pnpm install                 # the peers, react/react-dom and the type toolchain
pnpm test                    # 185 tests: unit, settings projection, parsers, render, routes, gate checks
pnpm run check               # test + check-bundle + verify-mount + the type gate
pnpm run typecheck           # tsc --noEmit over the host half and the browser half
pnpm run verify:mount        # real Cordis Context + real ToolRuntime, all 23 tools dispatched
pnpm run smoke               # read-only real-machine probes
pnpm run smoke:emulator      # also boot an AVD, screenshot, logs, stop
pnpm run link:dsh-deps       # offline dev: symlink a local DSH's @deepseek-ai packages
```

`pnpm run check` must be green before any commit that touches `lib/`. It is the
only command that catches host↔client drift.

Anything needing an SDK, an emulator or Gradle is a `scripts/smoke.mjs` concern
and must never become a `pnpm test` requirement.

The local `pnpm install` exists for development, the test suite and the type
gate; installing the published package needs none of it. pnpm is the only
package manager the repository uses: `packageManager` pins `pnpm@11.8.0` and
`pnpm-lock.yaml` is the only lockfile (there is no `package-lock.json`).
`pnpm-workspace.yaml` does not open a workspace — this is a single-package
repository — it carries the install-script policy, `strictDepBuilds: true`: pnpm
v10+ skips a dependency's build scripts *silently* by default, which is the
wrong failure mode here, so strict mode fails `pnpm install` with
`ERR_PNPM_IGNORED_BUILDS` and forces an explicit per-package decision. The
current tree declares no install-time build scripts, so no `allowBuilds` entry is
needed.

## Repository map

```
dsh-android-emulator-helper/
├── package.json            # dsh.bundle.patch, dsh.client, peer dependencies (the compatibility gate)
├── tsconfig.json           # the host half's type gate: checkJs, noEmit, types: ["node"]
├── tsconfig.client.json    # the browser half's type gate: checkJs, noEmit, lib ES2023+DOM, types: []
├── cordis.patch.yml        # - insert: [{ id: android-emulator-helper, name: '@zhz8888/dsh-android-emulator-helper' }]
├── android-emulator.png    # plugin icon: ZCode's artwork, pale tile keyed out, 192 px
├── screenshots.json        # the four preview images a plugin market shows, in scroll order
├── locale/en.json          # plugin-page name and description (English; its presence is what enables every other language)
├── locale/zh.json          # the Simplified Chinese pair
├── lib/
│   ├── index.js            # host half: tools, skill, command and the two Fetch routes
│   ├── client.js           # browser half: a hand-written __ModuleLoader__ bundle, the plugin's page in the Plugins panel
│   ├── settings.js         # field declarations, the schemastery Config (every field .volatile()), live reads
│   ├── runtime.js          # one runtime per call: session cwd + live settings → data directory
│   ├── tools/index.js      # the 23 defineTool definitions, argument/result schemas, image admission
│   ├── providers/          # ported from the original plugin file by file, now taking an explicit runtime
│   └── util/               # process execution, paths, content blocks
├── skills/android-dev/     # SKILL.md + INSTALL_ENVIRONMENT.md
├── scripts/                # check-bundle.mjs (consistency gate), smoke.mjs (real-machine), verify-mount.mjs
├── types/                  # client-globals.d.ts: window.__ModuleLoader__ and the shell's run-time require
├── assets/                 # the four settings-page screenshots `screenshots.json` names
└── test/                   # node:test unit and integration suites
```

Four constraints shape that layout:

1. **The settings namespace has exactly one source of truth**: the profile patch
   row id. The `id` in `cordis.patch.yml`, `SETTINGS_NAMESPACE` in
   `lib/settings.js` and the literal in `lib/client.js` must agree;
   `scripts/check-bundle.mjs` verifies them, and also that the host and client
   field tables have not drifted apart.
2. **The browser half cannot reach the host half**: the host half is Node ESM
   running inside the host process, so it does not exist in the browser realm
   for the bundle to import. The field table is therefore written twice and
   held together by `scripts/check-bundle.mjs`. What the bundle may `require`
   is decided at run time by the shell's module table, which answers a platform
   seed word, an already-materialized module or another plugin's registered
   client bundle and throws for anything else. The seed table has eleven
   entries: `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`,
   `@deepseek-ai/cordis`, `zod`, `@tanstack/react-virtual`,
   `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`,
   `@deepseek-ai/dsh-client-ui-primitives` and
   `@deepseek-ai/dsh-client-ui-dockkit`.
3. **The plugin-page name is a package resource, not a manifest field**: DSH
   resolves `<package>/locale/en.json` through the `exports` map, so
   `./locale/*.json` has to stay exported and `locale` has to stay in `files`;
   either omission degrades silently to showing the raw package name. `en.json`
   is also the switch that enables every other language file, so it cannot be
   dropped in favour of `zh.json`.
4. **A plugin's own configuration belongs on the Plugins page**: DSH 0.2.x
   expects a plugin that owns a page to register it into the Plugins page's
   `plugins.bundle.config` keyed slot. `settings.section` still exists and still
   renders third-party entries, but registering there as well would give the
   plugin two configuration pages — one in the Settings dialog and one on its
   plugin detail — which is exactly what this migration removed. The slot is
   keyed by the **BUNDLE's package name** — a different string from the settings
   namespace — and the page renders the entry inside the plugin detail, between
   the package description and the component rows. The browser half exports
   `PLUGIN_SURFACE` so `scripts/check-bundle.mjs` can pin the slot and the key
   against `package.json`.

## The two halves share a contract, not code

The client bundle cannot import `lib/settings.js`: the host half is Node ESM
running inside the host process, so it is not in the browser realm to be
imported. The field table, the group table and every label, hint and
placeholder are therefore written **twice**. `scripts/check-bundle.mjs` is what
keeps the two copies identical, including the user-visible text in both
languages. When you change a label or hint, change it in **both** files:
`lib/settings.js` for the host, `lib/client.js` for the bundle.

A value that only exists on one side is the failure mode this exists to prevent:
a field with no host node silently stops being persisted, and a heading with no
client entry renders as a raw key.

Two things in the browser half's table have no host counterpart, and the gate
checks them against the page's own dictionary instead: the **option labels**,
which name one of a select's options rather than a field, and the **suggestion
sources**, which name a list the page fills from a discovery request. Neither is
a setting, so the host has nothing to mirror.

What the bundle may `require` is a run-time rule, not a build-time import
graph. The shell's module table answers a platform seed word, an
already-materialized module or another plugin's registered client bundle, and
throws for anything else — a client bundle has no filesystem fallback, so it
cannot reach a file of its own package either. A row may not declare its own
package in `dsh.client.external`. The policy the rule enforces is that
cross-plugin value imports are forbidden and cross-plugin collaboration goes
through cordis services; a build step would bridge the two realms, but this
repository still commits a hand-written browser bundle and has no build step, so
the duplication stands.

The plugin's **name** now has one source: `locale/en.json` and `locale/zh.json`,
which both the plugin list and the plugin detail page read. The Settings-era
heading and nav label are gone with the Settings section, so there is no second
copy in `lib/client.js` for the gate to compare — and the exported `PAGE_META`
that existed only for that comparison is gone too. The name still appears in the
two READMEs and in the marketplace copy, so a rename is a documentation change
plus the two dictionaries.

## The DSH requirement is one range, declared three times

`>=0.2.1-rc.2`, a lower bound only, is written identically in
`peerDependencies['@deepseek-ai/dsh-tools']`, `engines.dsh` and
`dsh.compatibility.dsh`; `dsh.compatibility.dshReleases` names the release the
plugin was actually exercised against: `0.2.1-rc.2`, which is also the floor —
the release the Plugins-page configuration was built and verified on. Only the
peer range is enforced — `dsh plugin add` resolves the `@deepseek-ai/dsh*`
peers, while the harness reads neither `engines.dsh` nor `dsh.compatibility`
today — so the three copies are compared by `test/manifest.test.js` instead of
being left to trust.

Never add an upper bound. `^`/`~`/`<` would mean re-releasing this plugin every
time the harness bumps a major, and a `^` range additionally drops the
prereleases of the next version tuple, which is what makes pnpm fail an install
the harness would have allowed. `cordis` and `schemastery` are widened for the
same reason: the gate reads only the `@deepseek-ai/dsh*` peers, but pnpm still
resolves every peer. `@deepseek-ai/cordis`'s floor moves with the DSH floor, not
with this plugin: the 0.2.1-rc.2 packages peer on `~4.0.5`, so this package
requires `>=4.0.5` — still a lower bound only.

## Registry constraints that shape the tools

- The result schema is enforced. List tools therefore return `{ devices: [...] }`
  and `{ avds: [...] }`, never a bare array — the registry rejects a bare array
  as invalid output.
- Results are snapshotted as lossless JSON and `undefined` is rejected. The
  ported providers use `undefined` for absent fields, so `toLosslessJson()`
  normalizes on the single path every result takes rather than in each provider.
- Errors are signalled by throwing; the registry turns a throw into an
  is-error result. A provider must therefore throw for a real failure and must
  not "succeed" with a fabricated value.

## Timeouts are seconds in the settings, milliseconds in the arguments

`bootTimeoutSeconds` and `buildTimeoutSeconds` are what the configuration page
edits and what the providers multiply by 1000. Tool arguments named `timeoutMs`
are milliseconds and override the setting. Do not "simplify" this by renaming
either side: the configuration page and the tool schema are separate contracts,
and `test/emulator-start.test.js` pins the conversion by counting boot polls.

## The tool surface is frozen to the original plugin

All 23 tool names, every argument name and the key-event enum order match the
upstream ZCode `android-emulator@0.1.0` plugin verbatim, and the READMEs state
that as a claim. Adding, renaming or dropping an argument breaks it — find a
different way. The upstream server to compare against is
`~/.zcode/cli/plugins/cache/zcode-plugins-official/android-emulator/0.1.0/dist/mcp/server.js`.

## Editing a plugin in a running host

The package is mounted as a `link:` symlink, and Node caches ESM modules for the
life of the process. **A change under `lib/` does not reach the running DSH host
until it restarts**, and the tools will keep serving the old code in the
meantime. Restart the host before concluding that a fix did or did not work.

## Never claim a behaviour the code does not have

The plugin market reads the README and the package metadata as claims and checks
them against the source. Keep these honest, and re-derive them after a change:

- the tool count in the READMEs and in `lib/tools/index.js`,
- the test count printed by `pnpm test`,
- the settings table (key, kind, default, group) against `lib/settings.js`,
- the slot and key the browser half registers into against `PLUGIN_SURFACE` and
  `package.json`'s name,
- the two route paths against `lib/index.js`,
- the DSH range against the three places that declare it,
- the icon against the format and size `dsh-app-boot` admits,
- the gallery in `screenshots.json` against `assets/` and the two READMEs, and
- the verification table against the commands that actually exist.

## The preview gallery is four curated files, and the only committed images

A plugin market shows the screenshots `screenshots.json` lists next to
`package.json`: the paths are relative to the repository root, may not leave it,
and the order is the order they are displayed. The four live in `assets/` under
`settings-page-N-<what-the-shot-shows>.png` and show the real configuration page
on the plugin's detail view of the Plugins panel in DSH, in the order it
scrolls — never a mock-up, and never a shot of a build that was not captured from
the running page.

The READMEs embed the same four files, so a rename lands in three places at once;
`test/manifest.test.js` fails on a half-rename instead of letting GitHub render a
broken image. Nothing under `assets/` and not `screenshots.json` ships in the
tarball — `files` stays as it is and the market fetches them from the repository.

This is the single exception to "never commit run artifacts". A capture that is
not one of the four stays out of the repository like every other run artifact.

The four are currency, not history: a change to the page's layout, or to any
label inside a shot, means all four are re-captured before the next release, and
the sentence in both READMEs that dates them is updated with them. Nothing fails
if they rot — the market simply shows a page that no longer exists.

## The configuration page's rhythm is deliberate

The host page draws the plugin's title, icon, crumb and description, so the form
starts at the effect note and the category cards — never with a heading of its
own. Each field carries 7px above and below, so two of them sit 14px apart; a
card is `12px 16px` with no bottom padding on its last field; cards sit 16px
apart. The field and card-to-card steps are the sibling ios-simulator plugin's,
so the two configuration pages read the same; only the card's closing padding is
this page's own, larger than that page's because the closing here is a hint
rather than a control. Tune any of it and the page either sprawls or cramps.

Every paragraph must state its own `margin`. The bundle is compiled on its own,
so it cannot rely on a bare-element reset from wherever it is mounted, and the
UA's `p { margin: 1em 0 }` otherwise shows through: 24px per hint, 448px of page
height on its own, and a gap between a control and the hint that describes it
which no amount of tightening the surrounding boxes could hide. A new `<p>` rule
that forgets this is invisible in review and obvious on screen.

## The two READMEs are mirrors, and their links are relative

`README.md` and `README.zh-CN.md` carry the same headings in the same order,
the same tables and the same counts. A change to one is a change to the other.
The language switch names the current edition as plain text and links only the
other one: `**English** | [简体中文](README.zh-CN.md)` in the English edition,
reversed in the Chinese one. A link to the language you are already reading is
noise — it reloads the page it sits on and reads as a broken switch.

Repository files are linked relatively in both — `LICENSE`, `AGENTS.md`, the
other edition. npm resolves a relative README target against `repository.url`
to `<repo>/blob/HEAD/<path>`, so one link works on GitHub, on the npm package
page and in a fresh clone, and nothing hardcodes a branch. That recipe needs
`repository` present and public, and it is observable on published packages:
express's `[MIT](LICENSE)` and commander's `[简体中文](./Readme_zh-CN.md)`
both render as `blob/HEAD/...` links on their npm pages today.

Badges, the four screenshots and the `releases/…` / `issues` URLs stay
absolute: they are not file paths, and a relative one would be rewritten into a
`blob` URL that does not exist.

## The icon is the upstream artwork, not a hand-drawn mark

`android-emulator.png` is the artwork ZCode's own marketplace serves for the
`android-emulator` plugin it ships
(`cdn-zcode.z.ai/zcode/official-plugin/assets/android-emulator/icon.png`),
downscaled to 192 × 192 with its flat `#EDF6E9` tile keyed out: that tile reads
as a washed-out square in a dark list, while the head is mid-green and carries
its own contrast on either theme — which is why the superseded `icon.svg` needed
a `prefers-color-scheme` rule and this does not. The key has to carry the edge
colours outwards; removing a flat background naively leaves a rim of
half-blended tile pixels that is invisible on white and glaring on dark.
Replacing this with another hand-drawn mark is a regression, not a restyle.

The key that produces the file works by flooding the silhouette, filling
everything outside a core at least six pixels inside it with the nearest core
colour, and taking alpha from unmixing against that colour. Both shortcuts fail
visibly: a blunt erode grows the eyes into black crescents, and a colour
threshold for the core cuts through the head's own shading and leaves flat
patches.

`dsh-app-boot` resolves `package.json.icon` to a regular file inside the package
directory, admits SVG, PNG, JPEG and WebP only, caps it at 256 KiB, and inlines
the bytes as a base64 data URL — so the icon ships in the tarball, unlike the
gallery. `test/manifest.test.js` pins the PNG signature, the square frame, the
128 px floor and that cap, then decodes the sprite (`test/helpers/decode-png.mjs`,
built on `node:zlib`) to confirm the corners are transparent, that no pixel above
5% coverage is as pale as the keyed-out tile, and that the only two dark marks
are the eyes, round and equal. A shrunken, re-encoded, naively keyed or
crescent-painted icon fails the suite instead of shipping.

## The type checker is a gate, not a compiler

The repository carries `tsconfig.json` for the host half and
`tsconfig.client.json` for the browser half, both `checkJs: true` with
`noEmit: true`, plus `types/client-globals.d.ts`, which declares the two things
the browser half runs against and the host half never sees:
`window.__ModuleLoader__` and the shell's run-time `require`.

The plugin ships what it writes. There is no transpiler, no bundler and no
build step, so `lib/` is the source that runs and the type checker emits
nothing — **TypeScript is a gate here, not a compiler**: it type-checks the
same files that execute and writes no output.

The two halves are checked apart, and the reason is the realm rather than the
syntax. The host half runs on Node, so it is checked with `types: ["node"]`.
The browser half has no Node globals at all, and its `require` is resolved by
the shell's module table at run time rather than from disk, so it is checked
with `lib: ["ES2023", "DOM"]` and `types: []` — the modules it pulls in are
declared in `types/client-globals.d.ts` instead of imported. Its `module` is
`Node16` because the package is `"type": "module"`.

`skipLibCheck` is on because the peer packages' declarations reference their own
transitive devDependencies (`mdast`, `@deepseek-ai/dsh-util-code-language`),
which this repository does not install; checking them is not this repository's
business. The strictness flags are `strict` plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch` and
`noImplicitOverride`.

The toolchain that makes this possible is a devDependency, not a runtime
dependency: `typescript@6.0.3`, `@types/node@22.20.0` and `@types/react@18`
give the checker real declarations, and
`@deepseek-ai/dsh-client-ui-primitives@0.2.1-rc.2` gives it the real
primitives — pinned to that exact version, because its `latest` dist-tag still
points at a stale release whose types do not match the runtime API.

## Testing

`pnpm run check` is the definition of done: the unit and render suites, then the
consistency gate, then the mount, then the type gate. `pnpm test` alone is not
enough — it cannot see the host↔client drift the gate exists for, and it cannot
see a type error at all.

| Layer | Command | What it proves |
|---|---|---|
| Unit and parsers | `pnpm test` | Bundle load contract, manifest and patch contract, settings projection (live volatile reads, env fallback, out-of-range fallback), every ported parser (`adb devices`, `emulator -list-avds`, UI Automator XML, `input text` escaping, APK selection, JDK major normalisation), and the lossless-JSON projection |
| Configuration page render | `pnpm test` (`client-render.test.js`) | The whole form rendered with real React and `react-dom/server`: the registration targets `plugins.bundle.config` keyed by the package name and nothing else, every group, field and dictionary key present, controlled inputs holding live values, switch and select state correct, the override badge and reset, both route buttons, no title of its own, and no action bar while nothing is staged |
| Consistency gate | `scripts/check-bundle.mjs` | Bundle id equals the package name, namespace equals the patch row id, the exported plugin surface is the Plugins page's `plugins.bundle.config` keyed by the package name (and the bundle no longer registers a Settings section), the two field tables and the two group tables match key-for-key and in order, every heading, hint, placeholder and option matches the host **word for word in both languages**, every field's kind is one the page actually renders and every `suggest` names a list the page provides, the two fixed dictionaries carry the same keys and every declared option label has text in both languages, both routes agree on both sides, `locale/*.json` carries the same keys in both languages, and the bundle is still a classic script |
| Route integration | `test/routes-integration.test.js` | The two configuration routes mounted on a **real** Cordis `Context`: each handler invoked and its `Response` read, all 17 fields arriving as live volatile references, a saved setting visible to the very next call, a handler error answered as a `500` body rather than a crash, an absent optional service tolerated, and disposal removing both routes |
| Real host mount | `scripts/verify-mount.mjs` | Mounted on a **real** Cordis `Context` with the **real** `ToolRuntime`: 23 tools registered, **all 23 dispatched through the registry** and validated against their argument and result schemas, malformed arguments refused, unknown names unresolved, 17 volatile fields, full unregistration on dispose |
| Type gate | `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.client.json --noEmit` | The host half's contracts against the real `@deepseek-ai/*` declarations, and the browser half's contracts against the real `react` and the real `dsh-client-ui-primitives` declarations — the two halves checked apart, because they run in different realms |

The type gate is a command of its own: `pnpm run typecheck` runs the two
`tsc --noEmit` invocations in sequence, and `pnpm run check` chains it in after
the mount, so a type error fails the definition of done too.

`pnpm run smoke` and `pnpm run smoke:emulator` are the real-machine layer and
never run under `pnpm test`: only a machine with an SDK, an emulator and Gradle
can prove discovery, boot and teardown, screenshots, logcat, UI automation and a
real `android_create_app` → build → install → launch cycle.

Two limits are accepted rather than worked around:

- The configuration routes are mounted in a real profile, but their HTTP responses
  cannot be exercised outside the GUI: the desktop app authenticates every
  request, so a bare `curl` answers `403 forbidden` before the handler runs.
  `test/routes-integration.test.js` therefore invokes the handlers directly on a
  real Cordis context, and the page's spacing, dark theme and narrow-width
  wrapping are checked by eye in the GUI.
- `@deepseek-ai/dsh-client-ui-primitives` is published in many versions, but its
  `latest` dist-tag still points at `0.0.1-rc.1`, whose declarations match
  neither the runtime API nor this plugin: five of the primitives the browser
  half uses — `SettingsFormModel`, `settingsTextField`, `Switch`, `Tag` and
  `Toast` — are missing from it. `0.2.1-rc.2` carries 89 `.d.ts` files and
  covers every one of them, so the repository pins that exact version. The
  render test still uses a faithful double for the primitives while React and
  `react-dom/server` stay real — and that is a choice, not a consequence of a
  missing package: the shipped primitives are a browser bundler input (their
  `lib/index.js` imports `*.module.css`, `simple-icons` and
  `zustand/vanilla`), so plain Node cannot import them without rebuilding the
  whole client dependency graph. The double keeps the render hermetic.

## Commit conventions

Conventional Commits, English, imperative subject, no trailing period, subject
under 72 characters. Types: `feat`, `fix`, `docs`, `chore`, `build`, `test`.

```
fix: refuse a serial whose emulator has gone away
fix: type a percent sign instead of corrupting it to %25
docs: correct the test count and the settings-page limitation
build: bump the version to 1.0.1
```

The body explains **why**, not what: the failure that motivated the change, the
trade-off taken, what was verified. Wrap at 72 columns — prose paragraphs flush
left, list continuations indented four spaces under their bullet.

One logical change per commit. `build: bump the version to x.y.z` is the release
commit and the tag points at it.

Package versions follow the conventional-commits mapping: **a landed `feat:`
means at least a minor bump**. A branch with two features is `x.(y+1).0`, not
`x.y.(z+1)`, even when the diff is mostly fixes.

## Release and publishing

1. Land the documentation first. The README on the npm page is the copy **inside
   the published tarball**, so a README edit reaches npm only with the next
   publish.
2. Bump `version` in `package.json` and commit it as `build: bump the version to
   x.y.z`. Nothing else rides along.
3. Tag `vX.Y.Z` **lightweight** — `git tag vX.Y.Z`, as `v1.0.0` and `v1.1.0` are;
   not annotated — then push `main` and the tag to **both** remotes. A mirror
   left holding the old tip will push it back.

   ```bash
   git push origin main && git push origin vX.Y.Z
   git push gitea  main && git push gitea  vX.Y.Z
   ```

4. Publish from the tagged commit. Both flags are required: the local `.npmrc`
   points `registry` at a read-only mirror, and a scoped package stays private
   without public access.

   ```bash
   npm publish --registry https://registry.npmjs.org --access public
   ```

   On a 2FA account npm adds a browser approval step and may stage a temporary
   `0.0.0-stage` version first; that placeholder is expected.
5. Verify the release rather than assuming it: `gitHead` must equal the tag
   commit, and the published tarball's shasum must equal what the local pack
   printed.

   ```bash
   npm view @zhz8888/dsh-android-emulator-helper@X.Y.Z gitHead --registry https://registry.npmjs.org
   git rev-parse vX.Y.Z^{commit}
   ```

   `npm pack` fails on this machine because `~/.npm` holds root-owned files;
   `pnpm pack` is the working equivalent and prints the same file list.
6. Write the GitHub Release for the tag: **Chinese first, then English**, the
   halves separated by `---` and each opening with its own `##` headline. Both
   halves carry the same sections — a one-line summary, what the version
   contains, what changed since the previous version, install, verification (the
   checks actually run, with their results), and the release artifact (npm
   version, tarball file count and size, sha256, and the `gitHead` ↔ tag match).

**After an upgrade the host must be restarted.** The package is mounted as a
`link:` symlink, so no `lib/` change takes effect until DSH restarts. Say so in
the release notes: a user who upgrades and keeps the old process sees the old
behaviour and will report the bugs this version fixed.

## Do not

- Add a runtime dependency. The harness provides the `@deepseek-ai/*` peers, and
  a second copy of one is a bug; they stay in `peerDependencies`.
- Move a devDependency into `dependencies`, or a peer into `devDependencies`.
  `typescript`, `@types/node`, `@types/react` and
  `@deepseek-ai/dsh-client-ui-primitives` are installed so the type checker can
  see real declarations, and nothing they provide is loaded at run time.
  `@deepseek-ai/dsh-client-ui-primitives` is **not** a plugin peer either — the
  browser half gets it from the shell's seed table — so it does not belong in
  `peerDependencies`, and it stays pinned to the exact version `0.2.1-rc.2`
  because its `latest` tag still points at a stale release.
- Put an upper bound on a `@deepseek-ai/*` range, or declare the DSH requirement
  in fewer than all three places.
- Let a settings field, group, label or hint exist on one side of the plugin
  only, or change the namespace without changing all four places (manifest,
  patch row, host, client).
- Commit run artifacts: `.tmp-*/` scratch trees, screenshots, build logs,
  `.gradle/`, `*.tgz`, coverage. `assets/` and `screenshots.json` are the one
  curated exception, and only the four files the gallery names.
- Register the plugin's configuration page in the Settings dialog
  (`settings.section`) again: plugin-owned pages belong on the Plugins page, and
  a second registration there would give the plugin two configuration pages.
- Describe behaviour in the READMEs that the source does not implement.
- Replace the direct `spawn` with DSH's subprocess seam. `gradlew`, `adb` and
  `emulator` behaving byte-for-byte as they did in the original is the reason the
  port is usable, and `adb exec-out` needs no binary-stream adapter; the accepted
  cost is no managed process ranges, env scrubbing, output spill or teardown
  termination, which is why every call carries its own timeout and `SIGTERM`.
- Let a generated project depend on hand edits to build. `android_create_app`
  must emit a project that compiles as-is; `lib/providers/project-template.js`
  pins the JVM target for exactly that reason.
- Track `docs/`. It is not part of the deliverable: nothing in it ships, nothing
  reads it at runtime, and no test loads it.
