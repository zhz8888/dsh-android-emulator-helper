/**
 * Minimal DSH HOST-half plugin.
 *
 * Demonstrates, in one file, everything a host-half tool plugin needs:
 *   1. the standard Cordis plugin module contract (`name` / `Config` / `inject` / `apply`);
 *   2. a live-editable Config whose fields are marked `.volatile()`;
 *   3. reading those fields at CALL time through the volatile reference's `.get()`;
 *   4. registering one model-facing tool with `ctx.tools.register(defineTool({...}))`;
 *   5. spawning a managed subprocess through `ctx.subprocess` with cwd/env/stdin/timeout;
 *   6. returning a structured value validated against `output.schema` and rendered
 *      into model-visible content blocks.
 *
 * @module dsh-example-host-tool
 */
import Schema from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';

/** Stable Cordis/Loader identity. Also the default entry `id` when a patch omits one. */
export const name = 'example-host-tool';

/**
 * Services this plugin requires. Cordis will not call `apply` until every name
 * here is available in the composition, and will dispose the plugin if one
 * disappears. Do NOT list a service you only read opportunistically — use
 * `ctx.get('name')` for those (see the `jobs` note below).
 */
export const inject = ['tools', 'subprocess'];

/**
 * The plugin's Config schema, built at MODULE LOAD time (long before any `ctx`
 * exists). Every field is `.volatile()`, which is what makes it editable from
 * the Settings UI and applied LIVE: the loader re-parses the raw config, commits
 * the new values into the running volatile references, and emits
 * `loader/volatile-update` WITHOUT remounting this plugin.
 *
 * Semantics of `.volatile()`: the parsed value for that field is no longer a
 * plain value but a `Volatile` reference object `{ get(): T }`; its snapshot is
 * replaced in place by the loader. Constraints (enforced by schemastery at
 * validation time):
 *   - a volatile field must sit at a fixed object path — no volatile schema
 *     inside an array `items`, a dict key, or another volatile field;
 *   - `.volatile()` on an already-volatile schema throws.
 *
 * `.default()` / `.description()` / `.role('secret')` / `.comment()` are
 * annotations the settings form and the credential redactor read. `.role('secret')`
 * additionally strips the field (and its default) from every value/description
 * handed to a remote caller.
 */
export const Config = Schema.object({
  // NOTE the trailing `.volatile()` on every field — without it the field is
  // plain configuration: still settable in cordis.patch.yml, but INVISIBLE to
  // the Settings form (dsh-settings skips entries with no volatile field) and
  // requiring a remount to change.
  prefix: Schema.string()
    .default('host-run')
    .description('Prefix prepended to the tool result’s first output line.')
    .volatile(),
  timeoutMs: Schema.natural()
    .min(100)
    .max(600000)
    .default(15000)
    .description('Wall-clock deadline for one spawn. Exceeding it aborts the child and reports timedOut.')
    .volatile(),
  maxBytes: Schema.natural()
    .min(1024)
    .max(1048576)
    .default(65536)
    .description('Per-stream collected-output cap in bytes; the retained tail is kept and truncation is reported.')
    .volatile(),
  maxArgv: Schema.natural()
    .min(1)
    .max(256)
    .default(64)
    .description('Maximum number of argv elements accepted in one call.')
    .volatile(),
});

/** Read one Config field, whichever form (volatile reference or plain value) the host supplied. */
function readField(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value;
}

/**
 * Flatten the entry Config into plain values, read FRESH at every call.
 *
 * This is the whole live-edit contract on the plugin's side: never destructure
 * `config` once in `apply` and close over the scalars, or a value saved in the
 * Settings UI will not reach the next call.
 *
 * @param raw - the `config` argument handed to `apply`.
 * @returns plain field values.
 */
function readLive(raw) {
  const out = {};
  for (const [key, value] of Object.entries(raw ?? {})) out[key] = readField(value);
  return out;
}

/**
 * Enforce the invariants the parameter schema cannot express.
 * @param args - schema-validated call arguments.
 * @param cap - configured maximum argv length.
 * @returns the validated argv.
 */
function toArgv(args, cap) {
  if (args.argv.length === 0) throw new Error('argv must contain at least one element');
  if (args.argv.length > cap) throw new Error(`argv accepts at most ${cap} elements, got ${args.argv.length}`);
  for (const [index, value] of args.argv.entries()) {
    if (value.trim().length === 0) throw new Error(`argv[${index}] must be a non-empty string`);
    if (value.includes('\0')) throw new Error(`argv[${index}] must not contain a NUL byte`);
  }
  return args.argv;
}

/**
 * Mount the tool.
 *
 * `ctx.tools.register()` already ties the registration to this plugin's fiber
 * and returns the exact disposer, so an extra `ctx.effect(...)` wrapper is
 * unnecessary. Wrap it only when you also need to bundle other side effects
 * into one ordered teardown.
 *
 * @param ctx - registrant context carrying `tools` and `subprocess`.
 * @param config - the deployment's parsed Config (volatile references for volatile fields).
 */
export function apply(ctx, config) {
  ctx.tools.register(
    defineTool({
      name: 'host_run',
      description:
        'Run one executable with an explicit argv and return its exit status, stdout, and stderr. ' +
        'No shell is involved: argv is passed verbatim, so quoting is never needed and never interpreted. ' +
        'Each call is a fresh process; pass `cwd` instead of changing directory. ' +
        'Output is truncated to its retained tail and the truncation is reported.',
      // Author-facing parameter DSL (NOT raw JSON Schema). `required: true` on a
      // property promotes it into the parent object's `required` array; every
      // object node must state `additionalProperties` explicitly.
      parameters: {
        argv: {
          type: 'array',
          required: true,
          description: 'The program and its arguments, e.g. ["/bin/echo", "hi"]. argv[0] is resolved against PATH.',
          items: { type: 'string' },
        },
        cwd: {
          type: 'string',
          description: 'Working directory. Defaults to the calling session’s working directory.',
        },
        stdin: {
          type: 'string',
          description: 'Text written to the child’s stdin, which is then closed. Omit to leave stdin at /dev/null.',
        },
        env: {
          type: 'object',
          additionalProperties: true,
          description:
            'Extra environment entries merged over the harness’s scrubbed parent environment. ' +
            'Credential-shaped (`*KEY*`, `*TOKEN*`, `*SECRET*`, `*PASSWORD*`) and all `DSH_*` names are ' +
            'scrubbed from the inherited environment; a value supplied here survives.',
        },
      },
      // Output contract. The returned value is snapshotted, validated against
      // `schema`, deep-frozen, and then handed to `render` to become content blocks.
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            // The DSL has NO `type: ['a','b']` array form — a nullable scalar is
            // an exact-one `oneOf` (which is also what the raw subset allows).
            exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
            signal: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            timedOut: { type: 'boolean', required: true },
            stdout: { type: 'string', required: true },
            stderr: { type: 'string', required: true },
            stdoutTruncated: { type: 'boolean', required: true },
            stderrTruncated: { type: 'boolean', required: true },
          },
        },
        // render(args, value) -> ContentBlock[]. `text` blocks are the norm; an
        // image rides an `{ type: 'image', attachment }` block (see the note at
        // the bottom of this file).
        render: (_args, value) => {
          const status =
            value.exitCode === null
              ? `killed by ${value.signal ?? 'unknown signal'}`
              : `exit code ${value.exitCode}`;
          const flags = [value.timedOut ? 'timed out' : '', value.stdoutTruncated ? 'stdout truncated' : '']
            .filter(Boolean)
            .join(', ');
          const body = [
            `[${status}${flags.length > 0 ? `; ${flags}` : ''}]`,
            value.stdout.length > 0 ? value.stdout.replace(/\n+$/, '') : '',
            value.stderr.length > 0 ? `<stderr>\n${value.stderr.replace(/\n+$/, '')}\n</stderr>` : '',
          ]
            .filter((part) => part.length > 0)
            .join('\n');
          return [{ type: 'text', text: `${readLive(config).prefix}: ${body}` }];
        },
      },
      // Optional UI hint for the browser card. Evaluated only when the model
      // calls the tool directly; skipped for nested (PTC) dispatches, and
      // replayed calls with arguments that no longer validate fall back silently.
      presentCall: (args) => ({ card: 'generic', title: args.argv.join(' '), kind: 'execute', rawInput: args.argv.join(' ') }),
      // Only an exact `true` lets the scheduler start this call in parallel with
      // other parallel-safe calls. Spawning is independent, so we always allow it.
      isConcurrencySafe: () => true,
      // Per-call timeout budget the registry enforces around the whole
      // dispatch (pre-execute + guards + body + post-execute), separate from
      // the spawn deadline this tool applies itself.
      timeoutMs: 600000,
      async execute(args, exec) {
        const live = readLive(config);
        const argv = toArgv(args, live.maxArgv);

        const cwd = args.cwd ?? exec.agent?.session.header.cwd;
        if (cwd === undefined) throw new Error('host_run needs a cwd: pass `cwd` or call it from an agent with a session cwd');

        // The subprocess seam owns no deadline of its own — deadlines belong to
        // consumers. Fuse our deadline with the caller's cancellation signal.
        const deadline = AbortSignal.timeout(live.timeoutMs);
        const signal = AbortSignal.any([exec.signal, deadline]);

        const handle = ctx.subprocess.spawn({
          argv,
          cwd,
          stdio: {
            stdin: args.stdin === undefined ? 'ignore' : { data: args.stdin },
            // Collect mode: bounded tail-keeping buffering with an optional spill file.
            stdout: { maxBytes: live.maxBytes },
            stderr: { maxBytes: live.maxBytes },
          },
          // Grace period the provider gives the managed process range between
          // the termination request and the forced kill.
          graceMs: 2000,
          env: args.env,
          signal,
        });

        let outcome;
        try {
          outcome = await handle.done; // { exitCode: number|null, signal: string|null }
        } catch (error) {
          throw new Error(`failed to run ${JSON.stringify(argv[0])}: ${String(error?.message ?? error)}`, { cause: error });
        }

        // Readers are offset-based and non-consuming; offset 0 after settlement
        // reads the whole retained tail. `lossy` means the beginning scrolled out
        // of the in-memory window (the complete stream is in spillPath then).
        const read = (collector) =>
          collector === undefined ? { text: '', lossy: false } : collector.readFrom(0);
        const stdout = read(handle.collected.stdout);
        const stderr = read(handle.collected.stderr);

        return {
          exitCode: outcome.exitCode,
          signal: outcome.signal,
          // `deadline.aborted` is true only when OUR timer fired: `AbortSignal.any`
          // does not abort its inputs, so a caller cancellation leaves it false.
          timedOut: deadline.aborted,
          stdout: stdout.text,
          stderr: stderr.text,
          stdoutTruncated: stdout.lossy === true,
          stderrTruncated: stderr.lossy === true,
        };
      },
    }),
  );

  ctx.logger.debug('example-host-tool: registered host_run');
}

/**
 * ── Returning an IMAGE from a tool ────────────────────────────────────────────
 *
 * A tool result carries an image as a SECOND content block whose `attachment`
 * is a durable attachment reference. `output.schema` must declare the same
 * fields so the value survives validation, and the model route must declare
 * `image` input or the turn fails:
 *
 *   const ref = await ctx.get('attachments').saveImage({ data, mediaType: 'image/png', name: 'shot.png' });
 *   return { path, image: { attachmentId: ref.attachmentId, mediaType: ref.mediaType,
 *                           bytes: ref.bytes, width: ref.width, height: ref.height } };
 *   // render: (_args, value) => [
 *   //   { type: 'text',  text: `<path>${value.path}</path>\n<type>image</type>` },
 *   //   { type: 'image', attachment: { attachmentId: AttachmentId(value.image.attachmentId), ... } },
 *   // ]
 *
 * `dsh-tools` re-attaches a successful image-bearing sub-tool result to the
 * next model step (`exec.deferContext`), which is what makes `read_image`
 * usable from inside a PTC `run_code` program.
 *
 * ── Errors ────────────────────────────────────────────────────────────────────
 *
 * THROW. The registry catches anything a tool body throws and turns it into
 * `{ isError: true, content: [{ type: 'text', text: 'Error: <message>' }] }`,
 * with `info: { name, code }` filled in for a `HarnessError` subclass. There is
 * no result object to return and no `isError` field to set from inside
 * `execute`; only a `tools/post-execute` listener may author an error result.
 */
