# `dsh-example-host-tool` — a minimal working DSH host plugin

One Cordis plugin module registering **one model-facing tool** (`host_run`) with a
**live-editable (volatile) Config**. It is the reference implementation for
`../host-half-spec.md`.

```
.
├── package.json          manifest: type:module, exports, dsh.bundle.patch, DSH peer range
├── cordis.patch.yml      the bundle layer: inserts the row, seeds the Config
├── lib/index.js          name / Config / inject / apply + the host_run tool
├── verify.mjs            17 offline assertions (contract, volatile liveness, mount, teardown)
└── node_modules/         DEV-ONLY symlink bridge to the DSH runtime packages (not published)
```

## What `lib/index.js` demonstrates

| Concept | Where |
|---|---|
| Module contract (`export const name/Config/inject`, `export function apply`) | top of file |
| Four `.volatile()` Config fields with `.default()` / `.description()` | `export const Config` |
| Reading a volatile field **at call time** (never destructured in `apply`) | `readField` / `readLive` |
| `defineTool({…})` and the author parameter/output DSL | inside `apply` |
| Nullable scalar via exact-one `oneOf` (there is no `type: ['a','b']`) | `output.schema.properties.exitCode` |
| `ctx.subprocess.spawn` with argv / cwd / env / stdin / collect-mode stdio | `execute` |
| A consumer-owned deadline fused with the caller's signal | `AbortSignal.any([exec.signal, AbortSignal.timeout(…)])` |
| Offset-based non-consuming output readers | `read(handle.collected.stdout)` |
| `render(args, value) -> ContentBlock[]` | `output.render` |
| Browser card hint | `presentCall` |
| Parallel-scheduling opt-in | `isConcurrencySafe` |
| How to return an image, and how errors must be signalled | comment block at the bottom |

## Run the offline checks

```console
$ node verify.mjs
```

This mounts the plugin on a **real Cordis `Context`** with stub `tools` and
`subprocess` services — no DSH boot, no profile, no network — and asserts the
module contract, that all four fields really carry `meta.volatile`, that a live
edit commits into the *running* references (mirroring
`cordis-plugin-loader`'s `_commitVolatile`), that `inject` gating lets `apply`
run, that the registered definition validates arguments and output, and that
fibre disposal unregisters the tool.

`node_modules/@deepseek-ai/*` here are **symlinks into the app bundle**, only so
`node verify.mjs` can resolve `@deepseek-ai/dsh-tools`, `@deepseek-ai/schemastery`,
`@deepseek-ai/cordis` and `@deepseek-ai/cosmokit`. At real runtime the DSH
launcher's runtime resolution supplies those — do not publish the symlinks.

Recreate the bridge if you copy this directory elsewhere:

```console
$ mkdir -p node_modules/@deepseek-ai
$ APP="/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai"
$ for p in schemastery dsh-tools cordis cosmokit; do ln -sfn "$APP/$p" "node_modules/@deepseek-ai/$p"; done
```

## Install it into a dev profile

`--profile desktop` is refused by the CLI (the Electron app owns that profile).
Use a dedicated profile:

```console
$ DSH="/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js"
$ node "$DSH" plugin --profile mydev add "$PWD"

# `add` installs it as a link: dependency AND appends it to
# dsh.profile.bundles, because package.json declares dsh.bundle.patch.
$ node "$DSH" --profile mydev --dump-config
# == dsh-example-host-tool
- id: example-host-tool
  name: dsh-example-host-tool
  config:
    prefix: host-run
    timeoutMs: 15000
    maxBytes: 65536
    maxArgv: 64

# What the Settings UI will be able to edit (look for x-cordis.volatile):
$ node "$DSH" --profile mydev --dump-config-schema | grep -A3 '"prefix"'
```

To exercise it **without touching `~/.dsh`**, point `DSH_HOME` at a scratch
directory and pre-create the profile (so pnpm installs no bundles):

```console
$ export H=/tmp/probe-home
$ mkdir -p "$H/profiles/mydev"
$ printf '{"name":"dsh-profile-mydev","private":true,"dsh":{"profile":{"bundles":[]}}}\n' > "$H/profiles/mydev/package.json"
$ printf 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n' > "$H/profiles/mydev/pnpm-workspace.yaml"
$ echo '[]' > "$H/profiles/mydev/cordis.patch.yml"
$ DSH_HOME="$H" node "$DSH" plugin --profile mydev add "$PWD"
$ DSH_HOME="$H" node "$DSH" --profile mydev --dump-config
```

> `cordis.patch.yml` must not be empty or comment-only — use `[]`.

## Live-editing the Config

Every field is `.volatile()`, so the entry gets a settings form automatically and
edits apply **without remounting**:

1. edit `prefix` in the plugin's Settings card;
2. `dsh-settings` writes the value into the profile's `cordis.patch.yml`;
3. the loader re-parses the raw config and calls `updateVolatile` on each changed
   reference, then emits `loader/volatile-update`;
4. the **same** `config` object the plugin closed over now returns the new value
   from `.get()`, so the next `host_run` call prints the new prefix.

That is why `apply` never destructures `config`: a destructured scalar is a
snapshot taken at mount time and would never see step 4.

Try it by hand:

```console
$ # while the profile is running, override the row in cordis.patch.yml:
$ cat >> "$H/profiles/mydev/cordis.patch.yml" <<'EOF'
- id: example-host-tool
  config:
    prefix: EDITED
    timeoutMs: 15000
    maxBytes: 65536
    maxArgv: 64
EOF
```

Note that a patch `config:` **replaces the row's whole config** — restate every
field you want to keep, as above.

## Adapting it

- **Tool name**: change `name: 'host_run'` to something you namespace yourself
  (e.g. `emu_devices`). Host tool names are not prefixed for you, and two plugins
  registering the same name in the same layer is a load failure.
- **New Config field**: add it, chain `.volatile()`, and read it through
  `readLive(config)`. A secret also carries `.role('secret')`, which strips the
  field (and its default) from every value and form handed to a remote caller.
- **New result field**: add it to `output.schema.properties` with
  `required: true` (or leave it optional) — `additionalProperties: false` rejects
  anything you forget to declare, and a missing `required` key fails the call.
- **A different tool body**: keep the two-phase shape — do the work, then return
  one lossless-JSON value that satisfies `output.schema`.
