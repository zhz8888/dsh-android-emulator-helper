/**
 * Offline verification recipe for this plugin. Run it from this directory:
 *
 *     node verify.mjs
 *
 * It requires `node_modules/@deepseek-ai/{schemastery,dsh-tools,cordis,cosmokit}`
 * to resolve. Those are the DSH runtime packages; at real runtime the DSH
 * launcher's runtime resolution supplies them, and for local development the
 * cheapest bridge is a symlink per package into this directory (see README.md).
 *
 * Nothing here boots DSH or touches a real profile.
 */
import { Context, Service, resolveConfig } from '@deepseek-ai/cordis';
import { updateVolatile, volatileEntries, isVolatile } from '@deepseek-ai/cosmokit';
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';
import * as plugin from './lib/index.js';

const section = (title) => console.log(`\n=== ${title} ===`);
let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
};

// ── 1. module contract ───────────────────────────────────────────────────────
section('1. module contract');
check('exports are Config/apply/inject/name', JSON.stringify(Object.keys(plugin).sort()) === '["Config","apply","inject","name"]', Object.keys(plugin));
check('name', plugin.name === 'example-host-tool', plugin.name);
check('inject', JSON.stringify(plugin.inject) === '["tools","subprocess"]', plugin.inject);

// ── 2. Config: volatile marks + parse ────────────────────────────────────────
section('2. Config volatile marks');
const json = JSON.stringify(plugin.Config.toJSON());
check('every field carries meta.volatile', (json.match(/"volatile":true/g) ?? []).length === 4, (json.match(/"volatile":true/g) ?? []).length);
const live = plugin.Config['~standard'].validate({}).value;
check('parsed fields are Volatile references', Object.values(live).every(isVolatile), Object.fromEntries(Object.entries(live).map(([k, v]) => [k, typeof v])));
check('.get() unwraps the default', live.prefix.get() === 'host-run', live.prefix.get());

// Mirror dsh-settings.volatileForm(): a Config with NO volatile field never
// reaches the Settings UI at all.
function volatileForm(schema) {
  if (schema.meta.volatile) return true;
  if (schema.type === 'object') {
    const dict = Object.fromEntries(
      Object.entries(schema.dict ?? {}).flatMap(([k, c]) => {
        const f = volatileForm(c);
        return f === undefined ? [] : [[k, f]];
      }),
    );
    return Object.keys(dict).length === 0 ? undefined : dict;
  }
}
check('volatileForm() projects all 4 fields', Object.keys(volatileForm(plugin.Config) ?? {}).length === 4, Object.keys(volatileForm(plugin.Config) ?? {}));

// ── 3. live edit without remount (mirrors loader._commitVolatile) ────────────
section('3. live edit');
const candidate = plugin.Config['~standard'].validate({ prefix: 'EDITED-IN-UI', timeoutMs: 1234 }).value;
const paths = volatileEntries(live).flatMap(({ path, ref }) => {
  const source = path.reduce((v, k) => Reflect.get(v, k), candidate);
  if (ref.get() === source.get()) return [];
  updateVolatile(ref, source);
  return [path.join('.')];
});
check('changed paths committed in place', JSON.stringify(paths) === '["prefix","timeoutMs"]', paths);
check('existing reference observes the new value', live.prefix.get() === 'EDITED-IN-UI', live.prefix.get());

// ── 4. mount on a real Cordis context with stub services ─────────────────────
section('4. mount + register + dispatch');
let captured;
class FakeTools extends Service {
  constructor(c) { super(c, 'tools'); }
  register(definition) {
    // The REAL registry wraps this in ctx.effect(...) itself; mirroring that
    // here is what makes fiber disposal unregister the tool.
    return this.ctx.effect(() => {
      captured = definition;
      return () => { captured = undefined; };
    }, 'tools.register()');
  }
  get() { return undefined; }
}
class FakeSubprocess extends Service {
  constructor(c) { super(c, 'subprocess'); }
  spawn(spec) {
    return {
      done: Promise.resolve({ exitCode: 0, signal: null }),
      collected: {
        stdout: { readFrom: () => ({ text: `ran ${spec.argv.join(' ')} in ${spec.cwd}\n`, lossy: false, nextOffset: 0 }) },
        stderr: { readFrom: () => ({ text: '', lossy: false, nextOffset: 0 }) },
      },
    };
  }
}

const ctx = new Context();
ctx.on('internal/error', (_fiber, error) => console.log('!! internal/error:', error?.message ?? error));
await ctx.plugin({ name: 'stub-services', apply(c) { new FakeTools(c); new FakeSubprocess(c); } });
check('stub services visible', typeof ctx.tools === 'object' && typeof ctx.subprocess === 'object');

// The loader validates the RAW entry config against the module's Config, then
// mounts with the raw config (cordis re-validates it).
const parsed = resolveConfig(plugin, { prefix: 'MOUNTED' });
const fiber = ctx.plugin(plugin, { prefix: 'MOUNTED' });
await fiber;
check('fiber ACTIVE (state 2)', fiber.state === 2, fiber.state);
check('tool registered as host_run', captured?.name === 'host_run', captured?.name);
check('definition fields', JSON.stringify(Object.keys(captured).sort()) === '["description","execute","isConcurrencySafe","name","output","parameters","presentCall","timeoutMs"]', Object.keys(captured).sort());

const argSchema = captured.parameters;
check('argv is required in the compiled schema', JSON.stringify(argSchema.required) === '["argv"]', argSchema.required);
check('bad argv rejected by the schema', validateJsonSchemaValue(argSchema, { argv: [1, 2] }, '').length === 2);

const exec = { signal: new AbortController().signal, agent: { session: { header: { cwd: '/tmp' } } }, callId: 'c1' };
const args = { argv: ['/bin/echo', 'mounted'] };
const value = await captured.execute(args, exec);
check('output validates against output.schema', validateJsonSchemaValue(captured.output.schema, value, 'value').length === 0, validateJsonSchemaValue(captured.output.schema, value, 'value'));
check('render produces one text block', JSON.stringify(captured.output.render(args, value)) === JSON.stringify([{ type: 'text', text: 'MOUNTED: [exit code 0]\nran /bin/echo mounted in /tmp' }]), captured.output.render(args, value));

let threw = false;
try { await captured.execute({ argv: [] }, exec); } catch { threw = true; }
check('empty argv throws (registry converts to isError)', threw);

fiber.dispose();
// `fiber.dispose()` returns a Promise: the effect cleanup that unregisters the
// tool runs asynchronously, so a synchronous check right after dispose() still
// sees the tool. Await the disposal (or the next macrotask) before asserting.
await new Promise((resolve) => setTimeout(resolve, 20));
check('fiber disposal unregistered the tool', captured === undefined);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
