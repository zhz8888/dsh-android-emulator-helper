# The Host Half of a DSH Plugin — Implementation-Ready Specification

**Target installation**

| What | Path / value |
|---|---|
| App bundle root | `/Applications/DSH Desktop.app/Contents/Resources/app/` |
| Bundled packages | `<app>/node_modules/@deepseek-ai/` (291 packages) |
| DSH runtime version | `0.2.0-rc.2` (`node …/dsh/lib/bin.js --version`) |
| CLI entry | `<app>/node_modules/@deepseek-ai/dsh/lib/bin.js` (run with `node`) |
| Active profile | `/Users/zhz/.dsh/profiles/desktop/` (**Electron-owned; CLI refuses it**) |
| Canonical tool plugin | `<app>/node_modules/@deepseek-ai/dsh-tool-todo/` |

Every citation below is `<absolute-ish package path>:<line>` relative to
`/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/`
unless written out in full. Evidence was gathered read-only; nothing outside
`docs/research/` was modified.

> **Ground rule this spec was verified against.** Nothing in it is inferred from
> types that are not shipped. The `@deepseek-ai/dsh-*` packages ship **only
> `lib/*.js`** — every `types`/`exports` field in their `package.json` points at
> `.d.ts` files that are **not in the bundle** (`dsh-tools/lib/types/` contains
> `index.js`, `json-schema.js`, … and no declarations). So the JSDoc inside the
> compiled JS is the authoritative API documentation, and it is quoted verbatim
> below.

---

## 0. Executive summary of the ten things that actually matter

1. `ctx.tools.register(definition)` takes a **`ToolDefinition` whose `output`
   field is mandatory** — `{ schema, render, presentationMeta? }`
   (`dsh-tools/lib/index.js:2881`). The ergonomic constructor is
   `defineTool({...})` from `@deepseek-ai/dsh-tools` (`:838`), which compiles the
   author-facing parameter/output DSL into the enforced raw JSON Schema subset.
2. `parameters` and `output.schema` are **not** raw JSON Schema when you use
   `defineTool` — they are a **restricted author DSL**: no `type: ['a','b']`, no
   `anyOf`/`allOf`/`$ref`/`format`/`pattern`/`minimum`; every object node must
   state `additionalProperties` explicitly; nullability is an exact-one `oneOf`.
   **zod is not accepted anywhere in this path.**
3. `execute(args, exec)` returns a **plain structured value** that is snapshotted,
   validated against `output.schema`, deep-frozen, then passed to
   `output.render(args, value)` to become model-visible **content blocks**.
   Returning content blocks directly is a test-fixture-only trick.
4. **Errors are signalled by throwing.** There is no `isError` field to return.
   The registry converts any throw into
   `{ isError: true, content: [{type:'text', text:'Error: …'}] }`.
5. **Tool names are used verbatim** — no prefixing for host plugins. Only the MCP
   client namespaces (`mcp__<server>__<raw>`).
6. A plugin becomes mountable by declaring **`dsh.bundle.patch`** and being listed
   in the profile's **`dsh.profile.bundles`**. `dsh plugin add` does both
   automatically; hand-editing `package.json` is enough if the package is already
   installed.
7. A live-editable setting is a Config field with **`.volatile()`**. The parsed
   value for that field becomes a reference object; the plugin must read it with
   `.get()` **at call time**, never destructure it in `apply`.
8. Saving a form edit re-parses the raw config and **commits new snapshots into
   the running references** (`cordis-plugin-loader/lib/index.js:390`) — **no
   remount**. `ctx.settings.configure({auto:false}, ctx.fiber)` only controls
   whether a form is auto-generated for the entry.
9. Incompatibility is enforced on **`peerDependencies` matching
   `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`**, compared against
   `getDshRuntimeVersion()` — **not** on `engines.dsh`, and not on any
   `dsh.compatibility.dshReleases` field (`dsh-app-boot/lib/index.js:303`).
   `@deepseek-ai/dsh-package-manifest` is **types-only and validates nothing**.
10. `ctx.subprocess`, `ctx.fs`, `ctx.shell`, `ctx.jobs`, `ctx.spillStore` are the
    managed seams. A host plugin **can** call `node:child_process` / `node:fs`
    directly — installed host code runs in the host process and is explicitly
    *not* covered by the workspace sandbox — but it then loses approval,
    sandbox policy, spill, job tracking and managed teardown.

---

## 1. Tool registration

### 1.1 `Tools.register()` — the real entry point

`dsh-tools/lib/index.js:2872-2887`:

```js
	/**
	* Register globally or in the calling agent scope. Scoped tools shadow
	* globals; duplicates within one layer and the reserved `run_code` name fail.
	* @param definition - tool schema, execution, and optional finalization/presentation callbacks.
	* @returns the exact disposer that unregisters the tool.
	*/
	register(definition) {
		const name = definition.name;
		const output = definition.output;
		if (output === void 0 || typeof output !== "object" || typeof output.render !== "function" || output.presentationMeta !== void 0 && typeof output.presentationMeta !== "function") throw new TypeError(`tool "${name}" must declare output { schema, render, presentationMeta? }`);
		assertSupportedJsonSchema(output.schema);
		const timeoutMs = definition.timeoutMs;
		if (timeoutMs !== void 0 && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new TypeError(`tool "${name}" timeoutMs must be a positive finite number`);
		if (name === "run_code") throw new Error(`tool name "${RUN_CODE_NAME}" is reserved for the PTC mode presentation transport and cannot be registered or shadowed`);
		return this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, definition), { label: "tools.register()" });
	}
```

**Hard failures at registration time:** missing/malformed `output`;
`output.schema` outside the enforced subset (`JsonSchemaError`,
`code: 'UNSUPPORTED_SCHEMA'`); non-positive or non-finite `timeoutMs`; the name
`run_code`; a duplicate name inside the same layer
(`dsh-tools/lib/index.js:2634`).

**The `Tools` service class** is `ToolRuntime`, declared at
`dsh-tools/lib/index.js:2663`:

```js
var ToolRuntime = class extends Service {
	static inject = ["systemPrompt"];
	static Config = z.object({
		mode: z.union([ "native", "ptc", "both" ]).default("native"),
		maxParallelSubCalls: z.natural().min(1).default(10)
	});
	…
}
```

It registers as the `tools` service (`super(ctx, "tools")`, `:2704`). Note the
default `mode: "native"` — the model sees every tool's schema directly.

### 1.2 The complete `ToolDefinition` shape

Assembled from `defineTool` (`:838-887`) plus every field the registry reads.
Fields marked **R** are required by `register()`; the rest are optional and
simply absent from the object when not supplied.

| Field | Type | Semantics |
|---|---|---|
| **R** `name` | `string` | The model-facing tool name, verbatim. Must not be `run_code`. Unique within its layer. |
| **R** `description` | `string` | Model-facing description; goes straight into the tool schema (`schemaOf`, `:3039-3048`). |
| **R** `parameters` | author DSL map (via `defineTool`) **or** raw JSON Schema | Compiled to an object-rooted raw schema (`parameterSchemaSpecToJsonSchema`, `:802`). Used to validate model arguments before `execute`. |
| **R** `output.schema` | author DSL node (via `defineTool`) **or** raw JSON Schema | Compiled (`valueSchemaSpecToJsonSchema`, `:792`); the returned value is validated against it. |
| **R** `output.render` | `(args, value) => ContentBlock[]` | Called after validation to produce model-visible content. Its result is JSON-snapshotted (`snapshotProjection`, `:2564`). |
| `output.presentationMeta` | `(args, value) => unknown` | Extra **UI-only** metadata; only called for model-direct (non-nested) dispatches (`:3554`). Also snapshot-validated. |
| **R** `execute` | `(args, exec) => Promise<value>` | The tool body. See §1.3. |
| `deferLoading` | `true` | Emitted on the wire schema; lets the harness defer schema delivery. |
| `timeoutMs` | positive finite number | Enforced by `@deepseek-ai/dsh-tool-call-timeout-policy`, which wraps `tools/execute`, replaces `exec.signal` with a deadline-bound signal, and on expiry replaces the result with a `TOOL_TIMEOUT` error (`dsh-tool-call-timeout-policy/lib/index.js:115-142`). |
| `projectContent` | `(exec, result) => ContentBlock[] \| undefined` | Runs **before** `tools/post-execute` policy; non-`undefined` return replaces `result.content` (`:3361-3367`). |
| `finalizeContent` | `(exec, result) => ContentBlock[] \| undefined` | Runs **after** post-execute policy, immediately before `tools/result` (`:3398-3407`). |
| `presentCall` | `(args) => CallPresentation \| undefined` | Browser card hint for the pending call. `defineTool` only calls it when `args` still validate; `undefined` means "use the generic card". |
| `presentResult` | `(args, result) => ResultPresentation \| undefined` | Browser card hint for the settled result. |
| `isConcurrencySafe` | `(args) => boolean` | `executionMode()` treats **only an exact `true`** as parallel; a throw or any other value means exclusive (`:3057-3065`). |

Anything else you attach to the object is carried but never read by the registry.

### 1.3 `execute` — exact signature, `exec`, and the return contract

**Signature:** `async execute(args, exec)`.

- `args` is the model-supplied arguments object, **already validated** by
  `defineTool`'s wrapper against the compiled parameter schema, and already
  JSON-snapshotted and deep-frozen (`:3167`). Mutating it throws.
- `exec` is the **`ToolExecution`**, minted in `createExecution` (`:3131-3191`):

```js
		const base = {
			token,
			callId,
			rootCallId,
			name,
			signal,
			...agent !== void 0 ? { agent } : {},
			...parent !== void 0 ? { parent } : {},
			...exec.schema !== void 0 ? { schema: exec.schema } : {},
			deferContext(context) {
				deferredContexts.push(context);
			},
			concludeTurn() {
				concludingExecutions.add(this);
			}
		};
		…
			const execution = {
				...base,
				arguments: deepFreeze(detached)
			};
```

So `exec` exposes:

| Member | Meaning |
|---|---|
| `exec.arguments` | The frozen argument snapshot (same data as `args`). |
| `exec.name`, `exec.callId`, `exec.rootCallId` | Identity. |
| `exec.signal` | `AbortSignal`. **Fused** from the caller's signal and any wrapper's replacement signal (`dispatchToolBody`, `:3294-3318`) — always consult it, and pass it into every I/O call. |
| `exec.agent` | The owning `Agent`, or `undefined` for an agentless call. `exec.agent.session.header.cwd` is the session working directory; `exec.agent.session.append(type, data)` writes the durable log. |
| `exec.parent` | Set only for a nested PTC (`run_code`) sub-dispatch. |
| `exec.schema` | Present when the runtime supplied a structured-output schema. |
| `exec.deferContext(message)` | Attach extra context for the **next** model step (this is how an image-bearing result is re-attached). |
| `exec.concludeTurn()` | Declare the turn complete after this call. |

The registry constructs this input at `dsh-agent-loop/lib/index.js:506-514`:

```js
	const planned = toolCalls.map((block) => ({
		block,
		exec: {
			callId: block.id,
			name: block.name,
			arguments: parseArguments(block.arguments),
			agent,
			signal
		}
	}));
```

**Return contract.** Return the **structured domain value** — not a string, not
content blocks. It is then:

```js
	/** Snapshot, validate, render, and optionally project one successful body value. */
	createSuccessResult(exec, tool, candidate) {
		const detached = snapshotToolValue(tool.name, candidate);
		const violations = validateJsonSchemaValue(tool.output.schema, detached, "value");
		if (violations.length > 0) throw new ToolOutputError(tool.name, violations);
		const value = deepFreeze(detached);
		let rendered;
		try {
			rendered = tool.output.render(exec.arguments, value);
		} catch (error) {
			throw projectionError(tool.name, "render", error);
		}
		const content = snapshotProjection(tool.name, "render", rendered);
		…
```

(`:3540-3571`.) Consequences:

- The value must be **losslessly JSON-serializable** — no `Date`, `Map`, `Set`,
  `undefined` entries, `BigInt`, cycles, or class instances. Violations surface
  as `ToolOutputError` (`:2550`) and the call fails with an error block naming
  the offending paths.
- The value must satisfy `output.schema` **exactly**; `additionalProperties:
  false` rejects unknown keys, and every `required` name must be present even if
  its value is `null`.
- `render` must likewise return lossless JSON — an array of content blocks.

**Content blocks.** The two block shapes used by shipped tools:

```js
{ type: "text",  text: "…" }                                  // dsh-tool-todo/lib/index.js
{ type: "image", attachment: { attachmentId, mediaType,       // dsh-tool-fs/lib/index.js:954-962
                               bytes, width, height, name?, originalDimensions? } }
```

### 1.4 How errors must be signalled

**Throw.** There is no `isError` field on the value you return. `dispatchToolBody`
catches everything:

```js
			const returned = await tool.execute(exec.arguments, exec);
			const result = this.createSuccessResult(exec, tool, returned);
			return isAborted(signal) ? toolAbortedResult(result) : result;
		} catch (error) {
			return toolErrorResult(error);
		}
```

(`:3310-3314`.) And `toolErrorResult` (`:3616-3630`):

```js
function toolErrorResult(error) {
	const info = errorInfo(error);
	const message = errorMessage(error);
	return {
		content: [{
			type: "text",
			text: `Error: ${message}`
		}],
		isError: true,
		error: {
			message,
			...info ? { info } : {}
		}
	};
}
```

`errorInfo` (`:2611-2621`) attaches `{ name, code }` **only** for a
`@deepseek-ai/dsh-llm` `HarnessError` subclass, so throw a `HarnessError` when you
want a machine-readable code on the wire:

```js
import { HarnessError } from '@deepseek-ai/dsh-llm';
throw new HarnessError('device not reachable', 'EMU_UNREACHABLE');
```

Two special error paths you get for free:

- A parameter-schema violation never reaches your body: `defineTool` throws
  `ToolArgsError` (`:813-821`, `code: 'INVALID_ARGS'`) with per-path violations.
- A caller cancellation that arrives before the body starts, or replaces a
  successful outcome, becomes `ABORTED_BEFORE_DISPATCH` / `ABORTED`; always
  call `exec.signal.throwIfAborted()` or pass `exec.signal` down.

**A result object with `isError` may only be authored by a
`tools/post-execute` waterfall listener** (`:3495-3527`), never by `execute`.

### 1.5 The enforced JSON Schema subset

`dsh-tools/lib/types/json-schema.js:34-43` — the whole vocabulary:

```js
const CONSTRAINT_KEYWORDS = new Set([
    'type',
    'oneOf',
    'properties',
    'required',
    'additionalProperties',
    'items',
    'enum',
    'const',
]);
const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'default', 'examples']);
const SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
```

Anything else is a **hard rejection**, not a silently-ignored keyword
(`json-schema.js`, `checkSchemaNode`):

> ``${path}.${key} is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)``

Additional constraints, all from the same walk:

- `type` must be **one** string from `SCHEMA_TYPES` — `type` arrays are rejected
  explicitly: `"type arrays are not supported"`.
- `type` and `oneOf` are mutually exclusive; `oneOf` needs **≥ 2** branches and
  no sibling `properties`/`required`/`additionalProperties`/`items`/`enum`/`const`.
- `properties`/`required`/`additionalProperties` require `type: "object"`;
  `items` requires `type: "array"`; `enum`/`const` require a scalar type.
- `additionalProperties` must be a **boolean**.
- `required` must be an array of strings, each naming a declared property.
- `enum` must be a non-empty array of type-correct scalars; `const` must be a
  type-correct scalar and, when `enum` is also present, a member of it.
- Any node with no `type` and no `oneOf` is an **annotation-only schema** =
  unconstrained JSON (as long as it declares none of the object/array keywords).
- A cyclic schema is rejected: `"${path} is circular"`.
- `assertObjectJsonSchema` additionally requires an object root; that variant is
  used for subagent/workflow structured output, not for tools.

**Is zod accepted?** **No.** `register()` calls `assertSupportedJsonSchema(output.schema)`
and `defineTool` calls it on the compiled parameter and output schemas. A zod
object has no `type`/`properties` enumerable keys and fails
`"schema must be a schema object"`. zod *is* a dependency of
`dsh-tool-todo` (`zod: ^4.4.3`), but it is used for **session-projection wire
schemas**, not for tool parameters.

**The author DSL that `defineTool` compiles.** `dsh-tools/lib/index.js:586-811`.
Per-node vocabulary:

| Node | Allowed keys | Notes |
|---|---|---|
| any | `description`, `title`, `default`, `examples` | annotations, copied verbatim |
| object | `type:'object'`, `properties`, `additionalProperties` | **`additionalProperties` is mandatory and must be an explicit boolean** — `authorError(\`${path}.additionalProperties must be explicitly true or false\`)` (`:699`). `required` may **not** appear on the object node itself; it is derived. |
| array | `type:'array'`, `items` | `items` is compiled with `allowRequired:false`, so `required` is illegal inside `items` |
| scalar | `type:'string'\|'number'\|'integer'\|'boolean'\|'null'`, `enum`, `const` | `enum` is copied; `const` is copied |
| oneOf | `oneOf` (≥ 2) | `type` is forbidden beside it |
| `json` | `type:'json'` | author-only: becomes an **annotation-only** schema (unconstrained JSON) |
| property | any node **+ `required: true`** | the only place `required` is legal; `required` must be exactly `true` when present (`:603`) and promotes the key into the parent's `required` array |
| parameters root | an implicit open object | `parameterSchemaSpecToJsonSchema` builds `{type:'object', properties, required?}` — the root does **not** get `additionalProperties:false` |

Round-trip evidence from the shipped example (`docs/research/example-plugin/verify.mjs`
run against the real `defineTool`): `{ argv: {type:'array', required:true, items:{type:'string'}} , env:{type:'object',additionalProperties:true} }`
compiles to

```json
{"type":"object","properties":{"argv":{"type":"array","items":{"type":"string"}},
 "env":{"type":"object","additionalProperties":true}},
 "required":["argv"]}
```

and `{"argv":[1,2]}` yields
`['"argv[0]" must be a string','"argv[1]" must be a string']`.

**Nullability** has no `type` array form and no `optional()`. Use an exact-one
`oneOf`, as the example plugin does:

```js
exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
```

### 1.6 `ctx.effect(...)` wrapping and the returned disposer

**You do not need to wrap registration in `ctx.effect`.** `register()` already
returns a fiber-bound effect disposer. `ScopedLayers.effect`
(`dsh-scope/lib/index.js:182-211`) documents itself as:

> Attach one synchronous layer mutation to its registration context. …
> **@returns the exact disposer returned by `ctx.effect()`.**

and cordis' `Service` tracker (`cordis/lib/index.js:84-90`, `:123-160`, `:1770-1784`)
makes `this.ctx` inside a service method resolve to the **caller's** context via a
proxy (`tracker = { associate: name, property: "ctx" }`), so
`this.layers.effect(this.ctx, …)` in `ToolRuntime.register` binds to the
registering plugin's fiber.

Verified empirically against the real `ToolRuntime`:

```
A. visible after register .............. true      // ctx.tools.register(def())
C. visible after returned disposer() ... false
B. visible after child register ....... true
B. visible AFTER child fiber dispose .. false      // after awaiting dispose()
D. duplicate throws ................... tool "probe_d" is already registered (for a per-agent variant, register through that agent's `agent.ctx` instead)
E. re-register after dispose is OK .... true
```

Two operational consequences:

- **`fiber.dispose()` returns a `Promise`.** A synchronous check right after
  `dispose()` still sees the tool; await it (or the next macrotask) before
  asserting teardown. `dsh-hmr` relies on this.
- The duplicate-name check is per **layer**, not per plugin fiber. Two plugins
  registering the same name in the same layer collide — so **namespace your tool
  names by hand** (§2.1).

Wrap in `ctx.effect` only when you must bundle registration with other side
effects into one ordered teardown, e.g.

```js
ctx.effect(() => {
  const dispose = ctx.tools.register(defineTool({…}));
  const stop   = startSomeWatcher();
  return () => { stop(); dispose(); };
}, 'my-plugin: tools');
```

### 1.7 Scoping / layer rules and the "inject entry would hold ctx.tools" note

Layers key on **agent scope**, not plugin identity. `ScopedLayers` holds one
eager `global` layer plus per-scope overlays; `scopeOf(ctx)` returns a scope only
for an agent context (`dsh-scope`, `dsh-tools/lib/index.js:2960-2985`):

```js
	view(scope) {
		const layers = this.layers.chainLayers(scope);
		const own = this.layers.peek(scope);
		const inherited = new Map(this.layers.global.tools.entries());
		for (const layer of layers) {
			if (layer === own) continue;
			for (const [name, definition] of layer.tools.entries()) inherited.set(name, definition);
		}
		const visible = new Map();
		const knownNames = new Set();
		const restrictableNames = new Set();
		for (const [name, definition] of inherited) {
			knownNames.add(name);
			restrictableNames.add(name);
			if (layers.every((layer) => layer.admits(name))) visible.set(name, definition);
		}
		if (own !== void 0) for (const [name, definition] of own.tools.entries()) {
			knownNames.add(name);
			visible.set(name, definition);
		}
		if (this.modeFor(scope) !== "native") visible.set(RUN_CODE_NAME, this.requirePtcTransport());
		return { visible, knownNames, restrictableNames };
	}
```

Rules:

- A global (`agent.ctx` absent) registration is visible to every agent.
- A registration made through that agent's `agent.ctx` shadows a global of the
  same name for that agent's subtree (nearest scope wins).
- `tools.restrict({allow,deny})` and `tools.guard(fn)` require a **scoped**
  context and are rejected on a plain context (`:2895-2926`).
- The registry deliberately **reads** `ctx.ptcRuntime` with `ctx.get()` rather
  than declaring it in `static inject`, and the JSDoc states the reason verbatim
  (`:2849-2862`):

  > Read at use time (assembly / run_code execution), NOT via static `inject`:
  > **an inject entry would hold `ctx.tools` — and every tool plugin behind it —
  > hostage to a PTC runtime existing even under `mode: 'native'`.**

  That is the general rule for optional collaborators: **`inject` only what must
  exist for the plugin to be meaningful; `ctx.get('x')` everything you can
  degrade around.**

### 1.8 A complete real registered tool, verbatim

`@deepseek-ai/dsh-tool-todo/lib/index.js` (whole file is 160 lines; this is the
registration and the module contract):

```js
import z from "@deepseek-ai/schemastery";
import { z as z$1 } from "zod";
import { defineTool } from "@deepseek-ai/dsh-tools";
…
const name = "tool-todo";
const inject = ["tools", "sessionProjections"];
…
const Config = z.object({ allowParallelInProgress: z.boolean().required() });
…
function apply(ctx, config) {
	const allowParallel = config.allowParallelInProgress;
	ctx.sessionProjections.register({ … });
	ctx.tools.register(defineTool({
		name: "todo_write",
		description: describe(allowParallel),
		parameters: { todos: {
			type: "array",
			required: true,
			description: "The COMPLETE task list, replacing any previous list.",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					content: { type: "string", required: true, description: "What the task is — a short imperative line." },
					status: { type: "string", required: true, enum: [...STATUSES],
					          description: "pending (not started) | in_progress (now) | completed (done)." }
				}
			}
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					todos: { type: "array", required: true, items: { … } },
					counts: { type: "object", additionalProperties: false, required: true, properties: {
						pending: { type: "integer", required: true },
						inProgress: { type: "integer", required: true },
						completed: { type: "integer", required: true }
					} }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `Updated todo list: ${value.counts.pending} pending, ${value.counts.inProgress} in progress, ${value.counts.completed} completed.`
			}]
		},
		execute(args, exec) {
			const todos = toTodoList(args.todos, allowParallel);
			if (!exec.agent) throw new Error("todo_write requires an owning agent session");
			exec.agent.session.append("todo/write", { todos });
			const count = (status) => todos.filter((t) => t.status === status).length;
			return Promise.resolve({
				todos: todos.map((todo) => ({ content: todo.content, status: todo.status })),
				counts: { pending: count("pending"), inProgress: count("in_progress"), completed: count("completed") }
			});
		},
		presentCall: (args) => ({ card: "generic", title: "Update todo list", kind: "other", rawInput: args.todos })
	}));
}
export { Config, apply, inject, name };
```

`@deepseek-ai/dsh-tool-present/lib/index.js:6-15` shows the same contract in
miniature — this is the smallest complete shipped host tool plugin:

```js
import z from "@deepseek-ai/schemastery";
import { FsError } from "@deepseek-ai/dsh-fs";
import { defineTool } from "@deepseek-ai/dsh-tools";
/** Stable Loader identity. */
const name = "tool-present";
/** Validated delivery limit. */
const Config = z.object({ maxFiles: z.number().default(8) });
/** Services used by the scoped delivery tool. */
const inject = [ "tools", "fs", "sessionProjections" ];
…
export { Config, apply, inject, name };
```

Note the **module contract**: `name`, `Config`, `inject`, `apply` as **named
exports**. `cordis-plugin-loader/lib/index.js:664-669` unwraps them:

```js
	unwrapExports(exports) {
		if (isNullable(exports)) return exports;
		exports = exports.default ?? exports;
		if (!exports.__esModule) return exports;
		return exports.default ?? exports;
	}
```

so **either** named exports **or** `export default { name, Config, inject, apply }`
works — but do not mix a `default` that lacks `apply` with named exports.

### 1.9 Carrying an image out of a tool

The real implementation is `read_image` in `dsh-tool-fs/lib/index.js:944-962`:

```js
/**
* Project one structured image read into its model-facing envelope and image.
* @param value - the image-read outcome.
* @returns the two content blocks used by native and nested dispatches.
*/
function imageReadContent(value) {
	return [{
		type: "text",
		text: formatImageReadOutput(value.path, value.image)
	}, {
		type: "image",
		attachment: imageRefFromValue(value.image)
	}];
}
```

and the reference it builds (`:921-931`):

```js
function imageRefFromValue(image) {
	return {
		attachmentId: AttachmentId(image.attachmentId),
		mediaType: image.mediaType,
		bytes: image.bytes,
		width: image.width,
		height: image.height,
		...image.name === void 0 ? {} : { name: image.name },
		...image.originalDimensions === void 0 ? {} : { originalDimensions: { ...image.originalDimensions } }
	};
}
```

The pipeline requires the image to be a **durable attachment**, not raw bytes:
`attachments.saveImage({ data, mediaType, name })` from `ctx.attachments`
(`dsh-tool-fs/lib/index.js:994-999`). `IMPORTANT` gates, all enforced by that
tool and worth copying:

- the **model route** must declare image input, or the read is refused
  (`assertImageCapableRoute`, `:890-906`);
- the deployment's `imageLimits.mediaTypes` must accept the media type;
- byte / pixel / dimension limits produce distinct, actionable errors.

The harness then keeps an image-bearing result in front of the model even
through a PTC collapse — `dsh-tools/lib/index.js:1384-1386`:

```js
							if (!result.isError && result.content.some((block) => block.type === "image")) exec.deferContext(createUserMessage({
								content: result.content,
```

There is **no** base64/`data:` path in `dsh-tools`; attachments are the only
sanctioned image channel, and `grep -l 'type: "image"'` over the bundle finds it
only in `dsh-tool-fs`, `dsh-attachment`, `dsh-mcp-client`, `dsh-llm-*`,
`dsh-commands`, `dsh-acp`, `dsh-sdk-jsonrpc-server` and client UI packages.

---

## 2. Naming, visibility, and how the plugin gets mounted

### 2.1 No prefixing — but that means you must namespace yourself

`schemaOf` (`dsh-tools/lib/index.js:3039-3049`) projects `name` through
untouched:

```js
	schemaOf(definition, detachParameters) {
		const { name, description, parameters, deferLoading } = definition;
		const detached = detachParameters ? snapshotJsonValue(parameters) : parameters;
		if (detached === void 0) throw new Error(`tool "${name}" parameters must be lossless JSON before schema projection`);
		return { name, description, parameters: detached, ...deferLoading === true ? { deferLoading } : {} };
	}
```

and `dsh-system-prompt/lib/index.js:324-331` copies that straight into the
provider output. **A host plugin's tool appears to the model under exactly the
string it registered.** The only namespacing in the tree is the MCP client
(`dsh-mcp-client/lib/index.js:97`):

```js
	const joined = `mcp__${serverName}__${rawName}`;
```

Since duplicates collide per layer (§1.6), pick a stable prefix yourself
(`emu_devices`, `emu_screenshot`, …). A collision is a **startup failure of the
second registration**, not a silent shadow.

### 2.2 How tool schemas reach the model, and in what order

`ToolRuntime`'s constructor registers one global schema provider
(`:2707`):

```js
		ctx.systemPrompt.tools((context) => this.wireSchemas(context.scope));
```

`systemPrompt.tools(provider)` (`dsh-system-prompt/lib/index.js:286-289`) attaches
that provider to the calling context's layer. At assembly
(`:305-360`) every provider is evaluated and its `{name, description, parameters}`
collected; ordering is then decided by `dsh-system-prompt`'s `Config.toolOrder`
(`:62-90`):

```js
function orderTools(tools, toolOrder, knownNames) {
	if (tools.find((tool) => tool.name === "<unlisted-tools>") !== void 0) throw new Error(`tool provider returned reserved tool name "${TOOL_ORDER_REST}" (reserved for toolOrder's rest entry)`);
	if (toolOrder === void 0) return tools.sort(compareToolNames);
	…
```

**With no `toolOrder` configured, tools are sorted lexicographically by name**
(`dsh-system-prompt/lib/index.js:101-103`: `compareToolNames` → `compareNames`, a
locale-independent code-unit comparison). The `SECTION_ORDERS`
table (`:12-45`) orders *prompt sections*, not tool schemas; a tool that wants its
own guidance section registers one and picks an order from that table, exactly as
`dsh-tool-bash` does (`dsh-tool-bash/lib/index.js:373-377`):

```js
	ctx.systemPrompt.section({
		name: "tool:bash",
		order: ctx.systemPrompt.getSectionOrder("TOOL_BASH"),
		text: "Check the [exit code: N] marker on every bash result; investigate failures before moving on."
	});
```

There is **no** section-order constant for a third-party tool — passing an
arbitrary finite `order` is legal (`systemPrompt.section` only requires
`Number.isFinite`), so choose a number in a gap of the table (e.g. `3_500`).

### 2.3 `dsh.profile.bundles` vs `cordis.patch.yml` — you need the bundle

Three layers compose, in this order:

1. every installed bundle's own `dsh.bundle.patch`, in the order the bundle
   appears in the profile's `dsh.profile.bundles`;
2. the profile's `cordis.patch.yml`;
3. the harness-home `cordis.patch.yml`.

`bundlePatchFiles` accepts a string **or an ordered list**
(`dsh-app-boot/lib/index.js:495-509`):

```js
function bundlePatchFiles(bundle) {
	const declared = typeof bundle.patch === "string" ? [bundle.patch] : bundle.patch;
	if (!Array.isArray(declared) || !declared.every((file) => typeof file === "string")) throw new Error("dsh.bundle.patch must be a file path or a list of file paths");
	return declared;
}
function bundlePatchPaths(packageDir, bundle) {
	return bundlePatchFiles(bundle).map((file) => join(packageDir, file));
}
```

`dsh-plugin-manager` reads that metadata with **no JS execution**
(`dsh-plugin-manager/lib/types/operations.js:31-38`) and reorders the profile
manifest (`:46-77`):

```js
export function bundleManifest(name, dir, anchor) {
    const packageDir = resolveBundleDir('dsh', name, anchor, dir);
    const manifest = readProfileManifest('dsh', packageDir);
    return manifest.dsh?.bundle?.patch === undefined ? undefined : manifest;
}
…
async function reconcile(before, dir, anchor, options) {
    …
    for (const name of dependencies) {
        if (beforeDeps.has(name)) continue;
        const metadata = bundleManifest(name, dir, anchor);
        if (metadata?.dsh?.bundle === undefined) {
            options.onOutput?.(`dsh: warning: ${name} declares no dsh.bundle — installed as a plain dependency, not a profile layer\n`, 'stderr');
            continue;
        }
        for (const file of bundlePatchPaths(resolveBundleDir('dsh', name, anchor, dir), metadata.dsh.bundle))
            loadOverlayPatches('dsh', file);
        if (!bundles.includes(name)) bundles.push(name);
    }
    …
    after.dsh = { ...after.dsh, profile: { ...after.dsh?.profile, bundles } };
    await saveManifest(dir, after);
}
```

So:

- **A package with no `dsh.bundle.patch` is installed but never mounted.** It
  lands in `dependencies` and prints the warning above.
- **A package with `dsh.bundle.patch` is auto-appended to
  `dsh.profile.bundles` by `dsh plugin add`.** Hand-adding the name to
  `dsh.profile.bundles` in the profile's `package.json` is equally sufficient —
  `bundles` is the only selection mechanism.
- The bundle patch itself must `insert` the row; being in `bundles` mounts
  nothing on its own.

Verified against a throwaway profile:

```console
$ DSH_HOME=… node …/dsh/lib/bin.js plugin --profile probe add "$PWD/example-plugin"
dependencies:
+ dsh-example-host-tool link:/Users/…/docs/research/example-plugin
…
$ cat profiles/probe/package.json
{
  "name": "dsh-profile-probe", "private": true,
  "dsh": { "profile": { "bundles": [ "dsh-example-host-tool" ] } },
  "dependencies": { "dsh-example-host-tool": "link:/Users/…/example-plugin" }
}
$ DSH_HOME=… node …/dsh/lib/bin.js --profile probe --dump-config
# == dsh-example-host-tool
- id: example-host-tool
  name: dsh-example-host-tool
  config:
    prefix: host-run
    timeoutMs: 15000
    maxBytes: 65536
    maxArgv: 64
```

---

## 3. Config schema and live-editable (volatile) settings

### 3.1 The import is `@deepseek-ai/schemastery`, and only that

```js
import Schema from '@deepseek-ai/schemastery';
```

`schemastery/package.json` publishes `.` with `import → lib/index.mjs`,
`require → lib/index.cjs` and **a default export**. `@deepseek-ai/cordis` does
**not** re-export it — its full export list is
`cordis/lib/index.js:1829`, and `Schema` is not in it:

```js
export { Context, CordisError, DisposableList, EventsService, Fiber, Inject, Logger, LoggerService, RegistryService, Service, ValidationError, buildOuterStack, c16, c256, composeError, createCallable, defaultFormatters, getPropertyDescriptor, getTraceable, isBailed, isConstructor, isObject, joinPrototype, resolveConfig, symbols, withProps };
```

(The profile's `node_modules/@deepseek-ai/schemastery` is a *hoisted* copy at
3.18.4, identical to the bundle's.)

How the schema is used: `cordis/lib/index.js:956-964`

```js
function resolveConfig(runtime, config) {
	if (!runtime.Config) return config;
	const result = runtime.Config["~standard"].validate(config);
	if ("then" in result) throw new TypeError("Async config validation is not supported");
	if (result.issues) throw new ValidationError(result.issues);
	else return result.value;
}
```

i.e. **Standard Schema**. Any object implementing `~standard.validate` works, but
schemastery is the one the settings machinery understands (it reads `.toJSON()`
and `.meta`).

### 3.2 `.volatile()` — exact API and semantics

`schemastery/lib/index.mjs:235-238`:

```js
Schema.prototype.volatile = function volatile() {
	if (this.meta.volatile) throw new TypeError("volatile schema is already wrapped");
	return this.extra("volatile", true);
};
```

Validation constraints, `schemastery/lib/index.mjs:240-256`:

```js
function validateVolatileSchema(schema, path = [], blocked = false, seen = new Map()) {
	…
	if (schema.meta?.volatile && blocked) throw new ValidationError("volatile fields require a fixed object path without an enclosing volatile field", { path });
	const nested = blocked || !!schema.meta?.volatile;
	if (schema.dict) for (const [key, child] of Object.entries(schema.dict)) validateVolatileSchema(child, [...path, key], nested, seen);
	if (schema.sKey) validateVolatileSchema(schema.sKey, [...path, "<key>"], true, seen);
	if (schema.inner && (schema.type !== "lazy" || schema.inner[kSchema])) validateVolatileSchema(schema.inner, [...path, "*"], true, seen);
	if (schema.list) for (let index = 0; index < schema.list.length; index++) validateVolatileSchema(schema.list[index], [...path, String(index)], true, seen);
}
```

and the parse-time wrapping, `schemastery/lib/index.mjs:265-275`:

```js
	if (schema.meta?.volatile) {
		const inner = Schema(schema);
		inner.meta = { ...schema.meta, volatile: false };
		const [value, adapted] = Schema.resolve(data, inner, options, strict);
		try {
			return [createVolatile(value), adapted];
		} catch (error) {
			throw new ValidationError(error instanceof Error ? error.message : String(error), options);
		}
	}
```

`createVolatile` / `updateVolatile`, `cosmokit/lib/index.js:102-114` and `:149-151`:

```js
function createVolatile(value) {
	let current = snapshot(value);
	return Object.freeze({
		get: () => current,
		[write]: (value) => {
			current = value;
		}
	});
}
…
function updateVolatile(target, source) {
	target[write](source.get());
}
```

**Summary of the contract:**

- A field is live-editable **iff** `.volatile()` is somewhere on it or on an
  ancestor object schema.
- After parsing, a volatile field's value is a frozen `{ get(): T }`; everything
  else is a plain value. The only other accessor is
  `isVolatile(v) === true` (via `write in v`, `cosmokit/lib/index.js:116-118`).
- Volatile fields must sit at a **fixed object path**: not inside `array.items`,
  not in a `dict` value, not inside another volatile field, and no duplicate
  `.volatile()`.
- `.volatile()` returns a *new* schema; chain it last, or at least after
  `.default()`/`.description()`. Order is irrelevant to correctness
  (`.description()` etc. clone via `Schema(this)`), but the trailing form reads
  best.

### 3.3 The other annotation methods

From `schemastery/lib/index.mjs`:

| Method | Line | Effect |
|---|---|---|
| `.default(v)` | `:224-235` (the loop over `['default','link','comment','description','max','min','step']`) | `meta.default`; fills omitted/null values at resolve time and becomes the JSON Schema `default` annotation |
| `.description(s)` | same loop | `meta.description`; projected as `description` and as the settings-form label |
| `.comment(s)` | same loop | `meta.comment`; projected into `x-cordis.comment` in the generated schema (`dsh-app-boot/lib/index.js:2680-2694`) |
| `.role(role, extra)` | `:216-223` | `meta.role`. `'secret'` is the meaningful value: `plainSchema` strips the volatile mark **and** deletes `default`/`required`, and `redactSecrets` removes the field from every value handed to a remote caller (`dsh-settings/lib/index.js:73-89`, `:103-117`) |
| `.required()` | schemastery | `meta.required`; makes a missing value a validation error |
| `.min/.max/.step` | `:224-235` | numeric bounds, projected as `minimum`/`maximum` |
| `.pattern(re)` | `:168-178` | `meta.pattern`; projected as `pattern` |
| `.deprecated()`, `.experimental()` | `:140-166` | UI badges |

Pattern for a secret field (this is *both* a live field and a redacted one):

```js
apiKey: Schema.string().role('secret').description('API token.').volatile(),
```

### 3.4 The Settings service, the form projection, and `configure`

`dsh-settings/lib/index.js:321-381` — the service is `settings` and `configure` is:

```js
/**
* Register the calling plugin instance's page policy without changing its Config.
* @param presentation Automatic-page policy for this instance; `auto` defaults to true.
* @param owner Plugin instance the policy belongs to; defaults to the calling fiber.
* @returns Disposer; register it with the calling plugin's effects.
* @throws If this instance already has a registered policy.
*/
configure(presentation, owner = this.ctx.fiber) {
	const fiber = owner;
	if (this.presentations.has(fiber)) throw new Error("Settings presentation is already configured for this plugin instance");
	const policy = { ...presentation };
	this.presentations.set(fiber, policy);
	this.invalidate();
	return () => { … };
}
```

- **First argument** is the presentation policy; the only documented key is
  `auto` (default `true`).
- **Second argument** is the **plugin instance (fiber) the policy belongs to**;
  it defaults to the caller's fiber but **must be passed explicitly when the call
  happens on a child scope**. Every shipped call site does exactly that, always
  inside `ctx.inject(['settings'], …)` + `ctx.effect(...)`, because `settings` is
  an optional collaborator:

  `dsh-llm-deepseek/lib/index.js:2248`
  ```js
  	ctx.inject(["settings"], (child) => {
  		child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  	});
  ```

  `dsh-client-locale/lib/index.js:18-27` is the smallest complete real example:

  ```js
  /** Live preferences projected to the browser. */
  const Config = z.object({ [LOCALE_PREFERENCE_FIELD]: LocaleSettingsFields[LOCALE_PREFERENCE_FIELD].volatile() });
  /** Host preferences are consumed through the configuration form projection.
  * @param ctx Plugin context used for optional settings presentation.
  */
  function apply(ctx) {
  	ctx.inject(["settings"], (child) => {
  		child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  	});
  }
  ```

- `{ auto: false }` means: **do not auto-generate a settings page for this
  entry** — the plugin ships its own client-side card. `describe()` reads
  `this.presentations.get(entry.fiber)?.auto ?? true` and returns it as the
  descriptor's `autoGenerate` (`:426`).

**When is `configure` needed at all?** Only when you replace the auto form with
your own UI. A host-only plugin with a volatile Config needs **nothing** beyond
`.volatile()` — the form appears automatically.

**What makes an entry appear in the form list at all** (`describe`, `:413-452`):

```js
	describe(options) {
		const active = new Set();
		const descriptors = this.ownerContext.configEditor.configuration().flatMap(({ entry, inherited, override }) => {
			const schema = this.schema(entry);
			if (schema === void 0 || entry.fiber === void 0 || entry.fiber.runtime === null || entry.fiber.state !== 2) return [];
			const form = volatileForm(schema);
			if (form === void 0) return [];
			active.add(entry.id);
			…
			return [{
				autoGenerate,
				ns: entry.options.id,
				schema: form.toJSON(),
				revision,
				applies: "live",
				value: …,
				base: …,
				user: …
			}];
		});
```

with (`:103-131`):

```js
function plainSchema(schema) {
	const result = new z(schema.toJSON());
	const walk = (node) => {
		delete node.meta.volatile;
		if (node.meta.role === "secret") { delete node.meta.default; delete node.meta.required; }
		else if (node.meta.default !== void 0) node.meta.default = redactSecrets(node, node.meta.default).value;
		for (const child of Object.values(node.dict ?? {})) walk(child);
		if (node.inner) walk(node.inner);
		for (const child of node.list ?? []) walk(child);
	};
	walk(result);
	return result;
}
/** Select fields whose nearest volatile ancestor makes them editable without remounting.
* @param schema The plugin's Config schema.
* @returns A plain form schema, or undefined when no field is live.
*/
function volatileForm(schema) {
	if (schema.meta.volatile) return plainSchema(schema);
	if (schema.type === "object") {
		const dict = Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
			const field = volatileForm(child);
			return field === undefined ? [] : [[key, field]];
		}));
		return Object.keys(dict).length === 0 ? undefined : z.object(dict);
	}
}
```

Three consequences that bite:

1. **`volatileForm` returns `undefined` when no field is volatile → the entry
   never reaches the browser at all.** `dsh-web-search-free` states this as a
   hard requirement in its own source (`dsh-web-search-free/dist/index.js:44-57`):
   *"They are mandatory, not an optimization."*
2. `role('secret')` fields are `undefined`-valued in the descriptor unless the
   caller asked for secrets; `mutate()` re-supplies the inherited value so an
   unrelated edit does not wipe them (`:488-500`).
3. `describe()` reports `applies: "live"` for every field it emits.

**Writes** go through `update` / `replace` / `mutate` → `write` (`:470-537`),
which enforces:
- `"No configurable plugin entry \"<ns>\""` when the `ns` is not an active entry
  id;
- `"Plugin entry \"<ns>\" has no volatile fields"`;
- `"Config field \"<path>\" is not volatile"` for any touched path that is not
  under a volatile node;
- optimistic concurrency via `expectedRevision` → `SettingsConflictError`
  (`code: 'SETTINGS_CONFLICT'`);
- only lossless-JSON values (`cloneJsonShaped`, `:237-273`).

`write` persists through `configEditor.edit(...)`, which rewrites the profile's
`cordis.patch.yml` (`documentPath`, `:400-408`). **`ns` is the entry id**, i.e.
the `id:` in your `insert:` row — not the settings namespace and not the package
name.

### 3.5 Are UI saves applied live? Yes — no remount

`cordis-plugin-loader/lib/index.js:380-421`:

```js
		if (this.fiber?.uid) {
			const changes = Object.keys({ ...this.options, ...legacy })
				.filter((key) => !deepEqual(this.options[key], legacy[key], key === "config"));
			const volatileOnly = changes.length === 1 && changes[0] === "config" && this.fiber.state === 2
				&& Object.getPrototypeOf(this.ctx) === this.parent.ctx
				&& equalExceptVolatile(legacy.config, this.options.config, this.fiber.runtime?.Config);
			if (volatileOnly) this.fiber._config = this.options.config;
			const pending = volatileOnly && this._commitVolatile() ? [] : changes;
			if (!pending.length && !force) return;
			this.context.emit("loader/partial-dispose", this, legacy, true);
			this._patchContext(pending);
		} else await this.init();
	}
	/**
	* Parse a volatile-only raw config change and commit its values into the running fiber's references.
	* An invalid candidate is logged and leaves the running references unchanged; the raw config stays retained for the next activation.
	* @returns `false` when an ordinary effective value changed, so the caller applies the ordinary update lifecycle.
	*/
	_commitVolatile() {
		const fiber = this.fiber;
		const refs = volatileEntries(fiber.config);
		if (!refs.length) return true;
		const raw = this.options.config;
		let candidate;
		try {
			candidate = resolveConfig(fiber.runtime, fiber.ctx.waterfall(fiber, "internal/config", raw, () => raw));
		} catch (error) {
			this.ctx.logger.warn("volatile config update failed for %C", this.options.id);
			this.ctx.logger.warn(error);
			return true;
		}
		if (!deepEqual(fiber.config, candidate, true)) {
			this.ctx.logger.debug("ordinary config values of %C changed with its volatile values; applying the ordinary update", this.options.id);
			return false;
		}
		const paths = refs.flatMap(({ path, ref }) => {
			const source = path.reduce((value, key) => Reflect.get(value, key), candidate);
			if (deepEqual(ref.get(), source.get(), true)) return [];
			updateVolatile(ref, source);
			return [path];
		});
		if (!paths.length) return true;
		const self = Object.create(fiber.ctx);
		self[Context.filter] = (owner) => owner.fiber === fiber;
		try {
			fiber.ctx.emit(self, "loader/volatile-update", paths);
		} catch (error) {
			this.ctx.logger.warn(error);
		}
		return true;
	}
```

Precise semantics:

- **Volatile-only change** → re-parse, `updateVolatile` each changed reference in
  place, emit **`loader/volatile-update`** with the changed paths. No remount, no
  `apply` re-run, no plugin restart. The running object graph sees new values.
- **Any ordinary (non-volatile) value also changed** → the volatile fast path
  returns `false` and the ordinary update lifecycle runs (partial dispose +
  re-init). So mixing a volatile edit and an ordinary edit in one save costs you
  a remount.
- An **invalid** candidate is logged and the running references are left alone.
- If the entry has **no** volatile refs, `_commitVolatile` returns `true`
  immediately — but `volatileOnly` was already false, so this is moot.
- `ctx.on('settings/document-updated', (ns, revision) => …)` and
  `ctx.on('loader/volatile-update', (paths) => …)` are the two observable hooks.
- Whether a change reloads at all also depends on HMR: `dsh-hmr` watches the
  profile manifest and both user patch files; without it, changes need a restart
  (`dsh-app-boot/README.zh.md`, "Profile" section).

**Verified offline** (`docs/research/example-plugin/verify.mjs`, mirroring
`_commitVolatile` against a real parsed Config):

```
ok   every field carries meta.volatile -- 4
ok   parsed fields are Volatile references -- {"prefix":"object","timeoutMs":"object",…}
ok   .get() unwraps the default -- "host-run"
ok   volatileForm() projects all 4 fields -- ["prefix","timeoutMs","maxBytes","maxArgv"]
ok   changed paths committed in place -- ["prefix","timeoutMs"]
ok   existing reference observes the new value -- "EDITED-IN-UI"
```

### 3.6 Reading a volatile field at call time — the canonical pattern

`dsh-web-search-free/dist/index.js:100-137`, verbatim (a real third-party
plugin, v1.8.0, whose comments document the dsh ≤0.1.6 → ≥0.1.7 transition):

```js
/**
 * The entry's own Config, every field live-editable. On dsh >= 0.1.7 this is
 * what the settings form is projected from; on <= 0.1.6 the volatile marks are
 * inert meta the host ignores, and `liveConfig` below unwraps what schemastery
 * wrapped so the rest of the plugin never sees the difference.
 */
export const Config = Schema.object((() => {
    const marked = {};
    for (const [key, schema] of Object.entries(configFields())) {
        marked[key] = schema.volatile();
    }
    return marked;
})());
/** The same fields unmarked, for dsh <= 0.1.6's `settings.register`. */
const SettingsConfig = Schema.object(configFields());
/** Read one field, whichever of the two forms the host supplied. */
function readLive(value) {
    return value !== null &&
        typeof value === 'object' &&
        typeof value.get === 'function'
        ? value.get()
        : value;
}
/**
 * Flatten the entry config to plain values, read fresh at each call.
 *
 * On dsh >= 0.1.7 every read goes through the volatile reference, so a key
 * saved in the settings form reaches the next search without a restart — the
 * job `settings.register`'s scope did on older hosts.
 */
function liveConfig(raw) {
    const out = {};
    const sink = out;
    for (const [key, value] of Object.entries(raw ?? {}))
        sink[key] = readLive(value);
    return out;
}
```

and its consumer (`:369-390`):

```js
    let resolved = () => liveConfig(config);
    …
        // profile entry id and projects them from the entry's own volatile Config,
        …
            base: liveConfig(config),
        …
            resolved = () => liveConfig(config);
```

**The rule:** never do `const { timeoutMs } = config` at `apply` time and close
over the number. Either read `config.timeoutMs.get()` at each use, or project
through a `liveConfig(config)` helper each call. Both are correct; the second
scales to many fields and stays agnostic about whether the host wrapped the
value.

### 3.7 Complete real `Config` examples

**(a) Bundled, minimal, in production** — `dsh-bash-local/lib/index.js:66-74`:

```js
	static Config = z.object({
		cwd: z.string().volatile(),
		timeoutMs: z.number().default(12e4).volatile(),
		maxTimeoutMs: z.number().default(6e5).volatile(),
		maxOutputBytes: z.number().default(64e3).volatile(),
		maxSpillBytes: z.number().default(DEFAULT_MAX_SPILL_BYTES).volatile(),
		graceMs: z.number().default(DEFAULT_GRACE_MS).volatile()
	});
```

**(b) Third-party, idiomatic for a settings page** —
`dsh-web-search-free/dist/index.js:59-72` (abridged to four fields; the real file
has 22):

```js
const configFields = () => ({
    jinaApiKey: Schema.string().description('API key(s) for Jina AI. One key per line for multi-key rotation.'),
    enableFetch: Schema.boolean().default(true).description('是否允许模型调用 web_fetch（URL 内容抓取）…切换即时生效，无需重启。'),
    fetchSource: Schema.union([...FETCH_SOURCES]).default('providers')
        .description('web_fetch 由谁抓取：providers 用填了 Key 的引擎…；dsh 直接用 dsh 自带的本地抓取…'),
    providerOrder: Schema.array(Schema.union([...]))
        .default([...])
        .description('定义 Provider 的调用顺序。…'),
});
export const Config = Schema.object((() => {
    const marked = {};
    for (const [key, schema] of Object.entries(configFields())) {
        marked[key] = schema.volatile();
    }
    return marked;
})());
```

Note `.union([...])` and `.array(Schema.union([...]))` are **schemastery**
unions — fine for Config, and they play well with a per-field `.volatile()`.

---

## 4. Plugin package contract

### 4.1 `package.json` — what is actually read

Minimal, complete host-plugin manifest (this is the shipped
`docs/research/example-plugin/package.json`):

```json
{
  "name": "dsh-example-host-tool",
  "version": "0.1.0",
  "private": true,
  "description": "Minimal DSH host-half plugin: one model-facing tool plus a live-editable (volatile) Config.",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml"],
  "dsh": {
    "manifestVersion": 1,
    "name": "example-host-tool",
    "bundle": { "patch": "./cordis.patch.yml" }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.2",
    "@deepseek-ai/dsh-tools": "0.2.0-rc.2"
  }
}
```

Field-by-field, with what reads it:

| Field | Required? | Read by | Notes |
|---|---|---|---|
| `name`, `version` | yes for publishing | npm, `identityField` in `evaluatePluginCompatibility` (`dsh-app-boot/lib/index.js:311-312`) | the exemption key is `` `${name}@${version}` `` |
| `type` | effectively yes | Node ESM | `"module"` — the whole tree is ESM |
| `main` | yes | Node fallback resolution, `readPluginMeta` | `lib/index.js` is the convention |
| `exports` | recommended | Node | must expose `"."` and — for the display name/description/icon lookup — `"./package.json"` (`dsh-app-boot/lib/index.js:1973-1978`) |
| `dsh.bundle.patch` | **yes, to be a profile layer** | `bundleManifest` / `bundlePatchPaths` / `bundlePatchFiles` | a path **or an ordered list of paths**, relative to the package root |
| `dsh.manifestVersion` | optional | nothing in this build | documented as `1` in the package-manifest README; **not validated** |
| `dsh.name` | optional | nothing in the host | used by third-party plugins as a client-side identity convention (`dsh-web-search-free/package.json`); `@michengai/dsh-btw` omits it |
| `dsh.client.*` | only for a browser half | `dsh-client-modules/lib/index.js:60-70` | `platform`, `inject`, `external`, `immediately` — each type-checked; irrelevant to a host-only plugin |
| `peerDependencies["@deepseek-ai/dsh*"]` | **yes, to be checked** | `evaluatePluginCompatibility` | see §4.2 |
| `engines.dsh` | **no** | nothing | the README documents it, the code ignores it |
| `icon` | optional | `readPluginMeta` → `iconOf` | data URL for the plugin list |
| `description`, `name` | optional | `readPluginMeta` | plugin-list title/description fallback |

**`dsh.compatibility.dshReleases` does not exist anywhere in this build.**
`grep -rn dshReleases` over the whole `@deepseek-ai` tree returns nothing, as does
`grep -rn manifestVersion --include=*.js`.

### 4.2 Compatibility and the "loud failure"

`@deepseek-ai/dsh-package-manifest` is **types only**. Its README says so
outright (`dsh-package-manifest/README.zh.md:92-93`):

> - **仅提供静态类型。** 消费方读取并校验所需的 JSON 字段，再将共享声明适配为运行时数据。本包不提供解析器、getter helper、文件检查或默认值。
> - **兼容性仅作声明。** 当前安装器和加载器不强制检查 `dsh.manifestVersion` 或 `engines.dsh`；声明范围不会拒绝不兼容的宿主，也不会校验 SemVer 语法。

Its `lib/index.js` is literally one line: `export {};`.

**The actual enforcement** is in `dsh-app-boot/lib/index.js:283-325`:

```js
/**
* Check every @deepseek-ai/dsh or @deepseek-ai/dsh-* peer against the runtime.
* Prereleases participate in ranges. workspace:^, workspace:~, and workspace:*
* refer to the current runtime; other invalid ranges are incompatible.
* @param manifest - parsed plugin package.json; inherited fields are ignored.
* @param exemptions - exact plugin name@version keys mapped to exact runtime versions.
* @param runtimeVersion - running dsh version, defaulting to this app-boot package.
* @returns incompatible peers and exemption status, or undefined when none are incompatible.
* @throws for malformed manifest peer fields, invalid runtime versions, or missing identity on a mismatch.
*/
function evaluatePluginCompatibility(manifest, exemptions = {}, runtimeVersion = getDshRuntimeVersion()) {
	runtimeVersionOf(runtimeVersion);
	const fields = objectOf$1(manifest, "Plugin manifest");
	if (!Object.hasOwn(fields, "peerDependencies")) return void 0;
	const dependencies = objectOf$1(fields.peerDependencies, "Plugin manifest peerDependencies");
	const peers = {};
	for (const [name, range] of Object.entries(dependencies)) {
		if (typeof range !== "string") throw new Error(`Plugin manifest peerDependencies[${JSON.stringify(name)}] must be a string`);
		if (name !== "@deepseek-ai/dsh" && !name.startsWith("@deepseek-ai/dsh-")) continue;
		const requirement = ["workspace:^", "workspace:~", "workspace:*"].includes(range) ? runtimeVersion : range;
		if (requirement.trim() === "" || !semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })) peers[name] = range;
	}
	if (Object.keys(peers).length === 0) return void 0;
	const name = identityField(fields, "name");
	const version = identityField(fields, "version");
	const key = `${name}@${version}`;
	return { name, version, runtimeVersion, peers, exempted: (Object.hasOwn(exemptions, key) ? exemptions[key] : void 0)?.includes(runtimeVersion) === true };
}
```

and the message (`:316-322`):

```js
function pluginCompatibilityWarning(issue) {
	const key = `${issue.name}@${issue.version}`;
	return `Plugin ${key} is incompatible with dsh ${issue.runtimeVersion}: peerDependencies ${JSON.stringify(issue.peers)}. Running it may cause crashes or data loss. Update the plugin or install a plugin version compatible with this dsh runtime. To accept this risk explicitly, grant the exact-version exemption for ${key} on dsh ${issue.runtimeVersion} with \`dsh plugin allow-version\` or the plugin manager, then retry the installation or restart dsh. Exact-version exemption: ${issue.exempted ? "active" : "not active"}.`;
}
```

Where it fires, per `dsh-app-boot/README.zh.md:52-56`:

- **Before import**, in `prepareProfilePatches` / `prepareProfileEntries`. A
  rejected ordinary row is turned into a detached `disabled: true` row; a native
  group stays mounted but its rejected children do not load; a native `Include`
  that would reach a rejected plugin is omitted entirely. **The rejected plugin
  module is never imported.**
- **Per bundle**, in `loadProfileDirectory`: an incompatible bundle with no
  exemption is skipped like an unreadable one and listed in `skippedBundles`
  (printed once per start by `reportSkippedBundles`, `:515-517`).
- **Before pnpm runs**, in `runProfilePnpm`: a named spec's manifest is read (a
  path spec straight from disk, a registry spec via `pnpm view … peerDependencies
  --json`) and an incompatible one makes the operation fail with **nothing
  installed** (`dsh-plugin-manager/lib/types/operations.js:124-146`, `:280-310`).
  The CLI prints the exact remedy (`dsh/lib/plugin-BGnVfe_D.js:95`).
- Error code on the service surface: **`incompatible-version`**, carrying
  `name`, `version`, `runtimeVersion`, `peers`
  (`dsh-plugin-manager/lib/index.js:1491`, `typert.host.js:49`).

**Exact-version exemptions** live in the profile's own `compatibility.json`,
mapping `package@version` → list of exact runtime versions
(`dsh-app-boot/lib/index.js:328`; README `:56`). They are never inherited across
a plugin or DSH upgrade. CLI (`dsh-plugin-manager/README.zh.md:69`):

```console
$ dsh plugin --profile <p> version-exemptions
$ dsh plugin --profile <p> allow-version <package@version> --dsh-version <runtime> --accept-risk
$ dsh plugin --profile <p> revoke-version <package@version> --dsh-version <runtime>
```

**Practical peer-range advice.** `dsh-btw`'s manifest is the real-world pattern —
one exact-or-listed range per DSH peer, and `@deepseek-ai/cordis` as a plain
range:

```json
"peerDependencies": {
  "@deepseek-ai/cordis": "^4.0.2",
  "@deepseek-ai/dsh-tools": "0.1.2-rc.1 || 0.1.5-rc.1 || … || 0.2.0-rc.2 || 0.2.1-alpha.2 || 0.2.1-alpha.3"
}
```

Verified with the app's own `semver` at `includePrerelease: true`:
`^0.2.0-rc.2` ✅, `~0.2.0-rc.2` ✅, `>=0.2.0-rc.2` ✅, `0.2.0-rc.2` ✅,
`^0.1.0` ❌ (against a `0.2.0-rc.2` runtime). Because `@deepseek-ai/dsh-*`
packages are **not installed into the profile** (the profile's
`node_modules/@deepseek-ai/` holds only `cosmokit`, `dsh-brand`,
`schemastery`), the peers are declarations for the checker and the runtime
resolution, not installable dependencies — which is why the shipped profiles set
`autoInstallPeers: false` in `pnpm-workspace.yaml`.

### 4.3 `cordis.patch.yml` format

`dsh-app-boot/lib/index.js:3548-3578` is the definitive statement:

```js
/**
* Parse one loader patch list: a top-level YAML array of
* `@deepseek-ai/cordis-plugin-include` `PatchOptions` (id-targeted config overrides and
* `insert` lists, `!!js` expressions allowed). Every invalid field or value throws,
* because a patch file that cannot be applied at all is a misconfiguration; a
* single patch whose target row is absent stays a per-entry Loader warning, so
* one overlay shared across surfaces does not have to match every tree.
* @param binName - the diagnostic prefix on the thrown error.
* @param file - the source path, quoted in errors.
* @param content - the file's text.
* @param label - what to call this list in errors (`patches`, `overlay`).
* @returns the parsed patch list.
*/
function parsePatchList(binName, file, content, label) {
	let parsed;
	try {
		parsed = yaml.load(content, { schema: userPatchesSchema });
	} catch (error) {
		throw new Error(`${binName}: failed to parse ${label} ${file}: ${String(error)}`);
	}
	if (!Array.isArray(parsed)) throw new Error(`${binName}: ${label} ${file} must be a top-level YAML array of loader patch entries`);
	parsed.forEach((entry, index) => {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error(`${binName}: ${label} entry ${index + 1} in ${file} must be a mapping (a loader patch entry)`);
	});
	return anchorInsertedPluginNames(parsed, file);
}
```

Rules, all verified against a throwaway profile:

| Rule | Evidence |
|---|---|
| **Top-level YAML array.** A non-array throws. | above |
| An **entry with `insert:`** appends rows. Each row needs `id` (patches index by id) and `name`. | `dsh-app-boot/lib/index.js:2880-2905` |
| An **entry with `id:` and no `insert:`** overrides that row. `config:` **replaces the row's whole config** — restate every field you want to keep. | `dsh-app-boot/lib/index.js` config-schema `$comment`: *"A patch config replaces the whole config."* |
| `disabled: true` (or a `!!js` expression returning a boolean) keeps the row but turns it off. Only boolean or expression is accepted. | `dsh-app-boot/lib/index.js:2745-2750` |
| **`!!js` expressions are allowed** and are passed through unevaluated into `--dump-config`. | `:3548-3551`; observed `disabled: !!js '!ctx.get(''profileContext'')'` in real dump output |
| A patch whose target id is absent is a **non-fatal** Loader warning on stderr. | observed: `dsh: [<file>] patch: entry "no-such-row" not found` |
| Empty or comment-only files **fail startup** — use `[]` to disable the layer. | `dsh-app-boot/README.zh.md` (home patch section) |
| `insert.name` may be an absolute path, a `file:` URL, or a package specifier; a path starting `./` or `../` is resolved relative to the patch file and converted to a file URL. | `anchorInsertedPluginNames`, `:3566-3574` |
| Inserted rows may have a `group: true` / nested `config` list dialect (the Include entry-list dialect). | `:3570-3572` |

Real, verified examples:

```yaml
# bundle layer: mount your plugin, seeding its config
- insert:
    - id: example-host-tool
      name: 'dsh-example-host-tool'
      config:
        prefix: 'host-run'
        timeoutMs: 15000
```

```yaml
# user layer: override + a second instance + a disable
- id: example-host-tool
  config:
    prefix: OVERRIDDEN
    timeoutMs: 9999
- insert:
    - id: example-host-tool-2
      name: dsh-example-host-tool
      config:
        prefix: second-instance
```

`--dump-config` for that input (`maxBytes`/`maxArgv` were dropped, proving whole
config replacement):

```yaml
# == dsh-example-host-tool, patched by …/cordis.patch.yml
- id: example-host-tool
  name: dsh-example-host-tool
  config:
    prefix: OVERRIDDEN
    timeoutMs: 9999
# == …/cordis.patch.yml
- id: example-host-tool-2
  name: dsh-example-host-tool
  config:
    prefix: second-instance
```

A real third-party bundle patch, `dsh-web-search-free/cordis.patch.yml`, also
demonstrates the **id-targeted override of a built-in row** (used to repoint a
capability seam):

```yaml
- insert:
    - id: web-search-free
      name: 'dsh-web-search-free'
- id: web
  config:
    searchProvider: web-search-free
    fetchProvider: web-search-free
```

### 4.4 Installing into a profile

CLI surface (`dsh/lib/bin.js:105-126`):

```
Usage: dsh [--profile] <name> [options] [app-args...]
       dsh plugin --profile <name> <pnpm-args...>

Options:
  --profile <name>               the profile under $DSH_HOME/profiles to boot
  --from-default-profile <name>  initialize a new custom profile from a shipped profile template
  --patch <path>                 extra patch-list overlay applied after the profile layer (repeatable)
  --dump-config                  print the composed profile tree and exit
  --dump-config-schema           print JSON Schema for profile entries and patches without mounting
  --dump-default-config          print the profile tree without its user layer or --patch overlays and exit
```

`dsh plugin` forwards everything after its own `--profile` to **pnpm, verbatim,
with `cwd` = the profile directory** (`dsh/lib/plugin-BGnVfe_D.js:74-93`):

```js
	const context = { profile, dir, installAnchor: INSTALL_ANCHOR, cwd: process.cwd() };
	const options = {
		...packageManager, execution: "cli", outputBytes: 16384, lockWaitMs: 12e4, lookupTimeoutMs: 12e4,
		onOutput: (text, stream) => { process[stream].write(text); }
	};
	const result = profile === "desktop" ? await withFileLock(…, { waitMs: 12e4 })
		: await runPluginCommand(context, args, options);
```

So `add`, `remove`, `why`, `update` … all work, and the DSH-owned subcommands
`version-exemptions`, `allow-version`, `revoke-version` are intercepted first
(`:14-56`).

**Is a local directory / `file:` / `link:` supported? Yes — verified.**
`anchorPathSpec` (`dsh-plugin-manager/lib/types/operations.js:14-27`):

```js
/** Resolve relative package specs against the caller's directory.
 * @param argument One pnpm argument.
 * @param cwd Invocation directory, never the profile directory.
 * @returns Anchored argument.
 */
export function anchorPathSpec(argument, cwd) {
    const match = /^(?<prefix>(?:file|link):)?(?<path>\.{1,2}(?:[/\\].*)?)$/.exec(argument);
    if (match?.groups?.path === undefined) return argument;
    return `${match.groups.prefix ?? ''}${resolve(cwd, match.groups.path)}`;
}
```

and `parseInstallSpec` (`dsh-plugin-manager/lib/types/install-spec.js:57-90`)
classifies the forms:

```js
export function parseInstallSpec(raw) {
    const spec = raw.trim();
    if (spec === '') throw invalid(spec, 'the package spec must not be empty');
    const path = spec.replace(/^(?:file|link):/, '');
    if (path !== spec || isAbsolute(path)) {
        if (!isAbsolute(path)) throw invalid(spec, 'a local path must be absolute');
        return TARBALL_SPEC.test(path) ? { kind: 'tarball', spec, path } : { kind: 'path', spec, path };
    }
    if (/^\.{1,2}(?:[\\/]|$)/.test(spec)) throw invalid(spec, 'a local path must be absolute');
    const git = GIT_SHORTHAND.test(spec) || GIT_URL.test(spec) || HOSTED_REPOSITORY_URL.test(spec);
    if (git && !TARBALL_SPEC.test(spec)) return { kind: 'git', spec, host: gitHost(spec) };
    if (/^https?:\/\//i.test(spec)) { … }
    … return { kind: 'registry', spec, name, range };
}
```

Supported spec forms: **absolute path**, **`file:<abs>`**, **`link:<abs>`**,
**relative `./x` / `../x`** (anchored to your shell's cwd), **tarball**
(`.tgz`/`.tar.gz`, local or `https`), **git** (`git+…`, `git@host:…`,
`github:`/`gitlab:`/`bitbucket:`/`gist:`, hosted repo URLs), and **registry**
(`name`, `name@range`).

**The developer workflow** (this is the whole loop, no npm publish needed):

```console
$ cd /path/to/my-plugin          # package.json + cordis.patch.yml + lib/index.js
$ node "/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js" \
       plugin --profile mydev add "$PWD"
dependencies:
+ my-plugin link:/path/to/my-plugin
```

After `pnpm add`, DSH's own `reconcile` step appends the package to
`dsh.profile.bundles` because it declares `dsh.bundle.patch` (§2.3). Re-run
`add` after editing `package.json`; **edits to `lib/index.js` need the plugin
reloaded** (HMR, or an app restart).

Caveats worth knowing:

- **`--profile desktop` is refused by the CLI** (`dsh/lib/bin.js:41-43`):
  `error: profile "desktop" is managed exclusively by the Electron application`.
  Use a dedicated dev profile and, if the goal is the Desktop app, install there
  through the in-app plugin manager instead.
- pnpm's own configuration is honoured: the shipped profiles set
  `autoInstallPeers: false` and `nodeLinker: hoisted`
  (`/Users/zhz/.dsh/profiles/desktop/pnpm-workspace.yaml`).
- A failed or cancelled install restores `package.json` and `pnpm-lock.yaml`
  from the pre-run snapshot (`dsh-plugin-manager/README.zh.md:144`).
- A package with no `dsh.bundle` installs but warns and is **not** selected.

### 4.5 `main` / `exports` / `type`

- `"type": "module"` — the entire tree is ESM; a `.js` file with `require` will
  not load.
- `"main": "lib/index.js"` is the convention across all 291 bundled packages.
- `"exports"` should expose `"."` → the entry, and `"./package.json"` →
  `"./package.json"` (the display-metadata reader resolves
  `${specifier}/package.json`, `dsh-app-boot/lib/index.js:1976-1979`). Add
  subpaths per extra entry point (`./client`, `./invariant`, `./types`, …) as
  needed.
- The DSH launcher installs a **runtime resolution** into Node's ESM and CJS
  resolvers, so `@deepseek-ai/dsh-*` imports inside your plugin resolve to the
  single running copy — **do not bundle or vendor them**, and do not rely on a
  physical `node_modules/@deepseek-ai/dsh-tools`.
  For running the plugin's own `verify.mjs` outside DSH, symlink each runtime
  package into the plugin's `node_modules/@deepseek-ai/` (dev-only bridge; see
  `docs/research/example-plugin/README.md`).

---

## 5. Useful host services

Service names are the `ctx.<name>` keys; each comes from
`super(ctx, "<name>")` in the abstract class.

| Service | Declaring package | `static inject` example |
|---|---|---|
| `ctx.tools` | `dsh-tools` (`:2704`) | `["tools"]`, `["tools","fs","sessionProjections"]` |
| `ctx.systemPrompt` | `dsh-system-prompt` | `["systemPrompt"]` |
| `ctx.settings` | `dsh-settings:330` | `["configEditor","profileContext"]` |
| `ctx.subprocess` | `dsh-subprocess:88` | `["subprocess"]` |
| `ctx.fs` | `dsh-fs:60` | `["fs"]` |
| `ctx.shell` | `dsh-shell:85` | `["shell","systemPrompt","shellEnv"]` (tool-bash) |
| `ctx.jobs` | `dsh-jobs:118` | `["jobs","typert"]` |
| `ctx.spillStore` | `dsh-spill:54` | read via `ctx.get('spillStore')` when optional |
| `ctx.sandboxPolicy` | `dsh-sandbox-policy:105` | `["sandboxPolicy"]` |
| `ctx.approval` | `dsh-user-approval` | read via `ctx.get('approval')` (`dsh-tools:2787`) |
| `ctx.sessionProjections` | `dsh-session-projection` | `["sessionProjections"]` |
| `ctx.attachments` | `dsh-attachment` | read via `ctx.get('attachments')` |
| `ctx.llm` | `dsh-llm` | read via `ctx.get('llm')` |
| `ctx.logger` | cordis | always present |
| `ctx.effect`, `ctx.on`, `ctx.waterfall`, `ctx.emit`, `ctx.get`, `ctx.inject`, `ctx.fiber`, `ctx.scope` | cordis | always present |

### 5.1 `ctx.subprocess` — spawn with cwd/env/stdin/timeout and capture output

Abstract contract, `dsh-subprocess/lib/index.js:52-85`:

> - Executable paths belong to one execution world shared with the mounted
>   filesystem provider.
> - `spawn` returns a live handle **synchronously**. Target identity remains
>   provider-private; `done` resolves with the spawned command's exit facts and
>   may reject for spawn or provider failures.
> - Collect-mode readers are **offset-based and non-consuming**, so independent
>   readers never consume one another's output; lossy reads report truncation and
>   the spill file holding the complete stream when one exists. Piped streams are
>   handed to the caller raw and never buffered here.
> - `terminate` … starts the provider's documented procedure against its managed
>   range. `waitForExit` observes that same range…
> - **Disposal of the service terminates all still-running managed processes and
>   awaits their exit.**
> - Command defaulting, shell semantics, deadlines, protocol framing, terminal
>   readiness, and presentation belong to consumers.

**`spawn(spec)`** (`dsh-subprocess-local/lib/index.js:1356-1374`). The spec is
validated at `runner-launch-B2zsQ1Dz.js:764-775` and merged at `:1524-1535`.
Assembled from `dsh-bash-local/lib/index.js:106-128` (the canonical consumer) plus
my working example:

```js
const handle = ctx.subprocess.spawn({
  argv: ['/usr/bin/env', 'bash', '-c', 'echo hi'],   // R: non-empty argv[0]; no shell interpretation
  cwd: '/abs/path',                                   // validated: no NUL byte
  stdio: {
    stdin:  { data: 'input text' },                   // or "ignore" | "inherit" | "pipe"
    stdout: { maxBytes: 65536, spill: { maxBytes: 8*1024*1024 } },   // collect mode
    stderr: { maxBytes: 65536 },
    // control: …                                     // optional control pipe
  },
  graceMs: 2000,                                      // R: positive finite; termination grace
  env: { MY_VAR: 'x', GONE: undefined },              // OVERLAY over scrubbedParentEnv(); undefined deletes
  signal: abortSignal,                                // aborts + terminates the managed range
});
```

- **There is no `timeoutMs` on the spec.** Deadlines belong to consumers; use
  `AbortSignal.timeout(ms)` fused with your caller's signal via
  `AbortSignal.any([...])`, exactly as the example plugin does.
- **`env` is an overlay, not a full environment** — `childEnv` merges over
  `scrubbedParentEnv()` (`runner-launch-B2zsQ1Dz.js:694-706`).
- **The inherited environment is scrubbed** of every name matching
  `SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i` and every `DSH_*` name
  (`dsh-subprocess/lib/index.js:24-28`, `:39-49`). A deliberately supplied entry
  in `spec.env` survives because it merges after the scrub.
- `argv[0]` may be absolute or a bare PATH name; a *relative path* is rejected
  (`subprocess-local/lib/index.js:1320-1322`).

**Reading output.** The handle (`runner-launch-B2zsQ1Dz.js:995-1011`) is:

```js
	return {
		stdin: stdinMode === "pipe" ? stdin ?? void 0 : void 0,
		stdout: outMode === "pipe" ? stdout ?? void 0 : void 0,
		stderr: errMode === "pipe" ? stderr ?? void 0 : void 0,
		control: launch.control,
		collected: {
			...stdoutCollector !== void 0 ? { stdout: stdoutCollector } : {},
			...stderrCollector !== void 0 ? { stderr: stderrCollector } : {},
		},
		done,
		terminate,
		terminateForHostExit,
		waitForExit
	};
```

- `handle.done` → `Promise<{ exitCode: number|null, signal: string|null }>`. It
  may reject on spawn/provider failure.
- `handle.collected.stdout.readFrom(fromByte)` → `{ text, nextOffset, lossy, spillPath? }`
  (`subprocess-local/lib/output.js:183-196`). Read at offset `0` after `done` to
  get the retained tail; `lossy: true` means the head slid out of the window and
  the full stream is at `spillPath`.
- `handle.collected.stdout.finalize()` → `{ text, truncated, spillPath? }`
  (`output.js:227-236`) — provider-local convenience, **not** part of the
  abstract seam.
- `handle.terminate()` / `handle.waitForExit(signal)` for teardown ladders.
- For **binary** output: use `stdio: { stdout: 'pipe' }` and read
  `handle.stdout` raw, or `ctx.fs.readBytes(target, signal, maxBytes)` for a
  file. The collect-mode reader is text-decoded UTF-8.

### 5.2 `ctx.shell` — batteries-included command execution

`ctx.shell` is the seam `dsh-tool-bash` actually uses. `dsh-shell/lib/index.js:56-90`:

> - `execute` resolves with the process handle **after preparation**.
>   "Foreground" is a property of what the caller awaits…
> - `ShellExecution.result` rejects **only for infrastructure failures**.
>   Nonzero exits, timeout kills, and abort kills resolve with a descriptive
>   result: first-cause `timedOut`/`aborted`, the spec's `timeoutMs` echoed.
> - `done` settles at process close and **never rejects**.
> - `onExpiry: 'none'` arms no deadline; `'kill'` kills at expiry.
> - `readOutput` is incremental: consecutive reads never repeat output.
> - A still-running process is stopped and awaited when its owning composition
>   tears down.

Real call (`dsh-tool-bash/lib/index.js:403-410`):

```js
							proc = await ctx.shell.execute({
								...spec,
								signal
							});
```

and `dsh-shell` also exposes `sandboxMode` (read by `tool-bash` at `:346`) and the
`[exit code: N]` renderer contract plus `parseExitStatus` (`dsh-shell/lib/index.js:22-35`).

**Recommendation for a new plugin:** if you want a shell, `ctx.shell` gives you
timeouts, spill, sandbox integration, and background-job adaptation for free;
`ctx.subprocess` gives you exact argv control and fewer moving parts. Use
`ctx.shell` unless you need a specific argv or the shell would only be quoting
noise.

### 5.3 `ctx.jobs` — background jobs

`ctx.jobs.start(spec)` (`dsh-jobs-local/lib/index.js:412-431`) takes
`{ kind, label, owner?, outputLimitBytes?, output: PullSource[], run() }` and
returns a handle with `id`. It validates: non-empty `kind`, non-empty `label`,
positive `outputLimitBytes`, and refuses when the owner has no serving
controller (`"background jobs unavailable: no job controller serves this agent"`)
or has hit `maxConcurrentJobsPerOwner`. The canonical adapter is
`dsh-tool-bash`'s `startJob` (`dsh-tool-bash/lib/index.js:385-430`), and
`dsh-tool-jobs` wires the model-facing surface.

For a first plugin, skip `ctx.jobs`: implement a synchronous tool, or use
`ctx.shell` with `onExpiry: 'none'` and bound your own wait.

### 5.4 `ctx.spillStore` — persist oversized text

`dsh-spill/lib/index.js:52-58` documents `saveText` semantics; the local
implementation is `dsh-spill-local/lib/index.js:556-568`:

```js
	async saveText(input) {
		const saved = await saveTextFile({
			root: this.root,
			sessionId: input.owner.sessionId,
			suggestedName: input.suggestedName,
			content: input.content
		});
		return {
			locator: SpillLocator(saved.path),
			bytes: saved.bytes,
			retrievalHint: "Use read with offset/limit, or grep this path to search within it."
		};
	}
```

`input.owner` is a session; the returned `locator` is an opaque branded string
(here a file path). Storage is session-scoped and never world-readable; the
backend derives a collision-free name from, but never equal to, `suggestedName`;
the call **rejects** on real storage failure. Use `ctx.get('spillStore')` — it is
optional, and `dsh-tool-fs-search` documents read-it-with-`ctx.get()` as the
pattern (`dsh-tool-fs-search/lib/index.js:272`).

### 5.5 `ctx.fs` — read and write files

The abstract class declares only `watch`, `sandboxMode`, `processPathFromHostPath`
(`dsh-fs/lib/index.js:59-96`); the full surface is the local provider
(`dsh-fs-local/lib/index.js:780-905`) and is what every shipped tool calls:

| Method | Signature | Returns |
|---|---|---|
| `resolve(path, opts?)` | `opts: { cwd?, signal? }` | `{ targetKey, displayPath }` — the handle every other call takes |
| `resolve` (abs) / `processPath(target)` | | the process path string |
| `processPathFromHostPath(hostPath)` | | absolute path or `undefined` |
| `fileUrl(target)` | | `file://` URL string |
| `contains(parent, child)` | | `boolean` |
| `stat(target, signal?)` | | `{ version, type, size } \| undefined` |
| `lstat(path, opts?, signal?)` | `opts: { cwd? }` | `{ version, type, size } \| undefined` (**does not follow symlinks**) |
| `readText(target, signal?)` | | `string` |
| `streamText(target, signal?)` | | async iterable of text chunks |
| `readBytes(target, signal?, maxBytes?)` | | `Uint8Array`/`Buffer` |
| `readByteRange(target, range, signal?)` | | byte window |
| `listDir(target, signal?)` | | `{ name, type, target, version?, size? }[]` |
| `writeText(target, content, expected?, signal?, sandboxPolicy?)` | | `{ operation: 'create'\|'update', version, before, after }` |
| `editText(target, edit, expected?, signal?)` | `edit: { oldString, newString, replaceAll? }` | `{ version, before, after }` |
| `watch(target, changed, signal)` | | close function |

`expected` is the optimistic-concurrency intent:
`{ kind: 'createIfAbsent' }` or `{ kind: 'replaceIfVersion', version }`
(`dsh-fs-local/lib/index.js:864-880`). Violations become typed `FsError`s with
codes `FS_STALE_VERSION`, `FS_NOT_OBSERVED`, `FS_NOT_REGULAR_FILE`,
`FS_NOT_FOUND`, `FS_ABORTED`.

Real write (`dsh-tool-fs/lib/index.js:581-590`):

```js
			const sandboxPolicy = await sandbox.resolvePolicy("write", args, exec);
			const target = await ctx.fs.resolve(input.filePath, sessionResolveOptions(exec, sandboxPolicy?.workspaceRoot));
			const intent = await ctx.waterfall("fs/write-intent", target, exec, () => void 0);
			let outcome;
			try {
				outcome = await ctx.fs.writeText(target, input.content, intent, exec.signal, sandboxPolicy);
			} catch (error) {
				throw remediateFsError(sandbox.mapError(error, sandboxPolicy), target.displayPath);
			}
```

**Minimum viable write** for a plugin that does not want to wire the sandbox:

```js
const target = await ctx.fs.resolve(absPath, { cwd: exec.agent?.session.header.cwd, signal: exec.signal });
await ctx.fs.writeText(target, text, { kind: 'createIfAbsent' }, exec.signal);
```

That runs under the mounted provider's own confinement rules
(`dsh-fs-sandbox` replaces `LocalFileSystem` and enforces path containment —
`dsh-fs-sandbox/lib/index.js:17-60`), but the *tool-level* escalation/approval
dance belongs to the tool, as `dsh-tool-fs` shows.

### 5.6 `ctx.sandboxPolicy` — per-call policy

`dsh-sandbox-policy/lib/index.js:96-140`:

```js
	/**
	* Resolve the complete policy for one capability call. An approved explicit
	* mode outranks the session's last `sandbox/mode` event, which outranks the
	* deployment default. A session cwd is its workspace-write boundary; the
	* configured root is the fallback for agentless calls and sessions without a
	* cwd.
	* @param request - optional session and approved mode override.
	* @returns the fully resolved per-call mode and absolute workspace root.
	*/
	resolve(request = {}) {
		const { session } = request;
		return {
			mode: request.mode ?? (session === void 0 ? void 0 : this.overrideOf(session)) ?? this.defaultMode,
			workspaceRoot: resolveWorkspaceRoot(session?.header.cwd ?? this.workspaceRoot),
			...session === void 0 ? {} : { sessionId: session.id }
		};
	}
```

Modes: `'read-only' | 'workspace-write' | 'danger-full-access'` (Config default
`'read-only'`). Call it as `policy.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })`,
which is what `dsh-tools` itself does for the PTC sandbox (`dsh-tools/lib/index.js:2788-2792`).

### 5.7 `ctx.logger`

cordis' `Logger`, available on every context and scoped to the fiber that owns it.
Use **printf-style** formatting, matching the tree's convention:

```js
ctx.logger.debug('example-host-tool: registered host_run');
ctx.logger.warn('tools: ptc-dispatch-log listener failed for %s: %s; …', dispatch.name, message);   // dsh-tools:3079
ctx.logger.info('settings: imported %s into profile %s', imported, profile.name);                    // dsh-settings:362
ctx.logger.error(error);
```

Unlike `console.log`, these lines go to the harness log with the plugin's
identity, and `ctx.logger.error(error)` renders a thrown error properly — several
shipped packages call it that way (`dsh-settings/lib/index.js:340`, `:391`).

### 5.8 `node:child_process` and `node:fs` — can you just use them?

**Yes, you can, and nothing will stop you.** The decisive statement is in
`dsh-plugin-manager/README.zh.md:31`:

> profile 变更跨会话持久化，**已安装的 Host 代码在宿主进程内运行，不受工作区沙箱限制**。
> *(installed Host code runs inside the host process and is not subject to the workspace sandbox)*

Corroborating evidence:

- The sandbox is a **spawn-time** mechanism, not a process-level one. On macOS
  `dsh-sandbox-local` builds an SBPL profile and prefixes the command with
  `sandbox-exec -p …` (`dsh-sandbox-local/lib/index.js:58-130`, `:340`). It
  confines the *child*, not the harness process.
- Filesystem confinement is a **provider substitution**: `dsh-fs-sandbox`
  extends/replaces `LocalFileSystem` and rejects paths outside
  `writableRoots` at `resolve`/write time (`dsh-fs-sandbox/lib/index.js:17-60`).
  A plugin that calls `node:fs` skips it entirely.
- There is **no** `--experimental-permission`, `process.permission`, or Node
  permission-model usage anywhere in the tree (grep returns nothing).
- The local providers themselves call `node:child_process` / `node:fs`
  directly (`dsh-subprocess-local`, `dsh-fs-local` import them at the top of the
  file) — the service layer is *policy*, not a capability boundary.

**What you lose by going around the seams:**

| Bypassing | You lose |
|---|---|
| `ctx.subprocess` | managed process-range ownership, credential/`DSH_*` env scrubbing, bounded collect + spill files, `graceMs` TERM→KILL escalation, termination on service disposal, synchronous host-exit finalization, uniform `done`/`waitForExit` observability |
| `ctx.fs` | sandbox path containment, per-target write locking (serialized read→guard→write), version-based optimistic concurrency (`FS_STALE_VERSION`), atomic publication, `fs/observed` invalidation events, `fs/write-intent` waterfall |
| `ctx.shell` | deadlines with first-cause `timedOut`/`aborted`, output spill, background-job adaptation, the shared exit-status marker contract |
| `ctx.jobs` | job ids, owner limits, output pumps, `job_kill`/`job_output`, notices |
| `ctx.approval` | the fail-closed escalation sequence (`approveEscalation`, `dsh-sandbox`) and any audit trail |
| `ctx.llm` / `ctx.attachments` | route capability checks, durable image storage |

**Practical guidance.** Use the seams. A host plugin that shells out to `adb`
should call `ctx.subprocess.spawn` (or `ctx.shell.execute`) and `ctx.fs` — that
is what makes it composable, cancellable, and survivable across a plugin reload.
Reserve direct builtins for things the seams genuinely do not cover (reading your
own package resource files with `import.meta.url`, for instance), and remember
that a direct `node:child_process` child is **not** terminated when your plugin
is disposed.

---

## 6. Verification — proving a new plugin loads

### 6.1 The CLI, exactly

All of these were run successfully on this machine against
`/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js`.

```console
$ node "<app>/node_modules/@deepseek-ai/dsh/lib/bin.js" --version
0.2.0-rc.2

$ node "<app>/node_modules/@deepseek-ai/dsh/lib/bin.js" --help
# prints the launcher help shown in §4.4

# Compose a profile's entry list WITHOUT mounting anything. Read-only.
$ node "<app>/…/dsh/lib/bin.js" --profile <name> --dump-config

# Same, omitting the user layer and --patch overlays (bundle layers only).
$ node "<app>/…/dsh/lib/bin.js" --profile <name> --dump-default-config

# JSON Schema for the entry list + patch document, WITH each plugin's Config
# projected (including x-cordis.volatile). IMPORTS EVERY COMPOSED MODULE —
# only run this for a profile whose plugins you already trust.
$ node "<app>/…/dsh/lib/bin.js" --profile <name> --dump-config-schema

# Add an extra overlay on top of the profile layer (repeatable).
$ node "<app>/…/dsh/lib/bin.js" --profile <name> --patch ./extra.yml --dump-config

# Package management (forwards to pnpm with cwd = the profile dir).
$ node "<app>/…/dsh/lib/bin.js" plugin --profile <name> add <spec>
$ node "<app>/…/dsh/lib/bin.js" plugin --profile <name> remove <pkg>
$ node "<app>/…/dsh/lib/bin.js" plugin --profile <name> version-exemptions
$ node "<app>/…/dsh/lib/bin.js" plugin --profile <name> allow-version <pkg@ver> --dsh-version <ver> --accept-risk
```

Flag resolution is in `dsh/lib/bin.js:60-92`; the dump flags are mutually
exclusive and take no app arguments; `--dump-default-config` rejects `--patch`.
Dispatch: `:211-250`.

**A profile name is required and `desktop` is refused.** `dsh/lib/bin.js:41-43`:

```js
function rejectElectronProfile(program, profile) {
	if (profile.toLowerCase() === "desktop") program.error("error: profile \"desktop\" is managed exclusively by the Electron application");
}
```

To verify a plugin without touching `~/.dsh`, point `DSH_HOME` at a scratch
directory (`dsh-home-paths/lib/index.js:15`, `:73-80` — precedence: explicit
path, `$DSH_HOME`, then `~/.dsh`) and pre-create a minimal profile so no bundles
are downloaded:

```console
$ export H=/tmp/probe-home
$ mkdir -p "$H/profiles/probe"
$ cat > "$H/profiles/probe/package.json" <<'EOF'
{ "name": "dsh-profile-probe", "private": true, "dsh": { "profile": { "bundles": [] } } }
EOF
$ cat > "$H/profiles/probe/pnpm-workspace.yaml" <<'EOF'
packages:
  - .
nodeLinker: hoisted
autoInstallPeers: false
EOF
$ echo '[]' > "$H/profiles/probe/cordis.patch.yml"
$ DSH_HOME="$H" node "<app>/…/dsh/lib/bin.js" plugin --profile probe add "$PWD/my-plugin"
$ DSH_HOME="$H" node "<app>/…/dsh/lib/bin.js" --profile probe --dump-config
```

Notes:

- An **empty or comment-only** `cordis.patch.yml` makes startup fail; `[]` is the
  "no overrides" form.
- The profile directory must contain a `package.json` **before** `dsh plugin
  add`, or `initProfile` initialises it from a shipped template and pnpm will try
  to install `@deepseek-ai/dsh-base` + the app bundle from the registry.
- `--dump-config` output is itself loadable YAML with `# == <layer>` provenance
  comments.

### 6.2 The resolved-config dump

`dsh/lib/dump-config-BEDI-dNY.js:7-11` describes the mode: *"compose the …
profile tree and exit"*. `renderConfigDump` prints composed rows and the layers
that patched them, with `!!js` expressions left **unevaluated**:

```yaml
# == dsh-example-host-tool
- id: example-host-tool
  name: dsh-example-host-tool
  config:
    prefix: host-run
    timeoutMs: 15000
    maxBytes: 65536
    maxArgv: 64
```

A row that the compatibility policy will reject **still appears** in
`--dump-config` (rejection happens at admission, not composition) — and a
rejected **bundle** contributes no rows at all (`dsh-app-boot/README.zh.md:54`).

`--dump-config-schema` output for the example plugin, showing exactly what the
Settings UI will be able to edit:

```json
"config0": {
  "default": {},
  "anyOf": [
    { "type": ["object", "null"],
      "properties": {
        "prefix": { "description": "Prefix prepended to the tool result’s first output line.",
                    "default": "host-run",
                    "x-cordis": { "volatile": true },
                    "anyOf": [ { "type": ["string","null"] }, { "$ref": "#/$defs/loaderExpression" } ] },
        "timeoutMs": { "description": "Wall-clock deadline for one spawn. …",
                       "default": 15000,
                       "x-cordis": { "volatile": true },
                       "anyOf": [ { "type": ["integer","null"], "minimum": 100, "maximum": 600000 },
                                  { "$ref": "#/$defs/loaderExpression" } ] }
      } },
    { "$ref": "#/$defs/loaderExpression" }
  ]
}
```

The `x-cordis.volatile` marker is produced by `dsh-app-boot/lib/index.js:2680-2694`
and is the machine-readable answer to "is this field live-editable?".

### 6.3 Checking a plugin's exports without booting anything

```console
$ cd /path/to/my-plugin
$ node -e "import('./lib/index.js').then(m => console.log(Object.keys(m), m.name, m.inject))"
[ 'Config', 'apply', 'inject', 'name' ] example-host-tool [ 'tools', 'subprocess' ]
```

Resolving `@deepseek-ai/dsh-tools` / `@deepseek-ai/schemastery` from a bare
directory will fail (`ERR_MODULE_NOT_FOUND`) because the runtime resolution does
not exist outside DSH. For local development, bridge it once:

```console
$ mkdir -p node_modules/@deepseek-ai
$ APP="/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai"
$ for p in schemastery dsh-tools cordis cosmokit dsh-llm dsh-fs dsh-subprocess; do
    ln -sfn "$APP/$p" "node_modules/@deepseek-ai/$p"
  done
```

(The `dsh-example-host-tool` package ships exactly this bridge already.)

### 6.4 A stronger offline check: mount on a real Cordis context

`ctx.plugin()` + stub services proves the module contract, `inject` gating, Config
validation, registration, dispatch, and teardown — with no DSH boot. This is what
`docs/research/example-plugin/verify.mjs` does; its output on this machine:

```
=== 1. module contract ===
ok   exports are Config/apply/inject/name -- ["Config","apply","inject","name"]
ok   inject -- ["tools","subprocess"]
=== 2. Config volatile marks ===
ok   every field carries meta.volatile -- 4
ok   parsed fields are Volatile references -- {"prefix":"object","timeoutMs":"object",…}
ok   volatileForm() projects all 4 fields -- ["prefix","timeoutMs","maxBytes","maxArgv"]
=== 3. live edit ===
ok   changed paths committed in place -- ["prefix","timeoutMs"]
ok   existing reference observes the new value -- "EDITED-IN-UI"
=== 4. mount + register + dispatch ===
ok   fiber ACTIVE (state 2)
ok   tool registered as host_run
ok   definition fields -- ["description","execute","isConcurrencySafe","name","output","parameters","presentCall","timeoutMs"]
ok   argv is required in the compiled schema
ok   bad argv rejected by the schema
ok   output validates against output.schema
ok   render produces one text block
ok   empty argv throws (registry converts to isError)
ok   fiber disposal unregistered the tool
ALL CHECKS PASSED
```

Two gotchas this harness surfaces, both real:

1. **`ctx.plugin(plugin, config)` re-validates `config` against `Config`.** Pass
   the **raw** config; handing it an already-parsed (volatile-wrapped) object
   fails with `invalid config: $.prefix expected string but got [object Object]`.
   The loader does the right thing:
   `this.ctx.registry.plugin(plugin, this.options.config, …)`
   (`cordis-plugin-loader/lib/index.js:461`).
2. Accessing a service without declaring it in `inject` throws
   **`cannot get property "tools" without inject`** — an explicit cordis guard
   (`cordis/lib/index.js:676`). This is why `inject` is mandatory for required
   collaborators and `ctx.get()` is the escape hatch for optional ones.

### 6.5 Runtime/API surfaces for a *running* app

The Electron app hosts a Web GUI and a JSON-RPC surface; useful read-only
endpoints live in the `dsh-api-*` packages (`dsh-api-gateway`,
`dsh-api-settings-controller`, `dsh-api-workspace-controller`,
`dsh-api-session-controller`) and the host inventory service in
`dsh-host-plugin-inventory` (`static inject = ["loader"]`,
`dsh-host-plugin-inventory/lib/index.js:95`). These are **not** documented here
because they need the running app's authorization and the plugin inventory
deliberately does not attribute rows to a bundle, profile, or override
(`dsh-host-plugin-inventory/README.zh.md:104`). For a plugin author the static
checks above are strictly better: they need no auth, no boot, and no running app.

---

## 7. The minimal working host plugin

Complete source in `docs/research/example-plugin/`:

| File | Purpose |
|---|---|
| `package.json` | manifest: `type: module`, `exports`, `dsh.bundle.patch`, DSH peer range |
| `cordis.patch.yml` | the bundle layer that inserts the row and seeds the config |
| `lib/index.js` | `name` / `Config` (4 volatile fields) / `inject` / `apply` + one tool `host_run` |
| `verify.mjs` | 17 offline assertions over contract, volatile liveness, mount, dispatch, teardown |
| `README.md` | how to run it and how to install it |

`lib/index.js` in full is reproduced in the file; the essential skeleton:

```js
import Schema from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'example-host-tool';
export const inject = ['tools', 'subprocess'];

export const Config = Schema.object({
  prefix:     Schema.string().default('host-run').description('…').volatile(),
  timeoutMs:  Schema.natural().min(100).max(600000).default(15000).description('…').volatile(),
  maxBytes:   Schema.natural().min(1024).max(1048576).default(65536).description('…').volatile(),
  maxArgv:    Schema.natural().min(1).max(256).default(64).description('…').volatile(),
});

function readField(v) { return v !== null && typeof v === 'object' && typeof v.get === 'function' ? v.get() : v; }
function readLive(raw) { const out = {}; for (const [k, v] of Object.entries(raw ?? {})) out[k] = readField(v); return out; }

export function apply(ctx, config) {
  ctx.tools.register(defineTool({
    name: 'host_run',
    description: 'Run one executable with an explicit argv and return its exit status, stdout, and stderr. …',
    parameters: {
      argv:  { type: 'array', required: true, description: '…', items: { type: 'string' } },
      cwd:   { type: 'string', description: '…' },
      stdin: { type: 'string', description: '…' },
      env:   { type: 'object', additionalProperties: true, description: '…' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
          signal:   { oneOf: [{ type: 'string' },  { type: 'null' }], required: true },
          timedOut: { type: 'boolean', required: true },
          stdout:   { type: 'string',  required: true },
          stderr:   { type: 'string',  required: true },
          stdoutTruncated: { type: 'boolean', required: true },
          stderrTruncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${readLive(config).prefix}: […]` }],
    },
    presentCall: (args) => ({ card: 'generic', title: args.argv.join(' '), kind: 'execute', rawInput: args.argv.join(' ') }),
    isConcurrencySafe: () => true,
    timeoutMs: 600000,
    async execute(args, exec) {
      const live = readLive(config);                       // fresh at every call
      const cwd = args.cwd ?? exec.agent?.session.header.cwd;
      const deadline = AbortSignal.timeout(live.timeoutMs);
      const signal = AbortSignal.any([exec.signal, deadline]);
      const handle = ctx.subprocess.spawn({
        argv: args.argv, cwd,
        stdio: { stdin: args.stdin === undefined ? 'ignore' : { data: args.stdin },
                 stdout: { maxBytes: live.maxBytes }, stderr: { maxBytes: live.maxBytes } },
        graceMs: 2000, env: args.env, signal,
      });
      const outcome = await handle.done;
      const read = (c) => (c === undefined ? { text: '', lossy: false } : c.readFrom(0));
      const stdout = read(handle.collected.stdout), stderr = read(handle.collected.stderr);
      return { exitCode: outcome.exitCode, signal: outcome.signal, timedOut: deadline.aborted,
               stdout: stdout.text, stderr: stderr.text,
               stdoutTruncated: stdout.lossy === true, stderrTruncated: stderr.lossy === true };
    },
  }));
}
```

Install it into a dev profile and confirm it composes:

```console
$ cd docs/research/example-plugin
$ node "<app>/…/dsh/lib/bin.js" plugin --profile mydev add "$PWD"
$ node "<app>/…/dsh/lib/bin.js" --profile mydev --dump-config
# == dsh-example-host-tool
- id: example-host-tool
  name: dsh-example-host-tool
  config:
    prefix: host-run
    timeoutMs: 15000
    maxBytes: 65536
    maxArgv: 64
```

---

## 8. Corrections to commonly-assumed facts

| Assumption | Reality | Evidence |
|---|---|---|
| `ToolDefinition` has `outputSchema` | it is **`output: { schema, render, presentationMeta? }`**, and `register()` throws without it | `dsh-tools/lib/index.js:2881` |
| `execute` may return a string / content blocks | it returns a **structured value validated against `output.schema`**; blocks are `render`'s job | `:3541-3552` |
| errors via `return { isError: true }` | **throw**; only `tools/post-execute` may author an error result | `:3313-3314`, `:3495-3527` |
| `parameters` is raw JSON Schema | with `defineTool` it is the **author DSL**; raw JSON Schema only if you bypass `defineTool`, and then it must be inside the enforced subset | `:802-811`, `json-schema.js:34-43` |
| zod is accepted for parameters | **no** | `assertSupportedJsonSchema` on both schemas |
| `dsh.compatibility.dshReleases` | **does not exist**; enforcement is on `peerDependencies` of `@deepseek-ai/dsh*` vs `getDshRuntimeVersion()` | `dsh-app-boot/lib/index.js:303`; zero grep hits |
| `engines.dsh` is checked | **no** — the package-manifest README says so explicitly | `dsh-package-manifest/README.zh.md:93` |
| `dsh-package-manifest` validates manifests | it is **`export {}`** — types only | `dsh-package-manifest/lib/index.js:1` |
| plugins need a `cordis.patch.yml` **insert** in the profile | a bundle patch is the convention; what is mandatory is **`dsh.bundle.patch` + membership in `dsh.profile.bundles`** | `operations.js:46-77` |
| `ctx.settings.configure` registers the config schema | `Config` **is** the schema; `configure` only sets the per-instance page policy | `dsh-settings/lib/index.js:364-381` |
| saving settings remounts the plugin | volatile-only saves commit in place and emit `loader/volatile-update`; only a mixed/non-volatile change remounts | `cordis-plugin-loader/lib/index.js:380-421` |
| the disposer returned by `register` unregisters immediately | it is fiber-bound and the cleanup is **asynchronous** (`fiber.dispose()` returns a Promise) | measured |
| the sandbox restricts plugin code | installed host code runs **in the host process, outside the workspace sandbox** | `dsh-plugin-manager/README.zh.md:31` |
| `--profile desktop` can be dumped from the CLI | **refused**: `profile "desktop" is managed exclusively by the Electron application` | `dsh/lib/bin.js:41-43` |

---

## 9. Open questions / not found

- **No shipped `.d.ts`** for any `@deepseek-ai/dsh-*` package, so the JSDoc inside
  `lib/*.js` is the only API documentation. Anything not visible in the compiled
  JS (e.g. the precise `SubprocessSpec` interface) had to be reconstructed from
  validators and real call sites; those reconstructions are marked as such.
- **No `dsh.name` reader found** in the host half. It appears in
  `dsh-web-search-free/package.json` and is plausibly a client-side convention;
  nothing in `dsh-app-boot`, `dsh-plugin-manager`, or `dsh-host-plugin-inventory`
  reads it. Use `package.json.name`/`description`/`icon` for display metadata.
- **No section-order constant for third-party tools.** `SECTION_ORDERS`
  (`dsh-system-prompt/lib/index.js:12-45`) is a closed table; a plugin must pass
  a literal number to `systemPrompt.section({order})`.
- **`ctx.jobs` spec details** were only read at the adapter level
  (`dsh-tool-bash`'s `startJob`); the `JobSpec` interface itself is not shipped.
  A plugin that needs background jobs should copy `dsh-tool-bash`'s adapter.
- **No documented JSON-RPC/HTTP endpoint list** for the running app was verified
  here; those controllers require the app's authorization and were out of scope
  for a read-only pass.
- **Could not boot any profile.** `dsh-base` and the app bundles are not present
  in the throwaway profile, and installing them requires network access to the
  npm registry. The strongest verification actually performed is
  `--dump-config` + `--dump-config-schema` + `dsh plugin add` on a throwaway
  profile + a real Cordis mount with stub services.
