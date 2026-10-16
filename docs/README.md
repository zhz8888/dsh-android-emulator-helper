# docs

This directory is repository material, not part of the published package —
`package.json`'s `files` list does not include it.

## research/

The DSH plugin contracts this port depends on, reverse-engineered from the
shipped packages. Every conclusion carries a `file:line` citation and verbatim
code, which makes this the verifiable form of the "DSH plugin development spec"
this port follows: the DSH application bundle ships no `docs/` developer tree, so
the authoritative sources are each package's README plus the implementation
itself.

- [`research/host-half-spec.md`](research/host-half-spec.md) — host half: the tool
  registration contract (`defineTool`, `output.schema`/`render`, the parameter
  DSL subset, throw-is-error), the `Config` + `.volatile()` live-update
  mechanism, the package contract (`dsh.bundle.patch`, `dsh.profile.bundles`,
  the `peerDependencies` compatibility gate), `cordis.patch.yml` semantics, and
  the injectable host services (`ctx.subprocess`, `ctx.fs`, `ctx.shell`,
  `ctx.jobs`, `ctx.spillStore`, `ctx.attachments`).
- [`research/client-half-spec.md`](research/client-half-spec.md) — browser half:
  the `window.__ModuleLoader__.load` bundle format and the rule that its `id`
  must equal the package name, the nine-word static module seed table, the lazy
  CJS model, CSS ownership tagging, the slot registration contracts
  (`settings.section`, `plugins.item`, `settings.plugins.tab`), and the exact
  `ctx.configForms` `get`/`whileServed`/`describe` signatures.
- [`research/example-plugin/`](research/example-plugin/) — a runnable minimal host
  plugin together with the `verify.mjs` that mounts it offline.

Where the harness later proved a contract different from what these documents
say, the [README](../README.md) records the corrected rule under "Development"
and "Known limitations"; the Chinese edition is
[README.zh-CN.md](../README.zh-CN.md).
