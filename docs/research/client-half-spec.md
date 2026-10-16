# DSH Plugin **Client Half** Specification

Implementation-ready spec for the browser/client half of a DeepSeek Harness (DSH) plugin,
focused on contributing a page inside the DSH **Settings** UI.

Evidence base (read-only inspection, 2026-10-16):

| Root | Path |
|---|---|
| Bundled app packages | `/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/` |
| Bundled web shell (built SPA) | `/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-5SrrfWpU.js` |
| Installed 3rd-party plugins | `/Users/zhz/.dsh/profiles/desktop/node_modules/` |
| Live profile patch | `/Users/zhz/.dsh/profiles/desktop/cordis.patch.yml` |

DSH version in this bundle: `0.2.0-rc.2` (all `@deepseek-ai/*` client/UI packages).

> **Note on shipped docs.** The app bundle ships **no** `docs/` tree and **no** developer guide
> (`find /Applications/DSH\ Desktop.app/Contents/Resources/app -maxdepth 3 -type d -name docs`
> → only `node_modules/undici/docs` and an empty `node_modules/dsh-community-market/docs`).
> The authoritative prose is the per-package `README.zh.md` / `README.md`, plus one **machine-readable
> slot + service catalog** embedded in `@deepseek-ai/dsh-cordis-client-runner/lib/client.js`
> (see §11). Package `lib/types/**/*.d.ts` files are **not shipped** in this bundle — only
> `lib/*.js` — so type declarations below are quoted from the catalog's `source:` references
> (e.g. `packages/client/ui-settings/src/client/contract/slots.ts:57`).

---

## 0. TL;DR — the ten answers

1. Declared by `package.json` → top-level `"dsh": { "client": { "platform": "web", "inject": [...], "external": [...], "immediately": bool } }` **plus** `exports["./client"]`.
2. Bundle format is a **classic script** calling `window.__ModuleLoader__.load({ id, factory })`; `id` **must equal the package name**; `factory(require)` returns a CJS `module.exports` object with `apply` and (usually) `inject`.
3. `apply(ctx)` — a normal Cordis plugin body. `ctx.inject(services, cb)` is Cordis' *required-service child fiber* (NOT the slot API); `ctx.slots.inject(slotName, cb)` is the **slot** API and *waits* for the slot declaration.
4. Slots live in `ctx.slots` (`SlotRegistry`, from `@deepseek-ai/dsh-client-ui-renderer/lib/client.js`), backed by the pure `SlotCore` in `@deepseek-ai/dsh-client-ui-slots/lib/index.js`.
5. To add a **tab to the Settings → Built-in plugins page**: register into `settings.plugins.tab` (list, root) via `ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({...}, Component))`. To add a **whole nav section**: register into `settings.section`.
6. Config forms API = `ctx.configForms` (`ConfigForms` service) + `ctx.settingsSchema` (`SettingsSchemaService`), both in `@deepseek-ai/dsh-client-ui-settings/lib/client.js`. Entry id = **the profile Loader row id** (the `id:` in `cordis.patch.yml`).
7. `ctx.locale.register(NS, { zh, en })` + `ctx.locale.bind(NS)` — `@deepseek-ai/dsh-client-locale/lib/client.js:1387` / `:1414`.
8. READMEs summarized in §12.
9. Bundle **may be hand-written plain JS** — no bundler required (real precedent: `dsh-tabbit`, `@zhz8888/dsh-radeon-cloud-patcher`). `require` resolves a frozen 9-entry platform seed table, other plugin bundles by package name, and `.map`/`sourceMappingURL` is optional.
10. A client half is **REQUIRED** for a custom settings page. The host **never** auto-generates one; `autoGenerate` is on the wire but no shipped client consumes it (`@deepseek-ai/dsh-settings/README.zh.md:39`, verified in §10).

---

## 1. How a client half is declared

### 1.1 The `package.json` fields

```jsonc
// /Users/zhz/.dsh/profiles/desktop/node_modules/@mars-sea/dsh-commandcode-provider/package.json
{
  "name": "@mars-sea/dsh-commandcode-provider",
  "type": "module",
  "main": "./lib/index.js",
  "exports": {
    ".":            { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./client":     { "default": "./lib/client.js" },      // ← the browser bundle
    "./locale/*.json": "./locale/*.json",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },           // ← host row (REQUIRED for discovery)
    "compatibility": { "dsh": "0.2.0-rc.2 || 0.2.1-alpha.4", "dshReleases": {...} },
    "client": {
      "inject": [                                          // ← client-bundle dependency list
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-api-remotes"
      ],
      "platform": "web"                                    // ← REQUIRED; only "web" is served
    }
  }
}
```

A second real example, with `external` omitted and `inject` including the settings-plugins shell:

```jsonc
// /Users/zhz/.dsh/profiles/desktop/node_modules/dsh-web-search-free/package.json
"dsh": {
  "name": "web-search-free",
  "client": {
    "platform": "web",
    "inject": [
      "@deepseek-ai/dsh-client-connection",
      "@deepseek-ai/dsh-api-remotes",
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-client-ui-settings-plugins"
    ]
  },
  "bundle": { "patch": "./cordis.patch.yml" }
},
"exports": {
  ".":        { "types": "./dist/index.d.ts",  "default": "./dist/index.js" },
  "./client": { "types": "./dist/client.d.ts", "default": "./dist/client.js" },
  "./package.json": "./package.json"
}
```

A minimal one, and the only one in this machine's set that ships **no `inject`** and a
**hand-written** bundle:

```jsonc
// /Users/zhz/.dsh/profiles/desktop/node_modules/@zhz8888/dsh-radeon-cloud-patcher/package.json
"exports": {
  ".": "./src/index.js",
  "./client": "./client/client.js",
  ...
},
"dsh": {
  "manifestVersion": 1,
  "bundle": { "patch": "./cordis.plugin.patch.yml" },
  "client": { "platform": "web" },
  "compatibility": { "dsh": ">=0.2.0-rc.1", "dshReleases": { "0.2.0-rc.2": "compatible" } }
}
```

### 1.2 The `dsh.client` validator (exact grammar)

`@deepseek-ai/dsh-client-modules/lib/client.js:61-75` — `parseDshClient` (shared verbatim by the
node half; the file's types region is reused by both faces):

```js
function parseDshClient(pkgName, value) {
    if (value === void 0) return void 0;
    if (typeof value !== "object" || value === null) throw new Error(`client-modules: ${pkgName} has a non-object dsh.client declaration`);
    const decl = value;
    if (typeof decl.platform !== "string") throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`);
    const inject   = optionalStringArray(pkgName, "dsh.client.inject",   decl.inject);
    const external = optionalStringArray(pkgName, "dsh.client.external", decl.external);
    if (decl.immediately !== void 0 && typeof decl.immediately !== "boolean") throw new Error(`client-modules: ${pkgName} dsh.client.immediately must be a boolean`);
    return {
        platform: decl.platform,
        ...inject     !== void 0 ? { inject }     : {},
        ...external   !== void 0 ? { external }   : {},
        ...decl.immediately !== void 0 ? { immediately: decl.immediately } : {}
    };
}
```

Fields:

| Field | Required | Meaning |
|---|---|---|
| `dsh.client.platform` | **yes** (string) | Only `"web"` is served; anything else → package is skipped (`lib/index.js:714`). |
| `dsh.client.inject` | no (string[]) | Package names whose bundles must be **registered before** this one materializes. The boot graph is topologically ordered on these. |
| `dsh.client.external` | no (string[]) | Extra module requests this bundle makes beyond the frozen platform seed. Each must resolve to a graph row or an exact seed key, else **composition throws**. |
| `dsh.client.immediately` | no (bool) | Puts the row in the shell's eager prefetch tier (`dsh-web-frontend` shell: `prefetchImmediateTier()` → `manifest.plugins.filter(e => e.immediately).map(e => this.modules.prefetch(e.id))`). |

### 1.3 How the host discovers the bundle — the Loader scan

The bundle is discovered **only from a live Loader entry**. There is no directory walk.

`@deepseek-ai/dsh-client-modules/lib/index.js:525-556` (the `ClientModuleRegistry` constructor):

```js
constructor(ctx) {
    super(ctx, "clientModules");
    ctx.on("internal/plugin", (fiber) => {
        const entryName = fiber.entry?.options.name;
        if (entryName === void 0) return;
        this.dirty.add(entryName);
        if (this.flushQueued) return;
        this.flushQueued = true;
        queueMicrotask(() => { this.flushQueued = false; this.flush((err) => { ctx.logger.warn(err); }); });
    });
    for (const entry of ctx.loader.entries()) this.dirty.add(entry.options.name);
    this.composed = this.compose();
    const failures = [];
    this.flush((err) => failures.push(err));
    if (failures.length > 0) throw new ClientPackageCompositionError(failures);
    const registerWebCarrier = (webCtx) => {
        webCtx.effect(() => webCtx.webServer.register({
            kind: "prefix",
            path: PLUGIN_ROUTE,                 // "/plugins"   (lib/index.js:201)
            handler: this.serveBundle
        }), "client-modules: bundle route");
    };
    ctx.inject(["webServer"], registerWebCarrier);
    ctx.on("webserver/index-inject", (table) => { table.push(...bootInjections(this.composed)); });
}
```

`lib/index.js:701-731` — `resolveMeta`, which turns a Loader row's *specifier* into a bundle path:

```js
resolveMeta(loaderName, baseUrl) {
    const sourceKey = this.sourceKey(loaderName, baseUrl);
    const cached = this.pkgMeta.get(sourceKey);
    if (cached !== void 0) return cached;
    const located = this.locatePkgJson(loaderName, baseUrl);   // resolves <name>/package.json
    if (located === void 0) { this.pkgMeta.set(sourceKey, null); return null; }
    const { packageName, path: pkgPath } = located;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const dsh = pkg.dsh;
    const decl = parseDshClient(packageName, dsh !== null && typeof dsh === "object" ? dsh.client : void 0);
    if (decl === void 0 || decl.platform !== "web") { this.pkgMeta.set(sourceKey, null); return null; }
    const clientRel = clientExportOf(packageName, pkg.exports);
    if (clientRel === void 0) throw new Error(`client-modules: ${packageName} declares dsh.client but exports no "./client" bundle`);
    const resolved = {
        packageName,
        meta: {
            clientPath: join(dirname(pkgPath), clientRel),
            ...decl.inject !== void 0 ? { inject: decl.inject } : {},
            external: decl.external ?? [],
            immediately: decl.immediately === true
        }
    };
    this.pkgMeta.set(sourceKey, resolved);
    return resolved;
}
```

`lib/index.js:170-181` — the `exports["./client"]` reader (accepts a bare string or a
one-level conditional object with a string `default`):

```js
function clientExportOf(pkgName, exportsField) {
    if (typeof exportsField !== "object" || exportsField === null) return void 0;
    const client = exportsField["./client"];
    if (client === void 0) return void 0;
    if (typeof client === "string") return client;
    if (typeof client === "object" && client !== null) {
        const fallback = client.default;
        if (typeof fallback === "string") return fallback;
    }
    throw new Error(`client-modules: ${pkgName} exports["./client"] must be a string or an object with a string default`);
}
```

**Consequence (critical):** a plugin with **no host half** is invisible. `dsh-client-ui-settings-plugins`
ships an intentionally empty host `apply` for exactly this reason —
`@deepseek-ai/dsh-client-ui-settings-plugins/lib/index.js:1-12`:

```js
/**
* Plugins settings surface, node half. The empty apply exists so the plugin
* appears in the host cordis.yml / Loader; the browser half owns the section
* and its configurable tab through exports["./client"], discovered from the
* package.json dsh.client declaration. ...
*/
function apply() {}
export { apply };
```

…and the row is inserted by the web-app bundle patch,
`@deepseek-ai/dsh-web-app/cordis.patch.yml:205-212`:

```yaml
    # ── browser plugin roster (dsh.client rows; node halves are layer-2 hosts) ──

    # Dual-face: the node half scans this tree, composes window.__DSH_BOOT__,
    # and serves /plugins/<id>/client.js; ...
    - id: modules
      name: '@deepseek-ai/dsh-client-modules'
```

Rows for `ui-renderer`, `locale`, `ui-settings`, `ui-settings-plugins` etc. follow the same shape
(`cordis.patch.yml:239,251,288,402`).

### 1.4 Serving: route, revisions, batches, source maps

`satisfies` — `lib/index.js:200-217`:

```js
const PLUGIN_ROUTE = "/plugins";
function comboSearch(ids, rev, sourceMap = false) { ... }   // "??<id>,<id>&rev=<rev>[&map]"
function comboUrl(ids, rev, sourceMap = false) { return `${PLUGIN_ROUTE}/${comboSearch(ids, rev, sourceMap)}`; }
function comboReference(ids, rev, sourceMap = false) { return comboUrl(ids, rev, sourceMap).slice(1); }  // doc-relative
```

* Combo URLs share a 3 KiB budget (`MAX_COMBO_URL_BYTES = 3 * 1024`, `lib/index.js:161`) and are
  partitioned automatically. `HEAD` returns headers without materialising bodies
  (`fetchBundle`, `lib/index.js:580-587`).
* Revisions are **metadata-derived** (`mtimeMs`/`ctimeMs`/`size`, `artifactRevision`, `lib/index.js:193-199`),
  not content hashes. Responses are `cache-control: immutable`.
* Graph cycles from `external` are rejected at composition (`orderByModuleGraph`, `lib/index.js:415-437`):
  `client-modules: module graph cycle ... — a requested package row must precede its consumers, and factory-form CJS cannot deliver partial exports`.
* A row must not declare its own package in `external` (`lib/index.js:428`).
* **Source maps**: `SOURCE_MAP_TRAILER = /(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/`
  (`lib/index.js:165`). The author's trailer is **stripped** and an Indexed Source Map v3 is composed
  from `<clientPath>.map` (`readSourceMap`, `lib/index.js:270-282`); a **missing `.map` is fine** and
  yields an identity section map (`identitySectionMap`, `lib/index.js:306-316`). The composed script
  gets a fresh `//# sourceMappingURL=<combo-url>` (`comboScript`, `lib/index.js:266-268`).
* **Lazy chunks**: a bundle may `require.async("./client.<name>.js")`; the host serves
  `/plugins/<pkg>/client.<name>.js?rev=<rev>` on demand. Chunk filenames must match
  `CLIENT_CHUNK = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/` (`lib/index.js:169`, `client.js:470`).

### 1.5 The web shell (`dsh-host-frontend-static`, `dsh-web-frontend`)

`@deepseek-ai/dsh-host-frontend-static/README.zh.md:42-44` — dist root + configured index serve the
SPA with a unique `<base href="./">` **before every injected resource row**, so both a root mount and a
stripped-prefix mount work. `README.zh.md:46` — index responses call `ctx.connection.authorizeIndex`;
non-index assets are public.

The injected rows are produced by `bootInjections` (`@deepseek-ai/dsh-client-modules/lib/index.js:453-498`):

```js
const queue = `(()=>{
const pendingQueue=[]
window.__ModuleLoader__={
  mode:"queue",
  pendingQueue,
  load(registration){pendingQueue.push(registration)},
  create(options){
    if(this.mode!=="queue")throw new Error("client-modules: window.__ModuleLoader__.create called after module-system boot")
    const index=pendingQueue.findIndex(registration=>registration.id===${JSON.stringify(CLIENT_MODULES_ID)})
    const registration=pendingQueue[index]
    if(registration===undefined)throw new Error("client-modules: HTML did not preload ${CLIENT_MODULES_ID}/client.js")
    pendingQueue.splice(index,1)
    const exports=registration.factory(specifier=>{ throw new Error('...requested external "'+specifier+'" before the module system existed') })
    if(typeof exports!=="object"||exports===null||typeof exports.createClientModuleSystem!=="function"||typeof exports.apply!=="function"){
      throw new Error("client-modules: ${CLIENT_MODULES_ID}/client.js did not export the bootstrap module face")
    }
    return exports.createClientModuleSystem(this,{id:registration.id,exports},options)
  }
}
})()`;
// rows: queue <script> → application <script-preload> → bootstrap <script-src> → {kind:"global", name:"__DSH_BOOT__", value: graph}
```

Boot manifest row shape (`graphRow`, `lib/index.js:394-404`):

```js
function graphRow(id, rev, fields) {
    return { id, url: comboReference([id], rev), rev,
        ...fields.inject     !== void 0 ? { inject: fields.inject } : {},
        ...fields.immediately ? { immediately: true } : {},
        ...fields.external.length > 0 ? { external: fields.external } : {} };
}
```

---

## 2. Exact file format of a client bundle

### 2.1 The wrapper

Every bundle is a **classic script** (not ESM, no `<script type=module>`) whose only top-level effect
is a registration:

```js
window.__ModuleLoader__.load({
  id: "<package name>",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    /* ... module body, CSS injection, requires ... */
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
```

### 2.2 What `id` must be — **the package name**

Exact rule, `@deepseek-ai/dsh-client-modules/lib/index.js:89-100`:

```js
/**
* Normalize a module specifier onto the graph row that owns it: a plugin bundle
* IS its package's client half, so `<id>/client` (the exports subpath external
* bundles emit) and the bare package name resolve to the same exports. ...
*/
function stripClientSuffix(spec) { return spec.endsWith("/client") ? spec.slice(0, -7) : spec; }
```

and the browser `register()` (`lib/client.js:568-581`):

```js
register(registration) {
    const ownerId = stripClientSuffix(registration.id);
    if (registration.chunk !== void 0 && !CLIENT_CHUNK.test(registration.chunk)) throw new Error(`client-modules: invalid package-local chunk ${JSON.stringify(registration.chunk)}`);
    const id = registration.chunk === void 0 ? ownerId : chunkId(ownerId, registration.chunk);
    if (this.bootstrapIds.has(id) || this.factories.has(id)) {
        const registrationName = registration.chunk === void 0 ? registration.id : id;
        throw new Error(`client-modules: duplicate factory registration for "${registrationName}" (bundle executed twice without invalidate?)`);
    }
    this.factories.set(id, {
        factory: registration.factory,
        rev: this.reloadTargets.get(ownerId)?.rev ?? this.graphRows.get(ownerId)?.rev
    });
}
```

The entry itself is created by name only — `lib/client.js:352-361`:

```js
/** Keep ownership even when Loader rejects a module's plugin exports after inserting its entry. */
async create(loader, id) {
    const options = { name: id };          // ← id === package name
    const entryId = loader.ensureId(options);
    try { await loader.create(options); }
    finally { this.managed.set(id, loader.resolve(entryId)); }
}
```

Mismatch symptom, verbatim (`lib/client.js:625`):
`client-modules: could not load "<id>": <url>: loaded without registering "<id>" via __ModuleLoader__.load`.

In-tree confirmation by a third-party author
(`/Users/zhz/.dsh/profiles/desktop/node_modules/@zhz8888/dsh-radeon-cloud-patcher/client/client.js:25`):

```js
  // 必须等于 package.json 的 name —— DSH 按包名给客户端模块建表，写错会「加载了却没注册」。
  id: '@zhz8888/dsh-radeon-cloud-patcher',
```

### 2.3 What `require` can resolve

`makeRequire` (`lib/client.js:697-715`) — resolution order, verbatim:

```js
makeRequire(ownerId, edges) {
    const require = (spec) => {
        edges.add(spec);
        if (this.seed.has(spec)) return this.seed.get(spec);
        const id = stripClientSuffix(spec);
        const record = this.loadCache.get(id);
        if (record !== void 0) return record.exports;
        if (this.factories.has(id)) return this.materialize(id).exports;
        throw new Error(`client-modules: require("${spec}") missed the module table — not a platform seed word, not a materialized module, and no registered package factory (a build-time externals drift, or a dynamic dependency that did not arrive)`);
    };
    require.async = async (spec) => {
        edges.add(spec);
        if (!spec.startsWith("./")) return await this.import(spec);
        const fileName = spec.slice(2);
        if (!CLIENT_CHUNK.test(fileName)) throw new Error(`client-modules: invalid relative chunk request ${JSON.stringify(spec)}`);
        return await this.importChunk(ownerId, fileName);
    };
    return require;
}
```

So `require` resolves, in order: **(1)** the frozen platform seed table, **(2)** an already-materialised
module (by bare name or `<name>/client`), **(3)** a registered dynamic factory, **(4)** otherwise throws.

**The platform seed table** — the shell's `staticModules` argument, found verbatim in the built SPA
`/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-5SrrfWpU.js`:

```js
function rM(){return{
  "react":Ef,
  "react/jsx-runtime":If,
  "react-dom":Rf,
  "react-dom/client":Df,
  "@deepseek-ai/cordis":sf,
  "@deepseek-ai/dsh-client-store":lh,
  "@deepseek-ai/dsh-client-ui-slots":hh,
  "@deepseek-ai/dsh-client-ui-primitives":sE,
  "@deepseek-ai/dsh-client-ui-dockkit":XS
}}
```

Nine specifiers. **Everything else must be requested through a dynamic package row** — either via
`dsh.client.inject` (hard edge, topologically ordered at composition) or `dsh.client.external`
(edge recorded, but resolved lazily at require time).

Notes:
* `@deepseek-ai/dsh-client-ui-slots`, `dsh-client-store` and `dsh-client-ui-primitives` have **no**
  `dsh.client` and no `exports["./client"]` — they are shell-internal static modules.
  Verified: `python3 -c "import json; print(json.load(open('dsh-client-ui-slots/package.json'))['dsh'])"` → `None`.
* `@deepseek-ai/dsh-client-ui-primitives` ships the practical widget kit: `SettingsForm`, `SettingsFormModel`,
  `SettingsValueField`, `SettingsSecretField`, `settingsNumberField`, `settingsTextField`, `Button`,
  `Switch`, `SegmentedControl`, `Modal`, `Toast`, and ~200 `Icon*` exports
  (`dsh-client-ui-primitives/lib/index.js:12381`).
* **No Node builtins.** Nothing resolves `node:*`, `fs`, `path`, etc.; the bundle is a browser classic
  script. (`makeRequire` has no such branch and will throw.)
* **`import()` is not available** inside the factory — the wrapper is CJS. Use `require(...)` synchronously
  and `require.async("./client.x.js")` for code-splitting.

### 2.4 What the factory must return

A CJS exports object. The Loader treats it as a Cordis plugin:

| Export | Required | Meaning |
|---|---|---|
| `apply(ctx)` | **yes** | Plugin body. |
| `inject` | effectively yes | Array of Cordis **service names** (strings). Note the hard-fail rule in §3.4. |
| `name` | no | Diagnostic identity (e.g. `exports.name = 'radeon-cloud-client'`; `dsh-market`). |
| `Config` | no | A Schemastery schema — but see §10: it does **not** generate a UI page. |

### 2.5 CSS injection — **manual**, and ownership-tagged

CSS is not a first-class concept. Two mechanisms matter:

**(a) Author-side injection.** The generated convention (tsdown/rolldown output) is
`@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js:11-19`:

```js
const css = ".GJZ99a_section{...}";
const tagId = "@deepseek-ai/dsh-client-ui-settings-plugins/PluginsSettingsSection.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
    const tag = document.createElement("style");
    tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-settings-plugins";   // data-plugin
    tag.dataset.pluginCss = tagId;                                        // data-plugin-css
    tag.textContent = css;
    document.head.appendChild(tag);
}
```

Same pattern in every third-party bundle, e.g.
`dsh-better-sidebar/lib/client.js:30086`:
```js
const tagId = "dsh-better-sidebar/layout.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) { ... }
```

The `data-plugin-css` guard is **idempotence across HMR/re-materialisation**; the `data-plugin`
attribute is **ownership**.

**(b) Framework-side style reclamation.** On materialisation the module system claims every *untagged*
`<style>` in the document and stamps it with the owning package id; on teardown it removes them.
`lib/client.js:487-498`:

```js
/**
* Claim and inventory the <style> tags a factory injected during
* materialization: preset-emitted tags arrive pre-tagged with data-plugin;
*/
const claimStyles = (id) => {
    if (typeof document === "undefined") return [];
    for (const el of document.querySelectorAll("style:not([data-plugin])")) el.setAttribute("data-plugin", id);
    const owned = [];
    for (const el of document.querySelectorAll(`style[data-plugin=${JSON.stringify(id)}]`)) owned.push(el.getAttribute("data-plugin-css") ?? id);
    return owned;
};
```
```js
/** Remove styles after their plugin's effect cleanup has settled. */
function removeOwnedStyles(id) {
    if (typeof document === "undefined") return;
    for (const el of document.querySelectorAll("style[data-plugin]")) if (el.getAttribute("data-plugin") === id) el.remove();
}
```

**So: always set both `tag.dataset.plugin = "<your package name>"` and `tag.dataset.pluginCss = "<unique tag id>"`,**
or (safer) register the tag through `ctx.effect(...)` with an explicit disposer — the pattern used by
`@zhz8888/dsh-radeon-cloud-patcher/client/client.js:44-56`:

```js
function apply(ctx) {
  if (typeof document === 'undefined') return
  ctx.effect(function () {
    var existing = document.getElementById(STYLE_ID)
    var style = existing === null ? document.createElement('style') : existing
    style.id = STYLE_ID
    style.textContent = CSS
    if (existing === null) document.head.append(style)
    return function () { style.remove() }
  })
}
```

### 2.6 Source maps

Optional. Ship `lib/client.js.map` next to the bundle if you want debugging; the host reads it only when
the composed map URL is requested, validates `version === 3`, `sources: string[]`, `names: string[]`,
`mappings: string` (`readSourceMap`, `lib/index.js:270-282`) and **relocates `sources` against
`/plugins/<pkg>/client.js.map`** for the combo (`comboSectionMap`, `lib/index.js:290-305`). Without a
`.map`, an identity map is synthesised; the bundle still works. The author's own
`//# sourceMappingURL=` trailer is stripped and replaced — do not rely on it.

### 2.7 Minimal real hand-written bundle (the whole file, 62 lines)

`/Users/zhz/.dsh/profiles/desktop/node_modules/@zhz8888/dsh-radeon-cloud-patcher/client/client.js`:

```js
window.__ModuleLoader__.load({
  // 必须等于 package.json 的 name —— DSH 按包名给客户端模块建表，写错会「加载了却没注册」。
  id: '@zhz8888/dsh-radeon-cloud-patcher',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var STYLE_ID = 'dsh-radeon-cloud-hide-custom-tag'
    var CSS = 'li:has(button[aria-label*="(radeon-cloud)"]) span[class*="rowTag"]{display:none !important}'

    function apply(ctx) {
      if (typeof document === 'undefined') return
      ctx.effect(function () { /* … style injection … */ })
    }

    exports.name = 'radeon-cloud-client'
    exports.apply = apply
    return module.exports
  },
})
```

A larger hand-written one (429 lines, comments explicitly justifying skipping the bundler):
`/Users/zhz/.dsh/profiles/desktop/node_modules/dsh-tabbit/client/client.js:1-22`.

---

## 3. Client plugin lifecycle

### 3.1 `apply(ctx)`

A standard Cordis plugin body. `ctx` is a Cordis `Context` whose fiber is the page Loader entry named
after the package. Everything you register should be inside `ctx.effect(...)` so unload cascades.

### 3.2 `ctx.inject(services, callback)` — Cordis service wait (**not** slots)

`ctx.inject([...serviceNames], childCtx => {...})` creates a **child fiber** that waits for those
services. This is the version-tolerant form used to reach optional services.

Real usage, `/Users/zhz/.dsh/profiles/desktop/node_modules/@opencode2dsh/dsh-plugin/lib/client.js:1442-1482`:

```js
/**
* Required services (cordis fiber inject).
*
* Only stable services gate the main fiber. configForms is requested in a
* separate fiber and owns the settings contribution's served lifetime.
*/
const inject = ["slots", "locale"];

function apply(ctx) {
    const t = ctx.locale.bind(NS);
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), "opencode2dsh: copy dictionaries");
    const slots = ctx.slots;
    ctx.inject(["configForms"], (formCtx) => {
        formCtx.effect(() => formCtx.configForms.whileServed([SETTINGS_NAMESPACE], () => {
            const row = slots.inject("plugins.row.config", () => {
                const disposers = ["@opencode2dsh/dsh-plugin", "opencode2dsh"].map((pkg) => slots.register({
                    name: "plugins.row.config",
                    key: `${pkg}#${SETTINGS_NAMESPACE}`,
                    locale: NS
                }, IpPoolCard));
                return () => { for (const dispose of disposers) dispose(); };
            });
            const legacy = slots.inject("plugins.item", () => { ... });
            return () => { row(); legacy(); };
        }), "opencode2dsh: settings page");
    });
}
```

**Rule (load-bearing, from a real regression).** `dsh-web-search-free/dist/client.js:646-670`:

```js
 * NEITHER may be named in the top-level `inject`. A service the host does not
 * provide leaves the entry PENDING forever, and web boot treats an entry that
 * did not activate as FATAL — it throws `web boot: 1 entry did not activate`
 * and the whole UI stops at "Failed to load plugins". One optional service
 * would therefore take dsh down, which is exactly what 0.1.7-alpha.1 did to
 * this plugin. A child `ctx.inject()` fiber is the version-tolerant form: it is
 * not a loader entry, so a wait that never resolves costs nothing.
```

Verified in the built shell (`dsh-web-frontend/dist/assets/index-5SrrfWpU.js`):

```js
if(o.length>0)throw new Error(`web boot: ${String(o.length)} entr${o.length===1?"y":"ies"} did not activate
${o.join(`
`)}`);
// per entry: `${a}: pending (waiting for service${f.length===1?"":"s"}: ${f.join(", ")||"unknown"})`
```

### 3.3 The `slots` API lives on `ctx.slots` — two different `inject`s

| Call | Owner | Semantics |
|---|---|---|
| `ctx.inject([svc], cb)` | Cordis | wait for **services** |
| `ctx.slots.inject(slotName, cb)` | `SlotRegistry` (`ui-renderer`) | wait for a **slot declaration**; `cb` returns a disposer |
| `ctx.slots.register(opts, Component)` | `SlotRegistry` | register into a **declared** slot; throws if undeclared |

### 3.4 Services available on the client `ctx`

Services are Cordis services; reach them by naming them in the fiber `inject` array (hard) or a child
`ctx.inject` (soft). Names confirmed in this bundle:

| Service name | Package | Notes / evidence |
|---|---|---|
| `slots` | `@deepseek-ai/dsh-client-ui-renderer` | `SlotRegistry`; `super(ctx, "slots")` at `dsh-client-ui-renderer/lib/client.js:1323` |
| `locale` | `@deepseek-ai/dsh-client-locale` | `register`, `bind`, `getSnapshot`, `subscribe`, `resolveText`, `addLanguage`, `setLocale` |
| `configForms` | `@deepseek-ai/dsh-client-ui-settings` | `super(ctx, "configForms")` at `dsh-client-ui-settings/lib/client.js:1284` |
| `settingsSchema` | `@deepseek-ai/dsh-client-ui-settings` | `super(ctx, "settingsSchema")` at `:926` |
| `remote` (+ `remote.settings`, `remote.pluginInventory`, …) | `@deepseek-ai/dsh-api-remotes` | `ctx.remote.$host.isLoopback`, `ctx.remote.$on(event, cb)`, `ctx.remote.settings.mutate/describe` |
| `modules` | `@deepseek-ai/dsh-client-modules` | `ctx.modules.entries.state`, `.retry()`; used by `ui-settings-plugin-inventory` |
| `connection` | `@deepseek-ai/dsh-client-connection` | `ctx.remote.$on("settings/document-updated")` + `connection/reset` are the invalidation pair |
| `theme` | `@deepseek-ai/dsh-client-ui-theme` | `ctx.theme.getTheme()` |
| `logger` | Cordis built-in | `ctx.logger.error(...)` (`dsh-client-modules/lib/index.js:698`) |
| `effect` | Cordis built-in | `ctx.effect(fn, label)`; `fn` returns a disposer, or `async () => async () => {}` |
| `reflect` | Cordis built-in | `ctx.reflect.get("locale")` — the read that returns `undefined` instead of throwing; `ctx.reflect.provide(faceName, value)` |

Not every service is injectable at every DSH release. The version-tolerant ladder in
`dsh-web-search-free/dist/client.js:671-702` is the canonical pattern:

```js
const SCOPE_PROVIDERS = [
    // dsh >= 0.1.7
    { services: ["configForms"], bind: (ctx) => ctx.configForms.get(NAMESPACE) },
    // dsh <= 0.1.6
    { services: ["settingsScope", "connection", "remote"], bind: (ctx) => ctx.settingsScope.bind({ namespace: NAMESPACE }) },
];
exports.inject = ["slots"];
function apply(ctx) {
    let claimed = false;
    for (const provider of SCOPE_PROVIDERS) {
        ctx.inject(provider.services, (sctx) => {
            if (claimed) return;
            claimed = true;
            mountCard(sctx, provider.bind(sctx));
        });
    }
    const timer = setTimeout(() => { if (!claimed) console.warn(`[${NAMESPACE}] no settings service found: ...`); }, 5000);
    ctx.effect(() => () => clearTimeout(timer));
}
```

---

## 4. Slots — full API

### 4.1 `ctx.slots.inject(key, callback)` — verbatim

`@deepseek-ai/dsh-client-ui-renderer/lib/client.js:1328-1402`:

```js
/**
* Install an effect for each declaration lifetime of a slot. The callback
* runs synchronously when the declaration already exists; otherwise it runs
* inside the declaring `register()` call after the declaration is committed.
* Collapse disposes the effect and a later declaration runs it again.
* Callback effects are synchronous disposers; iterable effects install
* transactionally and dispose in reverse order. The controller belongs to the
* caller's fiber, so plugin unload cancels a pending wait and removes any
* active contribution.
*
* @param key - declared SlotMap key to depend on.
* @param callback - creates one disposer or an iterable of disposers.
* @returns idempotent disposer for the wait and active effect.
* @throws callback setup failures synchronously when the slot is already declared.
*/
inject(key, callback) {
    const ctx = this.ctx;
    const disposeController = ctx.effect(() => {
        let active; let activeEpoch; let stopped = false; let unsubscribe = () => {};
        const stop = () => { ... };
        const reconcile = () => {
            if (stopped) return;
            const spec  = this._core.specDynamic(key);
            const epoch = this._core.declarationEpoch(key);
            if (active !== void 0 && activeEpoch === epoch) return;
            const dispose = active; active = void 0; activeEpoch = void 0;
            dispose?.();
            if (spec === void 0) return;
            const disposeEffect = ctx.effect(callback, `slots.inject(${JSON.stringify(key)}): declaration`);
            active = () => { disposeEffect(); };
            activeEpoch = epoch;
        };
        const changed = () => { try { reconcile(); } catch (error) { ... } };
        unsubscribe = this._core.subscribeDeclaration(key, changed);
        try { reconcile(); } catch (error) { stop(); throw error; }
        return stop;
    }, `slots.inject(${JSON.stringify(key)})`);
    return () => { disposeController(); };
}
```

**Key consequences**
* Calling `ctx.slots.inject("some.slot", ...)` for a slot nobody declares is **free** — it just waits.
* `ctx.slots.register({...})` for an **undeclared** slot **throws**:
  `slot "<name>" is not declared (a parent entry's children table must declare it)` (`ui-slots/lib/index.js:165`).
* Registration therefore **must** happen inside the `inject` callback (or after checking
  `ctx.slots.spec(name) !== undefined`).

### 4.2 `ctx.slots.register(options, Component)` — options

Prototype method so the Cordis service proxy binds `this.ctx` to the **caller's** context
(`ui-renderer/lib/client.js:1788-1791`):

```js
SlotRegistry.prototype.register = function register(rawOptions, component) {
    const options = rawOptions;
    return this.ctx.effect(() => this["_register"](options, component), "slots.register()");
};
```

`_register` (`ui-renderer/lib/client.js:1577-1598`) mints the store handle, stamps `registrant` from
`this.ctx.fiber?.name`, and writes to `SlotCore.register`.

Option surface (from `SlotCore.register`, `ui-slots/lib/index.js:163-243`, plus `_register`):

| Option | Type | Applies to | Semantics |
|---|---|---|---|
| `name` | string | **all** | Slot key; must equal the key you are registering into. Required (the core looks up `records.get(options.name)`). |
| `id` | string | `list` (**required**), also `keyed`-adjacent owners | Cell key. A fresh id is *added beside* shipped entries; reusing a shipped id *replaces* that cell. |
| `key` | string | `keyed` (**required**) | Cell key for keyed slots. |
| `order` | number | `list` | Ascending within the cell (default 0). `next.sort(... (a.options.order ?? 0) - (b.options.order ?? 0))` — `ui-slots/lib/index.js:221`. |
| `label` | `string \| () => string` | `list` owners that project labels | Display text. **A thunk is re-read on every projection**, so localized text follows the active locale without re-registering. Owners must call `resolveSlotLabel(label)` to unwrap it. |
| `priority` | number | all | Shadowing priority; **lowest (first) wins**. Registering the same cell at the same priority throws: `single slot "X" already has a registration at priority 0 — register at a different priority to shadow it (lowest renders)`. |
| `inject` | `() => object` | all | The business share: returned props are spread onto the Component (`...kit, ...injected, ...slotInjected.props, ...ownerProps` — `ui-renderer/lib/client.js:763-777`). Also may return `{ hooks: {name: {getSnapshot, subscribe}} }` and `{ actions }`. |
| `children` | `Record<string, {kind, scope}>` | container entries | **Declares** child slots. Declaration is a claim: nobody else may declare the same key. Disposal cascades and collapses them. |
| `store` | handle `\| () => handle` | all | Store seat. A function is a **factory**: one handle per rendered occurrence. |
| `locale` | string | all | Locale namespace. When set, the framework adds a `t` prop bound to that namespace (`standardKit`, `ui-renderer/lib/client.js:721-725`). Without a locale face installed it throws `entry declares locale namespace 'X' but no locale face is installed`. |
| `select` | fn | `chain` (**required**) | Election selector. |
| `registrant` | string | internal | Diagnostics stamp; auto-filled from `ctx.fiber?.name` by `_register`. |

Validation errors, verbatim (`ui-slots/lib/index.js:163-190`):

```js
register(options, component) {
    const rec = this.records.get(options.name);
    if (!rec?.spec) throw new Error(`slot "${options.name}" is not declared (a parent entry's children table must declare it)`);
    const spec = rec.spec;
    const priority = options.priority ?? 0;
    const occupantHint = (occupant) => `at priority ${priority}${occupant.registrant !== void 0 ? ` (registered by ${occupant.registrant})` : ""} — register at a different priority to shadow it (lowest renders)`;
    switch (spec.kind) {
        case "single": { const occupant = rec.entries.find((e) => (e.options.priority ?? 0) === priority);
            if (occupant) throw new Error(`single slot "${options.name}" already has a registration ${occupantHint(occupant)}`); break; }
        case "keyed": { if (options.key === void 0) throw new Error(`keyed slot "${options.name}" requires options.key`); ... break; }
        case "list":  { if (options.id  === void 0) throw new Error(`list slot "${options.name}" requires options.id`); ... break; }
        case "chain": if (options.select === void 0) throw new Error(`chain slot "${options.name}" requires options.select`); break;
    }
    ...
}
```

### 4.3 The four `kind`s

`@deepseek-ai/dsh-client-ui-slots/README.zh.md:28`:

> 四种 kind 覆盖组合形态——`single`（单个占位者）、`list`（有序条目）、`keyed`（按键分派）与 `chain`（条目自行提名）。

* `single` — one occupant per priority.
* `list` — ordered entries; requires `id`; sorted by `(priority, order)`; owners project
  `ctx.slots.entries(key)` (raw, registration sequence) or `entriesOfSlot(key)` (per-cell winners).
* `keyed` — one entry per `key` per priority; the owner *dispatches* a key.
* `chain` — entries self-nominate via `select`; first non-null by ascending `priority` wins.

### 4.4 "list" slots and `scope`

A slot spec is `{ kind, scope }`. `scope` is one of `"root"`, `"session"`, `"session-maybe"`.
**All settings slots are `{ kind: "list", scope: "root" }`** — they render once, outside any session.
The built-in `root` slot is seeded in the constructor (`ui-slots/lib/index.js:64-72`):

```js
constructor() {
    const root = this.record("root");
    root.spec = { kind: "single", scope: "root" };
    root.declaredBy = "(built-in)";
    root.declarationEpoch = 1;
}
```

`scope` has real render consequences (`ui-renderer/lib/client.js:735-739`): declaring a non-root child
forces a `SessionProvider` seat and requires an installed `session` scope adapter:
`throw new SlotAssemblyError("entry declares a session child without an installed 'session' scope adapter")`.
**For settings pages you always want `scope: "root"`.**

### 4.5 What props the registered React component receives

`ui-renderer/lib/client.js:747-789` — the exact composition (owner wins):

```js
/**
* One rendered entry: standard kit + cached entry inject + common slot inject
* + owner props (owner wins). ...
*/
function ContextualEntry({ slotKey, Comp, kit, standard, injected, slotInjected, ownerProps, hookContext, hasHookContext }) {
    const contextual = react.useMemo(() => {
        if (!hasHookContext) throw new SlotAssemblyError(`slot '${slotKey}' has contextual injected Hooks but no hookContext`);
        return bindSlotHookFactories(slotInjected.slotHookFactories, standard, hookContext);
    }, [hasHookContext, hookContext, slotInjected.slotHookFactories, slotKey, standard]);
    return react_jsx_runtime.jsx(Comp, { ...kit, ...injected, ...slotInjected.props, ...contextual, ...ownerProps });
}
```

`standardKit` (`ui-renderer/lib/client.js:715-746`) supplies:

```js
function standardKit(host, entry, scope, rootBinding, scopeBinding) {
    const standard = standardProps(scope, rootBinding, scopeBinding);
    const kit = { ...standard, renderFactorySlot: boundRenderFactorySlot(entry) };
    if (entry.locale !== void 0) {
        const face = host.locale;
        if (face === void 0) throw new SlotAssemblyError(`entry declares locale namespace '${entry.locale}' but no locale face is installed (locale plugin missing from the composition?)`);
        kit["t"] = localeSeat(face, entry.locale);
    }
    const scopedStoreBinding = scopeBinding?.key === void 0 ? void 0 : scopeBinding;
    const store = host.storeOf(entry, scopedStoreBinding);
    if (store !== void 0) { kit["useStore"] = observableHook(store); kit["actions"] = store.actions; }
    if (entry.children !== void 0) {
        kit["renderSlot"] = boundRenderSlot(host, entry);
        if (Object.values(entry.children).some((spec) => spec.kind === "chain")) kit["renderSlotChain"] = boundRenderSlotChain(host, entry);
        if (Object.values(entry.children).some((spec) => spec.scope !== "root")) { ... kit["SessionProvider"] = scopeAreaProvider(adapter); }
    }
    return { kit, standard, actions: store?.actions };
}
```

So a settings-section component receives, in order of increasing precedence:

| Group | Props |
|---|---|
| standard (from `provideRoot` contributions) | `useSessions`, `useWorkspaces`, `useResource`, `usePanelInfo`, `useSessionStatus`, `useSessionRetainInfo`, `useSession`, `useChat`, `useConversation`, `useInput`, `inputActions`, `sessionId`, `useProjection`, `useTrajectory` — **only the ones declared for that slot** (see the catalog's `standardProps` in §11) |
| always | `renderFactorySlot` |
| if `locale` set | **`t`** — a stable-per-(ns, revision) translate function |
| if `store` set | `useStore`, `actions` |
| if `children` declared | **`renderSlot(key, ownerProps?, opts?)`**, `renderSlotChain(...)`, maybe `SessionProvider` |
| `inject()` | whatever your face returns, plus `hooks`-derived `use<Name>` selectors |
| slot-level inject | framework-provided common props |
| **owner props** | what the *rendering owner* passes. For `settings.section` that is **`{ close: () => void }`** |

`t` is minted per namespace **and per locale revision** so `React.memo` works
(`ui-renderer/lib/client.js:513-538`):

```js
const localeSeatCache = new WeakMap();
function localeSeat(face, ns) {
    let perNs = localeSeatCache.get(face);
    if (!perNs) { perNs = new Map(); localeSeatCache.set(face, perNs); }
    const revision = face.getSnapshot().revision;
    const cached = perNs.get(ns);
    if (cached && cached.revision === revision) return cached.t;
    const bound = face.bind(ns);
    const t = (key, params) => bound(key, params);
    perNs.set(ns, { revision, t });
    return t;
}
```

`renderSlot` (`ui-renderer/lib/client.js:325-344`) is per-entry and **ownership-enforced**:

```js
binding = (key, owner, opts) => {
    if (!host.isLive(entry)) throw new StaleAuthorizationError(`renderSlot('${key}') from a disposed registration`);
    const declared = entry.children?.[key];
    if (declared === void 0) throw new SlotOwnershipError(...);   // key not in your children declaration
    if (declared.kind === "chain") throw new SlotOwnershipError(`slot '${key}' is declared 'chain' — use renderSlotChain`);
    return <Outlet ... ownerProps: owner, ...opts />;
};
```

`opts` supports `{ only: <id|key> }` — the filter used to render exactly one list cell
(e.g. `renderSlot("settings.plugins.tab", {}, { only: single.id })`).

---

## 5. The settings slot types

### 5.1 `settings.section` — the nav-page slot

Declared as a child of the settings shell's own entry, which
`@deepseek-ai/dsh-client-ui-settings-general` registers into the **`sidebar.settings`** seat
(`lib/client.js:1088` `ctx.slots.inject("sidebar.settings", ...)`, `:1141-1176` `ctx.slots.register({ name: "sidebar.settings", ..., children: {...} })`).
Its `settings.section` child spec is verbatim (`lib/client.js:1166-1169`):

```js
"settings.section": {
    kind: "list",
    scope: "root"
},
```

…so the catalog's `declaredBy` reads
`"an entry in 'sidebar.settings' (client-ui-settings-general), so it exists while that entry is mounted"`.
Rendering (`dsh-client-ui-settings-general/lib/client.js:365-367`):

```js
(0, react_jsx_runtime.jsx)("div", {
    className: SettingsRoot_module_css_default.options,
    children: active !== void 0 && renderSlot("settings.section", { close: onClose }, { only: active })
})
```

Nav projection (`:1046-1070`):

```js
sections: {
    getSnapshot: () => {
        const version  = ctx.slots.getVersion("settings.section");
        const revision = ctx.locale.getSnapshot().revision;
        if (version !== rowsVersion || revision !== rowsRevision) {
            rowsVersion = version; rowsRevision = revision;
            rows = ctx.slots.entries("settings.section").map((e) => ({
                id:    e.options.id ?? "",
                order: e.options.order ?? 0,
                label: resolveSlotLabel(e.options.label) ?? ""
            })).sort((a, b) => a.order - b.order);
        }
        return rows;
    },
    subscribe: (listener) => {
        const offLedger = ctx.slots.subscribe("settings.section", listener);
        const offLocale = ctx.locale.subscribe(listener);
        return () => { offLedger(); offLocale(); };
    }
},
```

Catalog entry (`dsh-cordis-client-runner/lib/client.js:4710-4759`, `source: packages/client/ui-settings/src/client/contract/slots.ts:57`):

```
key: "settings.section"   kind: "list"   scope: "root"
summary: "One settings page per list entry."
doc: "One settings page per list entry. Registrant options carry the nav
identity: `id` (section key, drives `only` filtering), `order` (nav
position), `label` (registrant-localized display text — the registrant
re-registers with fresh text on locale change, so the shell never
subscribes locale state; the ledger bump doubles as the shell's
re-render trigger). Sections render inside the panel content column."
registerOptions: id (required, string), order (optional, number), label (optional, string | (() => string))
ownerProps: "export interface SettingsSectionOwnerProps { /** Close the settings panel (the shell owns the open state). */ close: () => void }"
declaredBy: "an entry in 'sidebar.settings' (client-ui-settings-general), so it exists while that entry is mounted"
occupants: agent-presets / account / general / models / plugins
replaceRisk: "none"
example: "return {\n  inject: ['slots'],\n  apply(ctx) {\n    ctx.slots.inject('settings.section', () => ctx.slots.register(\n      { name: 'settings.section', id: 'my-entry', order: 100, label: 'My entry' },\n      () => React.createElement('div', null, 'hello'),\n    ))\n  },\n}"
```

**Shipped occupant ids/orders** (so you can place yourself): `general` order 0
(`ui-settings-general/lib/client.js:1201-1211`), `models` order 10
(`ui-settings-models/lib/client.js:4059-4075`), `agent-presets`
(`dsh-client-ui-agent-preset/lib/client.js:1685`, order 20), `account` (`ui-settings-account/lib/client.js:4558`),
**`plugins` order 15** (`ui-settings-plugins/lib/client.js:201-212`), `commandcode` order 12
(`@mars-sea/dsh-commandcode-provider/lib/client.js:9776-9783`), `market` order 40
(`dshmarket/client/client.js:15569-15576`), `better-sidebar` order 100
(`dsh-better-sidebar/lib/client.js` tail).

### 5.2 `settings.plugins.tab` — the tab inside Built-in plugins

**Declared by the section owner**, not by you — `@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js:201-212`:

```js
ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "plugins",
    order: 15,
    label: () => t("nav"),
    locale: NS,                                  // "settings.plugins"
    inject: sectionInjected,
    children: { "settings.plugins.tab": {
        kind: "list",
        scope: "root"
    } }
}, PluginsSettingsSection));
```

The section renders your tab (`:52-128`; re-sugared to JSX from the compiled
`react_jsx_runtime.jsx/jsxs` calls — the shipped file is `jsx(...)`-form):

```js
rows.length === 0 ? <p className={...empty}>{t("empty")}</p>
 : single !== void 0 ? <div className={...panel}>{renderSlot("settings.plugins.tab", {}, { only: single.id })}</div>
 : <> <div className={...tabs} role="tablist" aria-label={t("tabs")}>
        {rows.map((row, index) => <button role="tab" ... onClick={() => setActiveId(row.id)}>{row.label}</button>)}
      </div>
      {rows.filter((row) => row.id === active || visitedIds.has(row.id)).map((row) => (
        <div role="tabpanel" hidden={row.id !== active}>{renderSlot("settings.plugins.tab", {}, { only: row.id })}</div>
      ))}
    </>
```

The row projection (`:176-200`) — note `resolveSlotLabel` for thunked labels:

```js
const sectionInjected = () => ({ hooks: { tabs: {
    getSnapshot: () => {
        const version  = ctx.slots.getVersion("settings.plugins.tab");
        const revision = ctx.locale.getSnapshot().revision;
        if (version !== tabsVersion || revision !== tabsRevision) {
            tabsVersion = version; tabsRevision = revision;
            tabs = ctx.slots.entries("settings.plugins.tab").map((entry) => ({
                id:    entry.options.id ?? "",
                order: entry.options.order ?? 0,
                label: resolveSlotLabel(entry.options.label) ?? ""
            })).sort((a, b) => a.order - b.order);
        }
        return tabs;
    },
    subscribe: (listener) => {
        const offLedger = ctx.slots.subscribe("settings.plugins.tab", listener);
        const offLocale = ctx.locale.subscribe(listener);
        return () => { offLedger(); offLocale(); };
    }
} } });
```

Catalog entry (`dsh-cordis-client-runner/lib/client.js:4664-4707`, `source: .../contract/slots.ts:66`):

```
key: "settings.plugins.tab"   kind: "list"   scope: "root"
summary: "One page inside the Plugins settings section."
doc: "One page inside the Plugins settings section. The section owner renders
localized entry labels as tabs and mounts each contribution inside its
corresponding tab panel. Options: `id` (tab key), `order` (tab order),
and `label` (registrant-localized tab text). Declared at runtime by the
feature that owns the Plugins section; the type lives here so inventory
and configuration plugins collaborate without depending on one another."
registerOptions: id (required), order (optional), label (optional)
ownerProps: "export interface SettingsPluginsTabOwnerProps { /** Marker field: tab owner props are intentionally empty. */ children?: never }"
declaredBy: "an entry in 'settings.section' (client-ui-settings-plugins), so it exists while that entry is mounted"
occupants: ["client-ui-settings-plugin-inventory PluginInventorySettingsTab id 'all'"]
replaceRisk: "none"
```

**Shipped occupant:** `ui-settings-plugin-inventory/lib/client.js:792-799` —

```js
ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
    name: "settings.plugins.tab",
    id: "all",
    order: 10,
    label: () => t("tab"),
    locale: NS,
    inject: injected
}, PluginInventorySettingsTab));
```

**Third-party occupant** — `dshmarket/client/client.js:15626-15639`:

```js
const pluginsTabCtx = ctx;
pluginsTabCtx.slots.inject("settings.plugins.tab", () => pluginsTabCtx.slots.register({
    name: "settings.plugins.tab",
    id: NS,                      // "dsh-market"
    order: 60,
    label: () => t("nav"),
    locale: NS,
    inject: () => ({ t })
}, () => (0, react.createElement)(SettingsCard, { t, onRemoved: () => { sectionGate.retire(); } })));
```

> **Gotcha:** with exactly **one** contribution the section renders it *as the page itself*; the tab row
> appears only from the second contribution onward (`rows.length === 1` branch). Adding a tab therefore
> *changes the built-in plugins page chrome* — if you want your own standalone nav entry, prefer
> `settings.section`; if you are configuring a **host-plane plugin entry**, register a `settings.section`
> page or (better) use the Plugins **sidebar page** slots below.

### 5.3 The other Plugins-page slots (sidebar `Plugins` page, `dsh-client-ui-plugin-manager`)

Declared at `@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js:3770-3800`:

```js
children: {
    "plugins.header.leading":   { kind: "single", scope: "root" },
    "plugins.overview":         { kind: "list",   scope: "root" },
    "plugins.bundle.hidden":    { kind: "keyed",  scope: "root" },
    "plugins.item.hidden":      { kind: "keyed",  scope: "root" },
    "plugins.bundle.actions":   { kind: "keyed",  scope: "root" },
    "plugins.item":             { kind: "list",   scope: "root" },
    "plugins.bundle.activation":{ kind: "keyed",  scope: "root" },
    "plugins.bundle.config":    { kind: "keyed",  scope: "root" },
    "plugins.row.config":       { kind: "keyed",  scope: "root" },
    "plugins.detail.actions":   { kind: "list",   scope: "root" },
    "plugins.detail.badge":     { kind: "list",   scope: "root" },
    "plugins.detail.section":   { ... },
    ...
}
```

Catalog summaries:

* **`plugins.item`** — `"One official plugin the Plugins page lists in its Official group after the official bundles: `label` is the card's title and `order` its place. The page renders the entry as the card's one-liner (`view: 'summary'`) and, once the card is opened, as the body of the plugin's own page (`view: 'page'`). OCCUPIED by the official settings pages, one companion package per host-plane namespace; a bundle's configuration belongs in `plugins.bundle.config` or `plugins.row.config` instead."` (catalog `source: packages/client/ui-plugin-manager/src/client/slot-contract.ts:88`)
* **`plugins.bundle.config`** — `"A bundle's own configuration, keyed by the bundle's package name and rendered on the bundle's page between its description and its rows (`view: 'page'` only)."` — `key` required.
* **`plugins.row.config`** — `"The configuration of one row a bundle declares, keyed by `<package name>#<row id>` ... an absent description falls back to the entry's `view: 'summary'`."`
* ownerProps for all three: `PluginConfigViewProps { readonly view: 'summary' | 'page'; readonly form?: ConfigPageForm | undefined }`

Canonical registrant, `@deepseek-ai/dsh-client-ui-settings-shell/lib/client.js:186-193`:

```js
ctx.effect(() => ctx.configForms.whileServed([BASH_NS, PWSH_NS, DESKTOP_PWSH_NS], (served) => ctx.slots.inject("plugins.item", () => ctx.slots.register({
    name: "plugins.item",
    id: "shell",
    order: 10,
    label: () => t("title"),
    locale: NS,
    inject: () => (served.has(DESKTOP_PWSH_NS) ? desktopPwsh : served.has(PWSH_NS) ? pwsh : bash).inject()
}, ShellCard))), "ui-settings-shell: page");
```

### 5.4 Full list of `settings.*` slot types

From the catalog (`dsh-cordis-client-runner/lib/client.js`): `settings.action` (:4327),
`settings.close` (:4373), `settings.general.item` (:4400), `settings.header` (:4459),
`settings.launcher` (:4486), `settings.models.footer` (:4513), `settings.models.provider-card` (:4559),
`settings.models.sign-in` (:4591), `settings.onboarding` (:4618), `settings.plugins.tab` (:4664),
`settings.section` (:4710), `settings.trigger` (:4762).

**Every slot in the shipped web bundle** is enumerated in `CLIENT_SLOT_API`
(`dsh-cordis-client-runner/lib/client.js:2363-...`) — read it directly for the current release:

```bash
grep -n 'key: "settings' \
  "/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-cordis-client-runner/lib/client.js"
```

---

## 6. Config forms API

Two Cordis services, both provided by `@deepseek-ai/dsh-client-ui-settings`.

### 6.1 `ctx.configForms` — `ConfigForms` service

`@deepseek-ai/dsh-client-ui-settings/lib/client.js:1257-1350`:

```js
/**
* The settings domain's base service. Features that own a preference reach the
* settings transport through this service rather than a shared function: ...
*/
var ConfigForms = class extends _deepseek_ai_cordis.Service {
    forms = new Map();
    developerTools; mirror; schema; persistence;
    /**
    * The PROVIDING fiber, kept because a Service reads `ctx` as its *consumer's*
    * fiber: letting a shared form write through the caller's context would make
    * every caller declare `remote.settings` in its own `inject`.
    */
    owner;
    constructor(ctx, config) {
        super(ctx, "configForms");
        this.mirror = config.mirror; this.schema = config.schema; this.persistence = config.persistence;
        this.owner = ctx;
        this.developerTools = new DeveloperToolsPreference(this.get(DEVELOPER_TOOLS_NAMESPACE));
        ctx.effect(() => async () => {
            await Promise.all([...this.forms.values()].map((form) => form.dispose()));
            this.forms.clear();
        }, "ui-settings: configuration forms");
    }
```

#### `describe()`

```js
/**
* The shared mirror's read/fold face for cross-namespace surfaces (schema
* introspection, the served-namespace directory). Per-namespace consumers
* use {@link get}; both derive from the same snapshot, so they can never
* disagree about the document.
* @returns the describe face over the shared mirror.
*/
describe() { return this.mirror; }
```

`this.mirror` is a `SettingsDescribeMirror` (`:1368-1496`) with API:

| Member | Signature | Notes |
|---|---|---|
| `getSnapshot()` | `() => { status, view, error }` | `status`: `"idle" \| "loading" \| "ready"? \| "unavailable"`; `view?: { writable: boolean, namespaces: SettingsNamespaceView[], hasDocument?: boolean }` |
| `subscribe(listener)` | `(fn) => unsubscribe` | snapshot-store subscription |
| `load()` | `() => Promise` | force a Host `settings.describe` re-read (serialised; concurrent calls fold) |
| `ensure()` | `() => Promise` | idempotent "have an answer yet" entry |
| `acceptView(view)` | `(namespaceView) => void` | fold one write answer in |
| `namespace(ns)` | `(ns) => SettingsNamespaceView \| undefined` | row lookup |

`SettingsNamespaceView` fields, `dsh-api-settings-controller/lib/index.js:273-288`:

```js
function namespaceView(descriptor) {
    return {
        ns: String(descriptor.ns),
        autoGenerate: descriptor.autoGenerate,
        schema: descriptor.schema,
        value: descriptor.value,
        ...descriptor.base === void 0 ? {} : { base: descriptor.base },
        ...descriptor.user === void 0 ? {} : { user: descriptor.user },
        applies: descriptor.applies,                              // "live"
        secrets: (descriptor.secrets ?? []).map((s) => ({ path: [...s.path], set: s.set })),
        revision: descriptor.revision
    };
}
```

Path-filtered reads use `dsh-tool-cordis`'s helpers:
```js
schemaService.getPath(value, ["a","b"])   settingsSchema.getPath
schemaService.hasPath(value, ["a","b"])   settingsSchema.hasPath
schemaService.nodeAtPath(schema, ["a"])   settingsSchema.nodeAtPath
```

#### `get(entryId)` → `ConfigFormController`

```js
/** Get the shared form values and write queue for one Host plugin entry.
* @param entryId Unique Host plugin entry id.
* @returns The entry's form, owned by this provider.
*/
get(entryId) {
    const existing = this.forms.get(entryId);
    if (existing !== void 0) return existing;
    const form = new ConfigFormController(this.owner, { namespace: entryId }, this.mirror, this.persistence, this.schema);
    this.forms.set(entryId, form);
    this.mirror.ensure();
    return form;
}
```

Repeated `get(id)` returns the **same** controller (`:1310-1311`). Controller API (`:1086-1256`):

```js
constructor(ctx, spec, mirror, persistence, schema) {
    ...
    this.store = createSnapshotStore({
        status:  persistence === "host" ? "loading" : "unavailable",
        value:   void 0,     // decoded, schema-validated namespace value
        base:    void 0,     // inherited (composition) layer
        user:    void 0,     // raw user-override layer
        revision: void 0,    // Host namespace revision
        writable: false,
        mode:    persistence // "host" | "memory"
    });
    if (persistence === "host") { this.unsubscribe = mirror.subscribe(() => { this.derive(); }); this.derive(); }
}
getSnapshot() { return this.store.getSnapshot(); }
subscribe(listener) { return this.store.subscribe(listener); }
set(field, value)          { return this.mutate([{ op: "set",   path: [field], value }]); }
unset(field)               { return this.mutate([{ op: "unset", path: [field] }]); }
mutate(ops, expectedRevision) {
    const ownedOps = structuredClone(ops);
    const generation = ++this.writeGeneration;
    return this.enqueue(async () => {
        const revision = expectedRevision ?? this.pendingRevision ?? this.getSnapshot().revision;
        const response = await this.ctx.remote.settings.mutate(this.spec.namespace, ownedOps, revision);
        if (!response.ok) { await this.recover(generation); return false; }
        if (this.disposed) return true;
        if (generation === this.writeGeneration) { this.pendingRevision = void 0; this.mirror.acceptView(response.value); }
        else this.pendingRevision = response.value.revision;
        return true;
    });
}
```

So: **snapshot shape** `{ status, value, base, user, revision, writable, mode }`
(`persistence` is exposed as `mode`), and **controller API**
`getSnapshot()`, `subscribe(fn)`, `set(field, value)`, `unset(field)`, `mutate(ops[, expectedRevision])`
(all three writers return `Promise<boolean>` — `false` when the Host refused), plus an internal
`dispose()`.

`derive()` (the mirror → form projection), `:1221-1243`:

```js
derive() {
    if (this.disposed) return;
    const mirrored = this.mirror.getSnapshot();
    if (mirrored.view === void 0) return;
    const { writable } = mirrored.view;
    const view = mirrored.view.namespaces.find((candidate) => candidate.ns === this.spec.namespace);
    if (view === void 0) { this.store.update((draft) => { draft.status = "unavailable"; draft.writable = writable; }); return; }
    const decoded = this.decode(view);
    this.store.update((draft) => {
        draft.revision = view.revision; draft.base = view.base; draft.user = view.user; draft.writable = writable;
        if (decoded === void 0) return;
        draft.status = "ready"; draft.value = decoded;
    });
}
```

**Write-op wire shape** — `@deepseek-ai/dsh-settings/lib/index.js:483-499`:

```js
/** Apply field edits without restating redacted secrets; unsetting an array index removes its element.
* @param ns Profile entry id.
* @param ops Ordered form edits.
* @param expectedRevision Revision returned by describe.
*/
async mutate(ns, ops, expectedRevision) {
    await this.write(ns, (current, base, schema) => ops.reduce((value, op) => {
        if (op.op === "set") return applyPathOp(value, op, schema);
        const parent = op.path.slice(0, -1).reduce((node, key) => member(node, key), value);
        if (Array.isArray(parent)) return applyPathOp(value, op, schema);
        const inherited = op.path.reduce((node, key) => member(node, key, true), base);
        return applyPathOp(value, inherited === void 0 ? op : { op: "set", path: op.path, value: inherited }, schema);
    }, current), expectedRevision, ops.map((op) => op.path));
}
```

Ops are `{ op: "set", path: string[], value: JsonValue }` and `{ op: "unset", path: string[] }`;
`path` elements are object keys or decimal array indices (`/^(0|[1-9][0-9]*)$/`, `dsh-settings/lib/index.js:195`).
A revision conflict throws `SettingsConflictError` with `code = "SETTINGS_CONFLICT"`
(`dsh-settings/lib/index.js:160-180`).

#### `whileServed(namespaces, register)`

```js
/**
* Keep a registration alive while the Host serves any of some namespaces:
* `register` runs once one of them is in the describe mirror, and its
* disposer runs when none is or when the returned disposer runs. A plugin
* whose page edits a namespace another plugin owns registers the page
* through this, so a deployment that never composed the owner shows no
* trace of the page. The caller owns the returned disposer and wraps it in
* `ctx.effect`; unlike {@link bind}, nothing is registered on the caller's
* context here.
* @param namespaces - the settings namespaces the registration follows.
* @param register - registers the contribution, given every namespace the Host serves; returns its disposer.
* @returns the disposer ending the watch and any live registration.
*/
whileServed(namespaces, register) {
    let off;
    const sync = () => {
        const served  = new Set(this.mirror.getSnapshot().view?.namespaces.map((view) => view.ns) ?? []);
        const watched = namespaces.some((namespace) => served.has(namespace));
        if (watched && off === void 0) off = register(served);
        else if (!watched && off !== void 0) { off(); off = void 0; }
    };
    const unsubscribe = this.mirror.subscribe(sync);
    this.mirror.ensure();
    sync();
    return () => { unsubscribe(); off?.(); off = void 0; };
}
```

`register` receives **`Set<string>` of every served namespace** and must return a disposer.
Typical call (wrap in `ctx.effect`; the READMEs stress this): see §5.3.

### 6.2 `ctx.settingsSchema` — `SettingsSchemaService`

`@deepseek-ai/dsh-client-ui-settings/lib/client.js:919-1030`:

```js
/**
* Settings-owned synchronous schema service. Dynamic client plugins receive
* this Cordis entity instead of importing executable helpers from one another.
*/
var SettingsSchemaService = class extends _deepseek_ai_cordis.Service {
    constructor(ctx) { super(ctx, "settingsSchema"); }
    /** Rehydrate one serialized `schema.toJSON()` envelope. */
    rehydrate(serialized) { return new Schema(serialized); }
    /** Validate a settings draft. @returns validation failure text, or `undefined` when valid. */
    validate(schema, draft) {
        try { schema(draft); return; }
        catch (error) { return error instanceof Error ? error.message : String(error); }
    }
    nodeAtPath(root, path)  { /* object: dict[key]; dict|array: inner */ }
    getPath(value, path)    { /* array index | object key traversal */ }
    hasPath(value, path)    { /* key presence, independent of value */ }
    setPath(root, path, value) { /* immutable nested set, materializes containers */ }
    /* ... plus unsetPath / clone helpers ... */
};
```

**Rebuild + validate a schema:**

```js
const schema = ctx.settingsSchema.rehydrate(view.schema);   // view from mirror/namespace(ns)
const failure = ctx.settingsSchema.validate(schema, draft); // undefined ⇒ valid
```

This is exactly what `ConfigFormController.decode()` does to refuse invalid wire values
(`:1245-1255`):

```js
decode(view) {
    if (this.spec.decode !== void 0) return this.spec.decode(view.value);
    if (typeof view.value !== "object" || view.value === null || Array.isArray(view.value)) return void 0;
    let failure;
    try { failure = this.schema.validate(this.schema.rehydrate(view.schema), view.value); }
    catch (_malformedSchemaEnvelope) { return; }
    return failure === void 0 ? view.value : void 0;
}
```

Other consumers: `dsh-client-ui-settings-models/lib/client.js`,
`dsh-client-ui-permission-presets/lib/client.js`.

### 6.3 The "entry id" / namespace — **it is the profile Loader row id**

Definitive proof, `@deepseek-ai/dsh-settings/lib/index.js:501-505`:

```js
async write(ns, change, expected, paths = []) {
    const entry = this.ownerContext.configEditor.entries().find((row) => row.options.id === ns);
    const schema = entry === void 0 ? void 0 : this.schema(entry);
    if (entry === void 0 || schema === void 0) throw new Error(`No configurable plugin entry "${ns}"`);
```

and the descriptor builder `describe()`, `dsh-settings/lib/index.js:413-450`:

```js
/** Read active plugin schemas and their live values.
* @param options Redaction required for remote callers.
* @returns Forms keyed by unique profile entry ids.
*/
describe(options) {
    const descriptors = this.ownerContext.configEditor.configuration().flatMap(({ entry, inherited, override }) => {
        ...
        this.revisions.set(entry.id, { raw, revision, ns: entry.options.id, autoGenerate });
        ...
        return [{ autoGenerate, ns: entry.options.id, schema: form.toJSON(), revision, applies: "live",
                  value: ..., base: ..., user: ..., ... }];
    });
```

`entry.options.id` is the `id:` of the `cordis.patch.yml` insert (or config-override) row. **Therefore:**

* your plugin's `cordis.patch.yml` must insert a row, e.g.
  ```yaml
  - insert:
      - id: my-plugin            # ← THIS is the settings namespace / configForms entry id
        name: "my-plugin-package"  # ← the npm package name (quoted; '@' starts a YAML indicator)
  ```
* `ctx.configForms.get("my-plugin")` edits that row's `config:` block.
* The id is *not* the package name in general — `dshmarket` inserts `id: dsh-market` for package
  `dshmarket`; the market registers its config under the **bundle key** `dshmarket`
  (`dshmarket/client/client.js:15500-15510`) and its locale ns `dsh-market` separately.
* Real third-party confirmation, `@opencode2dsh/dsh-plugin/lib/client.js:1429-1433`:
  ```js
  /**
  * The Host settings entry this page edits: the Loader entry id, which is the
  * plugin name. The editable field inside it is `ipPool`.
  */
  const SETTINGS_NAMESPACE = "opencode2dsh";
  ```
  and `dsh-web-search-free/dist/client.js:650-653`:
  ```
  * - dsh >= 0.1.7 deleted `settingsScope` and replaced it with `configForms`,
  *   the settings domain base. `get(entryId)` is keyed by the profile ENTRY id
  *   rather than a registered namespace — for this plugin the same string, since
  *   its bundle patch names the row `web-search-free`.
  ```
* A page only appears when the Host actually serves that namespace → always gate with `whileServed`.

### 6.4 Provider-side wiring (what makes your namespace exist)

`dsh-client-ui-settings/lib/index.js:9-19` (the host half of the settings base itself):

```js
/** Live preferences projected to the browser. */
const Config = z.object({ enabled: DeveloperToolsSettingsFields["enabled"].volatile() });
function apply(ctx) {
    ctx.inject(["settings"], (child) => {
        child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
    });
}
```

For a **config-only** plugin row you do not need this: `dsh-settings.describe()` already lists every
active Loader entry that has a non-empty Schemastery `Config` (`dsh-settings/lib/index.js:415-419`).
A row with **no** `Config` export produces no namespace and therefore no form.

### 6.5 Practical form building — `SettingsFormModel`

For a page, the shortest path is the primitives' staged-form model
(`@deepseek-ai/dsh-client-ui-primitives/lib/index.js:7144-7256`):

```js
/**
* Stages one card's edits over one settings namespace and writes them on save.
* ...
*/
var SettingsFormModel = class {
    constructor(scope, specs, secrets = []) {          // scope = ctx.configForms.get(ENTRY_ID)
        this.scope = scope;
        this.specs = new Map(specs.map((spec) => [spec.field, spec]));
        this.secretSpecs = new Map(secrets.map((spec) => [spec.field, spec]));
        this.unsubscribe = scope.subscribe(() => { this.publish(); });
    }
    bind(project)  { /* returns a snapshot store the card reads via use<Name> */ }
    shell()        { return { available, writable, dirty, invalid, saving, failed }; }
    field(field)   { return { text, overridden, invalid }; }
    actions()      { return { edit(field, text), resetField(field), save(), discard() }; }
    /* … save() writes staged ops through the scope, then re-seeds … */
};
```

with field specs `settingsNumberField(field)` / `settingsTextField(field)`
(`:7104-7143`), plus components `SettingsForm`, `SettingsValueField`, `SettingsSecretField`.
Canonical consumer: `@deepseek-ai/dsh-client-ui-settings-shell/lib/client.js:120-150`.

---

## 7. `@deepseek-ai/dsh-client-locale`

### 7.1 Register dictionaries

`@deepseek-ai/dsh-client-locale/lib/client.js:1387-1413`:

```js
register(ns, localeOrDicts, dict) {
    const pairs = typeof localeOrDicts === "string" ? [[localeOrDicts, dict]] : Object.entries(localeOrDicts);
    for (const [locale] of pairs) if (!LOCALE_ID_PATTERN.test(locale)) throw new Error(`locale id "${locale}" is not a BCP 47-style tag`);
    let locales = this.dicts.get(ns);
    if (!locales) { locales = new Map(); this.dicts.set(ns, locales); }
    for (const [locale] of pairs) if (locales.has(localeKey(locale))) throw new Error(`locale namespace "${ns}" already has locale "${locale}"`);
    for (const [locale, entries] of pairs) locales.set(localeKey(locale), entries);
    this.publish(this.snapshot.active, false);
    return () => { /* per-locale disposer, publishes again if anything was removed */ };
}
```

Two call forms:
* `ctx.locale.register(NS, { zh, en })` — the **typed** bilingual form (both built-in locales required;
  keys checked against the merged `LocaleNamespaceMap` at compile time).
* `ctx.locale.register(ns, "ja", { cancel: 'キャンセル' })` — single-locale untyped form for language packs.

Both return an **idempotent disposer**; wrap in `ctx.effect` (the convention in every shipped plugin):
`ctx.effect(() => ctx.locale.register(NS, { zh, en }), "<plugin>: dictionaries")`.

**Duplicate `(ns, locale)` throws** — a namespace's texts have exactly one owner.

### 7.2 `bind(ns)` and `t()`

`@deepseek-ai/dsh-client-locale/lib/client.js:1414-1435`:

```js
bind(ns) {
    let t = this.bound.get(ns);
    if (!t) { t = (key, params) => this.translate(ns, key, params); this.bound.set(ns, t); return t; }
    return t;
}
translate(ns, key, params) {
    const chain = this.fallbackChain(this.snapshot.active);
    const template = this.lookup(ns, key, chain) ?? (ns !== "common" ? this.lookup("common", key, chain) : void 0) ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
}
lookup(ns, key, chain) {
    const locales = this.dicts.get(ns);
    for (const locale of chain) { const value = locales?.get(localeKey(locale))?.[key]; if (value !== void 0) return value; }
}
```

**`bind` returns a stable reference per namespace** (memoized in `this.bound`) — safe to put in an
`inject` face without breaking `React.memo`. Lookup order: active locale's fallback chain in `ns` →
same chain in the shared `common` namespace → the key itself. Interpolation is `{name}`.

The framework's `t` prop is `localeSeat(face, entry.locale)`, i.e. exactly `face.bind(ns)` — but with a
**new identity per locale revision** so memoized components re-render (§4.5).

Read state via `ctx.locale.getSnapshot()` (`{ active, revision, ... }`) and
`ctx.locale.subscribe(fn)`; `ctx.locale.resolveText(localizedText)` resolves a package manifest's
`LocalizedText` (literal string or `{ zh, en }` map) — used by `ui-settings-plugin-inventory`
(`lib/client.js:784`).

### 7.3 Label thunks + locale

Because a `label` may be `() => t("nav")` and owners call `resolveSlotLabel` lazily, and because owners
also subscribe to `ctx.locale.subscribe`, a slot `label` thunk follows the active language **without
re-registering**. `dsh-better-sidebar` instead re-registers on locale change via a `useLocaleRevision`
helper — both patterns exist in the wild.

---

## 8. Module resolution & build requirements

### 8.1 Bundler or hand-written?

**Either.** Precedent for hand-written, zero-build bundles in this machine's install:

* `@zhz8888/dsh-radeon-cloud-patcher/client/client.js` — 62 lines, no build step, `exports.apply` only.
* `dsh-tabbit/client/client.js` — 429 lines; the header comment (`:15-23`) states the choice explicitly:
  > 首尾两行的 `window.__ModuleLoader__.load({id, factory})` 是 dsh Web 端的客户端模块装载协议：手写这个外壳（而不是上 webpack/vite 打包链）是刻意选择——本文件零依赖、百来行，不值得为它引入一整套构建。…（middle 部分随便改，首尾包裹行不要动。）

With no bundler you write `React.createElement(...)` directly (`react` is a seed word) or use
`require("react/jsx-runtime")` and call `jsx`/`jsxs` by hand.

If you *do* use a bundler, the observed conventions are:
* output a **classic-script** wrapper `window.__ModuleLoader__.load({ id, factory: (require) => {...} })`
  (tsdown/rolldown emit this — see `dsh-better-sidebar/lib/client.js:1-4`, `dshmarket/client/client.js:1`,
  `dsh-opencode-go/lib/client.js:1`);
* externalise the seed words and every `dsh.client.inject`/`external` package (i.e. emit `require("react")`,
  `require("@deepseek-ai/dsh-client-ui-slots")`), never inline them;
* CJS `module.exports`-style output, with a `Symbol.toStringTag = "Module"` marker;
* optionally emit `lib/client.js.map`;
* emit CSS as JS string constants guarded by `document.querySelector("style[data-plugin-css=...)")`;
* run your build in watch mode alongside `pnpm run dev:web` for bundle HMR.

### 8.2 What `require` supports — summary

| Specifier class | Resolves? | Notes |
|---|---|---|
| seed words (`react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-dockkit`) | ✅ always | frozen shell table |
| `<other-plugin-package>` | ✅ if that package is a `dsh.client` row **and** registered | must be declared in `dsh.client.inject` (hard) or `external` (lazy) |
| `<other-plugin-package>/client` | ✅ | normalized by `stripClientSuffix` |
| relative `./client.x.js` via `require.async` | ✅ | must match `CLIENT_CHUNK`; host serves `/plugins/<pkg>/client.x.js?rev=` |
| `node:*`, `fs`, `path`, any URL/scheme | ❌ | throws `require("…") missed the module table …` |
| `import()` / top-level `await` | ❌ | the wrapper is a synchronous classic script |

### 8.3 The client bundle purity gate (build-time)

`@deepseek-ai/dsh-client-ui-settings/lib/client.js:1257-1263` states the rule verbatim:

```js
/**
* The settings domain's base service. Features that own a preference reach the
* settings transport through this service rather than a shared function: the
* client bundle purity gate forbids cross-plugin value imports and directs
* cross-plugin collaboration through cordis services
* (`packages/client/tsdown.client.ts`).
*/
var ConfigForms = class extends _deepseek_ai_cordis.Service {
```

Practical consequences:

* **Do not** `import { SlotCore } from "@deepseek-ai/dsh-client-ui-slots"`-style reach into another
  plugin's internals for behaviour. Only the nine seed words may be imported as *values*; everything
  else must be a Cordis service on `ctx` or a slot contribution.
* The runtime mirror of this gate is `makeRequire`'s throw
  (`client-modules/lib/client.js:705`) — there is no silent fallback.
* This is why `ctx.configForms`, `ctx.settingsSchema`, `ctx.slots`, `ctx.locale` exist as services at all.

### 8.4 HMR / dev loop

`@deepseek-ai/dsh-client-hmr/README.zh.md:30-40`:

> 运行 `pnpm run dev:web`，它会同时启动宿主与重建 watcher（`--no-serve` 则只把 watcher 接到别处启动的宿主上，使用共享 Client tsdown 预设的任何 watch 进程亦然）；重建后的插件随后会被自动逐个替换进运行中的浏览器。该预设会在所有包内 chunk 写完后标记 `lib/client.js`，因此仅 chunk 发生重建也会推进包 revision，无需 Host 扫描 chunk。

Config: `pollIntervalMs` default `500`. A reload **re-executes the bundle with fresh state** (React state
in that plugin is lost; sessions/workspace/connection survive). Failures show in the Plugins list with
a retry button.

---

## 9. Complete minimal "hello world" client half (settings tab)

Two files inside a package named `dsh-settings-hello`:

### 9.1 `package.json`

```json
{
  "name": "dsh-settings-hello",
  "version": "1.0.0",
  "type": "module",
  "main": "./index.js",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-settings-plugins"
      ]
    }
  }
}
```

> `inject` is only needed so the dependency bundles are *registered* before ours materializes.
> `@deepseek-ai/dsh-client-ui-settings-plugins` owns the `settings.plugins.tab` declaration;
> `@deepseek-ai/dsh-client-locale` provides `ctx.locale`.

### 9.2 `index.js` — the **required** host half (empty)

```js
/** Host half: exists so the package occupies a Loader row, which is the only way
 *  the client module system discovers dsh.client and serves /plugins/... */
export function apply() {}
```

### 9.3 `cordis.patch.yml`

```yaml
# Inserts this plugin as a profile layer. The row `id` is the settings namespace
# a config page would edit; `name` must be the full installed package specifier
# (quoted: a YAML scalar starting with '@' is parsed as an indicator).
- insert:
    - id: settings-hello
      name: "dsh-settings-hello"
```

### 9.4 `client.js` — the bundle (hand-written, no build step)

```js
/* dsh-settings-hello — client half.
 *
 * Format notes: this file is NOT ESM. It is a classic script whose only
 * top-level effect is registering a lazy CJS factory with the module table the
 * DSH web shell installed as window.__ModuleLoader__. Everything else (including
 * any CSS) must live INSIDE the factory closure, because a bundle is executed
 * only to register; module bodies run at materialization.
 */
window.__ModuleLoader__.load({
  // MUST equal package.json "name": the module table is keyed by package name.
  id: 'dsh-settings-hello',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')
    var h = react.createElement

    /** Dictionary namespace owned by this plugin. */
    var NS = 'settings.hello'

    var zh = { nav: '你好', title: '你好，DSH', body: '这个标签页由第三方客户端插件提供。', open: '打开设置', close: '关闭' }
    var en = { nav: 'Hello', title: 'Hello, DSH', body: 'This tab is contributed by a third-party client plugin.', open: 'Open settings', close: 'Close' }

    /* ---- CSS: injected manually, tagged for ownership + idempotence ---- */
    var CSS_TAG = 'dsh-settings-hello/hello.css'
    var CSS = '.dsh-hello{padding:8px 0;display:flex;flex-direction:column;gap:8px;color:var(--dsw-alias-label-primary)}' +
              '.dsh-hello h2{margin:0;font-size:18px;font-weight:600}' +
              '.dsh-hello p{margin:0;font-size:13px;color:var(--dsw-alias-label-tertiary)}'

    function injectCss() {
      if (typeof document === 'undefined') return function () {}
      var existing = document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG) + ']')
      if (existing !== null) return function () {}
      var tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-settings-hello'   // ownership: reclaimed on unload
      tag.dataset.pluginCss = CSS_TAG             // idempotence across HMR
      tag.textContent = CSS
      document.head.appendChild(tag)
      return function () { tag.remove() }
    }

    /* ---- the tab component ----------------------------------------------
     * Props supplied by the framework (see standardKit in ui-renderer):
     *   t           — translate function bound to this entry's `locale`
     *   renderSlot  — present only if we had declared `children`
     *   use* hooks  — only those declared for the `settings.plugins.tab` slot
     * Owner props for settings.plugins.tab are intentionally empty.
     * ------------------------------------------------------------------- */
    function HelloTab(props) {
      var t = props.t
      return h('div', { className: 'dsh-hello' },
        h('h2', null, t('title')),
        h('p', null, t('body')),
        h('p', null, h('code', null, 'settings.plugins.tab / id=hello')))
    }

    function apply(ctx) {
      /* 1. dictionaries: register through ctx.effect so unload removes them */
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en })
      }, 'dsh-settings-hello: dictionaries')

      /* 2. the page-level t (stable per namespace) — optional; the slot's own
       *    `locale` option already provides a `t` prop. Kept for clarity. */
      var t = ctx.locale.bind(NS)

      /* 3. contribute the tab. `slots.inject` WAITS for the declaration; it is
       *    free when the Plugins settings section is not composed. Registering
       *    into an undeclared slot would throw, so it happens in the callback. */
      ctx.slots.inject('settings.plugins.tab', function () {
        return ctx.slots.register({
          name: 'settings.plugins.tab',   // must equal the slot key
          id: 'hello',                    // list cell key (fresh id => new tab)
          order: 50,                      // after the shipped inventory tab (10)
          label: function () { return t('nav') },   // thunk => follows locale
          locale: NS,                     // gives the component its `t` prop
          inject: function () { return { helloFrom: 'dsh-settings-hello' } }
        }, HelloTab)
      })

      /* Styles are applied to the document, not to the slot: do it once, in an
       * effect, so the plugin's unload removes them. */
      ctx.effect(injectCss, 'dsh-settings-hello: styles')
    }

    exports.apply = apply

    /* Required services. ONLY services that every target dsh provides may be
     * listed here: an unresolved service leaves the entry pending, and web boot
     * throws `web boot: N entries did not activate`, stopping the whole UI.
     * `slots` and `locale` are stable. Anything optional goes through a child
     * ctx.inject([...], cb) fiber instead. */
    exports.inject = ['slots', 'locale']

    return module.exports
  },
})
```

### 9.5 Variation — a whole **Settings nav section** instead of a tab

Replace step 3 with:

```js
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({
          name: 'settings.section',
          id: 'hello',                     // nav key; must be unique
          order: 50,                       // shipped: general 0, models 10, plugins 15, market 40
          label: function () { return t('nav') },
          locale: NS,
          inject: function () { return { helloFrom: 'dsh-settings-hello' } }
        }, HelloSection)                   // receives owner props { close }
      })
```

where `HelloSection(props)` may call `props.close()` (owner prop supplied by
`renderSlot("settings.section", { close: onClose }, { only: active })`).

### 9.6 Variation — a config page over the plugin's own `Config`

Add a `Config` export to the **host** half (`index.js`), e.g.
`export const Config = z.object({ greeting: z.string().default('hi') })` — the namespace then equals the
patch row id `settings-hello`. In the client, gate and mount:

```js
      ctx.inject(['configForms'], function (formCtx) {
        formCtx.effect(function () {
          return formCtx.configForms.whileServed(['settings-hello'], function () {
            var form = formCtx.configForms.get('settings-hello')
            return formCtx.slots.inject('plugins.item', function () {
              return formCtx.slots.register({
                name: 'plugins.item', id: 'hello', order: 50,
                label: function () { return t('nav') }, locale: NS,
                inject: function () { return { form: form } }
              }, HelloConfigCard)
            })
          })
        }, 'dsh-settings-hello: config page')
      })
```

`HelloConfigCard` reads `props.form.getSnapshot()` → `{ status, value, base, user, revision, writable, mode }`
and writes with `props.form.set(field, value)` / `props.form.unset(field)` /
`props.form.mutate([{ op: 'set', path: ['greeting'], value: 'yo' }])`.

---

## 10. Is a client half REQUIRED for a settings page? — **YES**

**Claim (from `@deepseek-ai/dsh-settings/README.zh.md:39`), verbatim:**

> 每个表单报告 `autoGenerate`（默认开启），供按 schema 生成页面的客户端使用；**目前没有已发布的客户端这样做**。自带页面的插件在 `apply` 中于可选的 `ctx.inject(['settings'], ...)` 子级内以 effect 注册 `configure({ auto: false }, ctx.fiber)`：子级指明策略所属的插件 fiber，迟加载或被替换的 Settings 服务也会采用该策略，业务插件无需 Settings 即可运行。策略不移除配置读写。

**Verification against `dsh-client-ui-settings/lib/client.js` and the whole bundle — confirmed.**
`grep -rn "autoGenerate" --include=*.js <app>/node_modules/@deepseek-ai/` returns, outside
`dsh-settings` and `dsh-api-settings-controller` (which merely carry it on the wire), only
**schema declarations**:

```
./dsh-api-remotes/lib/client.js:5621:  "autoGenerate": boolean(),
./dsh-api-remotes/lib/client.js:5690:  "autoGenerate": boolean(),
./dsh-api-remotes/lib/client.js:5753:  "autoGenerate": boolean(),
./dsh-api-remotes/lib/client.js:5814:  "autoGenerate": boolean(),
./dsh-tool-cordis/lib/types/api-catalog.js:6896: declaration: 'export interface SettingsDescriptor { ns; autoGenerate; schema; value; revision; base?; user?; applies; secrets? }'
./dsh-tool-cordis/lib/types/api-catalog.js:6908: declaration: 'export interface SettingsNamespaceView { autoGenerate; ns; schema; value; base?; user?; applies; secrets; revision }'
```

No renderer reads it. The client's only schema use is **validation** (`SettingsSchemaService.validate`,
`decode()` — §6.2). `dsh-client-ui-settings/lib/client.js` renders **nothing**; its own README says so
(`README.zh.md:12`):

> 它还为设置界面框架、页面、标题栏操作、插件标签页和引导流程提供标准扩展点，但**自身不渲染任何界面**。

**Conclusions**

1. A plugin that wants a settings page **must ship a client half** and register a `settings.section` /
   `settings.plugins.tab` / `plugins.item` / `plugins.row.config` contribution.
2. `autoGenerate` defaults to **`true`** and is currently unused by every shipped client. Setting
   `configure({ auto: false }, ctx.fiber)` is a **convention/doc signal**, not a rendering switch. It is
   still worth doing to declare "this plugin has its own page" (and it is what all official pages do).
3. A row with no `Config` export has no settings namespace at all — `configForms.get(id)` will sit at
   `status: "unavailable"`, and `whileServed([id])` will never fire.

---

## 11. The authoritative machine-readable catalogs (best in-bundle "docs")

The bundle contains two generated catalogs that mirror the (unshipped) TypeScript contract sources —
they are the closest thing to an official plugin-authoring reference in this install:

**(a) Slot catalog** — `@deepseek-ai/dsh-cordis-client-runner/lib/client.js:2363+`:

```js
/** Every slot the shipped web bundle declares, sorted by key. */
const CLIENT_SLOT_API = [ { key, kind, scope, summary, doc, registerOptions[], ownerProps[],
                            ownerPropsReferences[], standardProps[], keyDomain, hookContext,
                            slotInject, declaredBy, occupants[], replaceRisk, example, source }, ... ];
```

Every entry points at its true source, e.g. `source: "packages/client/ui-settings/src/client/contract/slots.ts:57"`.

**(b) Service catalog** — same file (~`:1170` `locale`, `:1362` `slots`, `:1400` `theme`, ...) with
`{ key, summary, description, methods: [{ signature, description, parameters, returns, throws }] }`,
and **type/event catalogs** alongside.

Query helpers exist in-bundle: `queryServiceApi(key, services)`, `queryEventApi(name, events)`,
`referencedTypeClosure(...)` (`:2293-2361`). Practical read:

```bash
CR="/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-cordis-client-runner/lib/client.js"
grep -n 'key: "settings' "$CR"
grep -n 'key: "configForms"\|key: "settingsSchema"' "$CR"   # (absent in 0.2.0-rc.2's catalog)
```

> In `0.2.0-rc.2` the catalog has **no** entry for `configForms` or `settingsSchema` even though both
> services exist — the catalog is generated from a curated list and lags. Treat `ctx.configForms` /
> `ctx.settingsSchema` as documented by `ui-settings`' own README (§12) plus the code citations in §6.

---

## 12. README summaries — the authoritative rules they state

### 12.1 `@deepseek-ai/dsh-client-modules/README.zh.md`

Key rules (`:34`, `:38`, `:44`, `:46`, `:50`, `:68`, `:72`, `:74`):

* **Declaring**: *"浏览器插件包在其 `package.json` 中以 `platform: 'web'` 声明 `dsh.client`，导出 `./client` bundle，并在 `dsh.client.external` 下列出任何基座之外的模块请求。宿主半侧把每份声明变成 `/plugins` 下提供的 bundle，并让动态提供方先于其消费方加载。"* (`:34`)
* **What the browser loads** (`:38`): the app combo carries each plugin's `client.js` entry and registers
  the factories once at startup; **module bodies stay lazy**; tsdown's code-split `import()` compiles to
  `require.async("./client.<name>.js")`; row resolution: `<id>/client` and the bare `id` are the same exports.
  A failed `<script>` is retried once, and a batch that loaded without registering a row is never
  re-executed — each missing row then falls back to its own single-resource combo URL (≤3 requests/row).
* **Shared modules** (`:44`): *"外壳初始化一张冻结的模块表（`PLATFORM_MODULES`：React、Cordis 与静态 UI 库）；每个动态 bundle 都精确针对该基座解析其 external。`dsh.client.external` 只添加基座之外的精确请求…纯类型 import 会被擦除，不产生请求。组合阶段会拒绝畸形请求、缺失提供方、自请求与同步请求环。"*
* **Build requirement** (`:46`): *"宿主提供的是已构建的客户端 bundle，因此启动前 `pnpm run build` 必须已产出每个 `lib/client.js`；缺失 bundle 会明确导致激活失败，并给出一条构建说明及包／路径列表。"*
* **Lazy CJS model** (`:68`): executing a bundle **only registers its factory**; every module body side
  effect — **including CSS injection** — lives in the factory closure and runs at materialization.
  Resolution order: platform seed table → memoized record → boot graph row → registered factory → throw.
* **Dynamic composition** (`:42`): *"「设置 → 插件 → 插件列表」显示当前页面的同步失败，并提供不改变 Host 启用状态的重试。"*

### 12.2 `@deepseek-ai/dsh-client-ui-slots/README.zh.md`

* Four kinds (`:28`); **Component Factory** API `registerFactory` / `renderFactorySlot` / `useFactorySlot`
  for reusable assemblies (`:32-34`).
* **Five framework prop shares** (`:38`): runtime share (`owner` + session toolkit + global seats),
  child-render share (`renderSlot` narrowed to declared children), factory-render share,
  store share (`useStore` selectors + `actions`), business share (from `inject`).
  *"组件引用推导出的 props 别名；它们绝不在本地重新定义任何 share 的类型。"*
* **Store seats** (`:42`): `store: defineStore(...)` with `init`/`actions`.
* **Declaration discipline** (`:46`): *"声明即认领：注册条目成为唯一被允许渲染该键的条目；注册未声明 slot、声明已声明过的子项、在两个 scope 下挂载同一个共享句柄、或注册缺少 `select` 的 chain，都会在加载时抛出。条目的 disposer 会递归移除其声明的子 slot。"*

### 12.3 `@deepseek-ai/dsh-client-ui-settings/README.zh.md`

* **Config forms** (`:34`): *"功能适配器使用 `ctx.configForms.get(entryId)` 获取该 Host 条目所有编辑器共享的已接受值和写入队列。快照包含解析后的 `value`、继承 `base`、原始 `user`、修订号、可写性和持久化模式。`set` 与 `unset` 提交单个操作，`mutate` 提交一个原子操作列表。暂存编辑器传入编辑前读取的修订号；冲突时保留草稿。清除操作移除覆盖并恢复继承。"*
* **Following served namespaces** (`:38`): `whileServed` semantics, and *"调用方持有返回的 disposer 并把它包进 `ctx.effect`；与 `get` 不同，服务不会在调用方的 context 上注册任何东西。因此从未组合过所有者的部署看不到该页面的任何痕迹，Host 停止服务的命名空间会撤下它。插件页上的四个官方页面各自通过一个伴生包走这条路径。"*
* **Filling settings slots** (`:42`): *"设置界面会注册进本包声明的 slot 类型。外壳（`sidebar.settings` 占位方、导航、界面框架）位于 ui-settings-general；功能页面注册 `settings.section` 贡献；「插件」分区承载 `settings.plugins.tab` 页面；首次使用引导步骤注册 `settings.onboarding`。跨命名空间的表面…通过 `ctx.configForms.describe()` 读同一面镜像。"*
* **Schema service** (`:70`): *"`ctx.settingsSchema` 重建 schema、校验草稿并编辑嵌套值。无效的线路值不会替换已接受值。"*
* **Describe mirror** (`:62`): one `settings.describe` reader in the browser, refreshed on
  `settings/document-updated` and `connection/reset`.
* **Known limit** (`:106`): *"非 loopback 页面没有持久化设置：本 Client 在那里禁用 Host 持久化，因此表单以 `unavailable` 起步且从不跨线路"* — matches
  `const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";` (`client.js:1509`).

### 12.4 `@deepseek-ai/dsh-client-ui-settings-plugins/README.zh.md`

* *"要贡献一个标签页，带 `id`、`order` 和本地化的 `label` 注册进 `settings.plugins.tab`；分区按序渲染条目，标签页在首次被选中时挂载。功能文案留在注册方自己的字典里。"* (`:30`)
* *"只有一个贡献时直接渲染为页面本身，标签页在首次被选中后保持挂载，搜索词和清单快照因此在切换间不丢失。"* (`:40`)
* *"宿主半侧是一个空的 `apply`，只为让本包占一条 Loader 行，客户端模块系统据此送出浏览器半侧。"* (`:40`)
* Known limit (`:69`): *"分区没有自己的标签页——在功能插件注册标签页之前它只显示空提示"*.

### 12.5 `@deepseek-ai/dsh-api-remotes/README.zh.md`

* BFF for Host Remote capabilities; the Client entry imports generated `/remote` artifacts and mounts
  each contribution via `ctx.remote.$mount()`, re-exporting the declaration merges (`:14`).
* *"本 facade 同时是 Client 包指称 wire 类型词汇的正门"* — one specifier for `RemoteResult`,
  `RemoteFailure`, `RemoteErrorCode`, `RemoteHostFacts` and domain payloads (`:34`).
* Forwarded Host events: the list `API_REMOTE_FORWARDED_EVENTS` is simultaneously the legal key set for
  `ctx.remote.$on`; JSON-only payloads; per-client allowlist listeners (`:43-47`).
* Build boundary (`:60`): *"普通 Client 插件仍使用单一 Client project，并在 Client tsdown 阶段一起生成 Node loader 入口和 browser bundle；只有两组源码需要不同 compiler face 时才拆分。"*

### 12.6 `@deepseek-ai/dsh-host-frontend-static/README.zh.md`

* Serves the built SPA from the dist root; occupies the `webserver` fallback seat; single occupant (`:12`,
  `:28`, `:50`).
* *"所服务的 HTML 携带唯一的文档 base `<base href="./">`，位于每一条注入资源行之前"* (`:44`).
* Traversal → 403, missing → empty 404, no SPA fallback for assets (`:42`, `:48`).
* `ctx.connection.authorizeIndex` gates only the index; assets are public (`:46`).

### 12.7 `@deepseek-ai/dsh-settings/README.zh.md`

* Namespaces are **profile entry ids**; `autoGenerate` exists but **no shipped client uses it**
  (`:39`, quoted verbatim in §10).
* Plugins that own their page call `settings.configure({ auto: false }, ctx.fiber)` inside a child
  `ctx.inject(['settings'], ...)` fiber — *"策略不移除配置读写"* (`:39`).

### 12.8 `@deepseek-ai/dsh-client-locale/README.zh.md`

* *"用已合并进 `LocaleNamespaceMap` 的命名空间调用 `ctx.locale.register(ns, { zh, en })`；编译器会对照该命名空间的类型化键并集检查每个键，并要求两个内置 locale 齐全。消费方通过 `ctx.locale.bind(ns)` 或框架注入的 `t` 席位翻译。UI 已挂载后再注册的字典无需重新挂载即可生效。"* (`:32`)
* Lookup: active locale's fallback chain in `ns` → same chain in `common` → the key itself (`:60`).
* Language packs: `addLanguage({ id, label, fallback })` + single-locale `register(ns, tag, dict)`; both
  are caller-owned effects (`:52-62`).
* Non-loopback pages keep locale in-process only (`:64`).

### 12.9 `@deepseek-ai/dsh-client-hmr/README.zh.md`

* Dev loop `pnpm run dev:web`; bundles are replaced plugin-by-plugin in the live page (`:30`);
  `pollIntervalMs` default 500; React state in the reloaded plugin is lost (`:40-44`).

---

## 13. Pitfalls checklist (all evidence-backed)

1. **No host row ⇒ no client half.** The scan is driven by `ctx.loader.entries()`; ship an empty host
   `apply` plus a `cordis.patch.yml` insert (`dsh-client-ui-settings-plugins/lib/index.js:3-9`).
2. **`id` must equal the package name**, else
   `loaded without registering "<id>" via __ModuleLoader__.load` (`dsh-client-modules/lib/client.js:625`).
3. **Empty `dsh.client.inject` is fine; wrong contents are fatal in different ways.** A missing
   dependency graph row makes composition throw; a *service* named in the top-level `inject` that the
   host does not provide makes boot throw `web boot: N entries did not activate`
   (`dsh-web-search-free/dist/client.js:663-669`).
4. **Never list `configForms` / `settingsSchema` in a package's `dsh.client.inject`** — those are
   *services*, not packages; they belong in the fiber `inject` (or, better, a child `ctx.inject`).
5. **`slots.register` throws on an undeclared slot** — always nest it in `ctx.slots.inject(name, cb)`.
6. **`list` slots require `id`; `keyed` require `key`; `chain` require `select`** (`ui-slots/lib/index.js:175-189`).
7. **`single`/`keyed`/`list` cells are per-priority exclusive** — a second registration in the same cell at
   the same priority throws; shadow with a different `priority` (lowest renders).
8. **Declaring a child slot is an exclusive claim.** Two plugins cannot declare the same child key.
9. **`label` thunks** are re-read by owners through `resolveSlotLabel`; but `settings.section` owners also
   subscribe to locale, so re-registering on locale change is *also* legal
   (`dsh-client-ui-settings-general/lib/client.js:1046-1070`).
10. **Scope discipline:** settings slots are `scope: "root"`. Declaring a non-root child forces a
    `SessionProvider` seat and throws without a session scope adapter (`ui-renderer/lib/client.js:735-739`).
11. **CSS must be injected manually** and tagged `data-plugin` / `data-plugin-css`, in a factory-closure
    effect (`dsh-client-modules/lib/client.js:16-23, 492-498`).
12. **`sourceMappingURL` is optional** and rewritten by the host; a missing `.map` is not an error.
13. **Non-loopback pages have no Host persistence** — forms start `unavailable` and writes resolve `false`
    (`ui-settings/lib/client.js:1509`, `:1213`).
14. **Revision fences:** pass the revision you read into `mutate(ops, expectedRevision)` for staged
    editors; a stale one yields `SETTINGS_CONFLICT` and a recovery read
    (`ui-settings/lib/client.js:1177-1200`, `dsh-settings/lib/index.js:160-180`).
15. **Namespace ≠ package name in general.** Use the patch row `id`
    (`dsh-settings/lib/index.js:502`; `dshmarket` row id is `dsh-market` while `plugins.bundle.config`
    is keyed by the *bundle package name* `dshmarket` — `dshmarket/client/client.js:15500-15510`).
16. **Slot renames across releases are real.** `dsh-web-search-free` carries a candidate ladder plus a
    5 s "nothing mounted" warning that dumps the declared plugin-related slot names
    (`dist/client.js:608-757`). Consider the same defensive posture.
