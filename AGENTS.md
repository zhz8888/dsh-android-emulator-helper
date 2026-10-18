# AGENTS.md

Repository conventions for `@zhz8888/dsh-android-emulator-helper`. Read this
before changing anything.

## What this repository is

A DSH (DeepSeek Harness) plugin: a **host half** (`lib/index.js` and
`lib/providers/**`) that registers 23 `android_*` tools, one embedded skill, one
slash command and two settings-page Fetch routes, plus a **client half**
(`lib/client.js`) that is a hand-written classic script rendering the settings
page. `lib/**` is committed on purpose — the browser bundle is written, not
generated.

## Commands

```bash
pnpm install                 # @deepseek-ai/* peers + react/react-dom, for tests only
pnpm test                    # 151 tests: unit, settings projection, parsers, render, routes
pnpm run check               # test + check-bundle + verify-mount: the definition of done
pnpm run verify:mount        # real Cordis Context + real ToolRuntime, all 23 tools dispatched
pnpm run smoke               # read-only real-machine probes
pnpm run smoke:emulator      # also boot an AVD, screenshot, logs, stop
pnpm run link:dsh-deps       # offline dev: symlink a local DSH's @deepseek-ai packages
```

`pnpm run check` must be green before any commit that touches `lib/`. It is the
only command that catches host↔client drift.

Anything needing an SDK, an emulator or Gradle is a `scripts/smoke.mjs` concern
and must never become a `pnpm test` requirement.

The local `pnpm install` exists for development and the test suite; installing
the published package needs none of it. pnpm is the only package manager the
repository uses: `packageManager` pins `pnpm@11.8.0` and `pnpm-lock.yaml` is the
only lockfile (there is no `package-lock.json`). `pnpm-workspace.yaml` does not
open a workspace — this is a single-package repository — it carries the
install-script policy, `strictDepBuilds: true`: pnpm v10+ skips a dependency's
build scripts *silently* by default, which is the wrong failure mode here, so
strict mode fails `pnpm install` with `ERR_PNPM_IGNORED_BUILDS` and forces an
explicit per-package decision. The current tree (27 packages) declares no
install-time build scripts, so no `allowBuilds` entry is needed.

## Repository map

```
dsh-android-emulator-helper/
├── package.json            # dsh.bundle.patch, dsh.client, peer dependencies (the compatibility gate)
├── cordis.patch.yml        # - insert: [{ id: android-emulator-helper, name: '@zhz8888/dsh-android-emulator-helper' }]
├── android-emulator.png    # plugin icon: ZCode's artwork, pale tile keyed out, 192 px
├── screenshots.json        # the four preview images a plugin market shows, in scroll order
├── locale/en.json          # plugin-page name and description (English; its presence is what enables every other language)
├── locale/zh.json          # the Simplified Chinese pair
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
├── assets/                 # the four settings-page screenshots `screenshots.json` names
└── test/                   # node:test unit and integration suites
```

Three constraints shape that layout:

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
3. **The plugin-page name is a package resource, not a manifest field**: DSH
   resolves `<package>/locale/en.json` through the `exports` map, so
   `./locale/*.json` has to stay exported and `locale` has to stay in `files`;
   either omission degrades silently to showing the raw package name. `en.json`
   is also the switch that enables every other language file, so it cannot be
   dropped in favour of `zh.json`.

## The two halves share a contract, not code

The client bundle cannot import `lib/settings.js` — the purity gate forbids
cross-plugin value imports — so the field table, the group table and every label,
hint and placeholder are written **twice**. `scripts/check-bundle.mjs` is what
keeps the two copies identical, including the user-visible text in both
languages. When you change a label or hint, change it in **both** files:
`lib/settings.js` for the host, `lib/client.js` for the bundle.

A value that only exists on one side is the failure mode this exists to prevent:
a field with no host node silently stops being persisted, and a heading with no
client entry renders as a raw key.

The plugin's **name** is duplicated the same way but across a different seam: the
plugin list reads it from `locale/en.json` and `locale/zh.json`, while the
settings page draws its own heading and registers its own nav label from the
bundle's dictionary. `scripts/check-bundle.mjs` compares the two titles per
language, so a rename has to land in four places — both dictionaries and both
bundle dictionaries (`lib/client.js`) — and the exported `PAGE_META` exists only
so that gate can read them. The title is the name a user sees; the nav label is
the short form the shell renders in the sidebar, and they are deliberately not
the same string.

## The DSH requirement is one range, declared three times

`>=0.2.0-rc.2`, a lower bound only, is written identically in
`peerDependencies['@deepseek-ai/dsh-tools']`, `engines.dsh` and
`dsh.compatibility.dsh`; `dsh.compatibility.dshReleases` names the release the
plugin was actually exercised against. Only the peer range is enforced — `dsh
plugin add` resolves the `@deepseek-ai/dsh*` peers, while the harness reads
neither `engines.dsh` nor `dsh.compatibility` today — so the three copies are
compared by `test/manifest.test.js` instead of being left to trust.

Never add an upper bound. `^`/`~`/`<` would mean re-releasing this plugin every
time the harness bumps a major, and a `^` range additionally drops the
prereleases of the next version tuple, which is what makes pnpm fail an install
the harness would have allowed. `cordis` and `schemastery` are widened for the
same reason: the gate reads only the `@deepseek-ai/dsh*` peers, but pnpm still
resolves every peer.

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

`bootTimeoutSeconds` and `buildTimeoutSeconds` are what the settings page edits
and what the providers multiply by 1000. Tool arguments named `timeoutMs` are
milliseconds and override the setting. Do not "simplify" this by renaming either
side: the settings page and the tool schema are separate contracts, and
`test/emulator-start.test.js` pins the conversion by counting boot polls.

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
- the two route paths against `lib/index.js`,
- the DSH range against the three places that declare it,
- the icon against the format and size `dsh-app-boot` admits,
- the gallery in `screenshots.json` against `assets/` and the two READMEs, and
- the verification table against the commands that actually exist.

## The preview gallery is four curated files, and the only committed images

A plugin market shows the screenshots `screenshots.json` lists next to
`package.json`: the paths are relative to the repository root, may not leave it,
and the order is the order they are displayed. The four live in `assets/` under
`settings-page-N-<what-the-shot-shows>.png` and show the real settings page in
DSH Desktop, in the order it scrolls — never a mock-up, and never a shot of a
build that was not captured from the running page.

The READMEs embed the same four files, so a rename lands in three places at once;
`test/manifest.test.js` fails on a half-rename instead of letting GitHub render a
broken image. Nothing under `assets/` and not `screenshots.json` ships in the
tarball — `files` stays as it is and the market fetches them from the repository.

This is the single exception to "never commit run artifacts". A capture that is
not one of the four stays out of the repository like every other run artifact.

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

## Testing

`pnpm run check` is the definition of done: the unit and render suites, then the
consistency gate, then the mount. `pnpm test` alone is not enough — it cannot see
the host↔client drift the gate exists for.

| Layer | Command | What it proves |
|---|---|---|
| Unit and parsers | `pnpm test` | Bundle load contract, manifest and patch contract, settings projection (live volatile reads, env fallback, out-of-range fallback), every ported parser (`adb devices`, `emulator -list-avds`, UI Automator XML, `input text` escaping, APK selection, JDK major normalisation), and the lossless-JSON projection |
| Settings page render | `pnpm test` (`client-render.test.js`) | The whole page rendered with real React and `react-dom/server`: every group, field and dictionary key present, controlled inputs holding live values, switch and select state correct, the override badge and reset, both route buttons, and no action bar while nothing is staged |
| Consistency gate | `scripts/check-bundle.mjs` | Bundle id equals the package name, namespace equals the patch row id, the two field tables and the two group tables match key-for-key and in order, every heading, hint, placeholder and option matches the host **word for word in both languages**, the plugin name matches the heading and nav label the bundle renders, both routes agree on both sides, `locale/*.json` carries the same keys in both languages, and the bundle is still a classic script |
| Route integration | `test/routes-integration.test.js` | The two settings routes mounted on a **real** Cordis `Context`: each handler invoked and its `Response` read, all 17 fields arriving as live volatile references, a saved setting visible to the very next call, a handler error answered as a `500` body rather than a crash, an absent optional service tolerated, and disposal removing both routes |
| Real host mount | `scripts/verify-mount.mjs` | Mounted on a **real** Cordis `Context` with the **real** `ToolRuntime`: 23 tools registered, **all 23 dispatched through the registry** and validated against their argument and result schemas, malformed arguments refused, unknown names unresolved, 17 volatile fields, full unregistration on dispose |

`pnpm run smoke` and `pnpm run smoke:emulator` are the real-machine layer and
never run under `pnpm test`: only a machine with an SDK, an emulator and Gradle
can prove discovery, boot and teardown, screenshots, logcat, UI automation and a
real `android_create_app` → build → install → launch cycle.

Two limits are accepted rather than worked around:

- The settings routes are mounted in a real profile, but their HTTP responses
  cannot be exercised outside the GUI: the desktop app authenticates every
  request, so a bare `curl` answers `403 forbidden` before the handler runs.
  `test/routes-integration.test.js` therefore invokes the handlers directly on a
  real Cordis context, and the page's spacing, dark theme and narrow-width
  wrapping are checked by eye in the GUI.
- `@deepseek-ai/dsh-client-ui-primitives` publishes only `0.0.1-rc.1` on npm,
  which does not match the runtime API, so the render test uses a faithful double
  for the primitives while React and `react-dom/server` stay real.

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
- Put an upper bound on a `@deepseek-ai/*` range, or declare the DSH requirement
  in fewer than all three places.
- Let a settings field, group, label or hint exist on one side of the plugin
  only, or change the namespace without changing all four places (manifest,
  patch row, host, client).
- Commit run artifacts: `.tmp-*/` scratch trees, screenshots, build logs,
  `.gradle/`, `*.tgz`, coverage. `assets/` and `screenshots.json` are the one
  curated exception, and only the four files the gallery names.
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
