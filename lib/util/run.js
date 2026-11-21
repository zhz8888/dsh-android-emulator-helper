import { spawn as spawnChild } from 'node:child_process'
import { constants as osConstants } from 'node:os'

/**
 * What one command left behind.
 *
 * @typedef {object} RunResult
 * @property {string[]} cmd - the argv vector the command was launched with.
 * @property {number} code - the exit code; 127 when the command could not start.
 * @property {string} stdout - the decoded standard output.
 * @property {string} stderr - the decoded standard error.
 * @property {boolean} timed - whether the timeout killed the process.
 */

/**
 * What one command that streams bytes left behind.
 *
 * `bytes` is the authoritative stdout. `stdout` is still present because every
 * shared helper (`ok`, `brief`) reads it, but it is a **lossy** UTF-8 decode:
 * a byte sequence that is not valid UTF-8 comes back with replacement
 * characters, so it must never be re-encoded to recover the payload. Read
 * `bytes` whenever the value is not text.
 *
 * @typedef {RunResult & {bytes: Buffer}} RunBytesResult
 */

/**
 * Run a child process, collecting its whole output as text (no shell).
 *
 * @param {string[]} cmd - argv vector; `cmd[0]` is the executable.
 * @param {{cwd?: string, env?: Record<string, string|undefined>, input?: string, timeout?: number}} [opts]
 *   `env` merges over `process.env`; `input` is written to stdin; `timeout` defaults to 120s.
 * @returns {Promise<RunResult>} exit code (127 on spawn failure), decoded output, and timeout flag.
 */
export async function run(cmd, opts = {}) {
  return execute(cmd, opts, false)
}

/**
 * Run a child process, collecting raw stdout bytes (e.g. `adb exec-out` PNG).
 *
 * A sibling of {@link run} sharing one spawn implementation, so the timeout,
 * drain and error handling are not duplicated.
 *
 * @param {string[]} cmd - argv vector; `cmd[0]` is the executable.
 * @param {{cwd?: string, env?: Record<string, string|undefined>, input?: string, timeout?: number}} [opts]
 *   Process options, exactly as {@link run}.
 * @returns {Promise<RunBytesResult>} the record, plus the raw stdout bytes.
 */
export async function runBytes(cmd, opts = {}) {
  return /** @type {Promise<RunBytesResult>} */ (execute(cmd, opts, true))
}

/**
 * The one spawn implementation both public entry points share.
 *
 * @param {string[]} cmd - argv vector; `cmd[0]` is the executable.
 * @param {{cwd?: string, env?: Record<string, string|undefined>, input?: string, timeout?: number}} opts
 *   Process options.
 * @param {boolean} binary - whether to keep the raw stdout buffer.
 * @returns {Promise<RunResult | RunBytesResult>} the command's record.
 */
async function execute(cmd, opts, binary) {
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...(opts.env ?? {}) }).filter((item) => typeof item[1] === 'string'),
  )
  const actual = platformCommand(cmd, env)
  const child = spawn(actual.argv, opts.cwd, env, opts.input !== undefined, actual.verbatim)
  if (child instanceof Error) {
    return { cmd, code: 127, stdout: '', stderr: child.message, timed: false }
  }

  const timeout = opts.timeout ?? 120_000
  let timed = false
  /** Escalation timer: a child that ignores SIGTERM must still be terminated. */
  /** @type {NodeJS.Timeout | undefined} */
  let killTimer
  const timer = setTimeout(() => {
    timed = true
    child.kill('SIGTERM')
    killTimer = setTimeout(() => child.kill('SIGKILL'), TERM_KILL_GRACE_MS)
  }, timeout)

  /** @type {Error | undefined} */
  let spawnError
  // The stdout stream can only be consumed once, so it is always read as bytes
  // and decoded afterwards when text is what the caller wants. Attaching two
  // collectors to the same stream would drain it for whichever ran second.
  const out = collectBytes(child.stdout)
  const err = collect(child.stderr)
  if (opts.input !== undefined && child.stdin) {
    // The child may exit before reading stdin (a failed `avdmanager` probe, for
    // example). The write then fails with EPIPE on the stream, not on the
    // child, and an unhandled stream error would take the host process down.
    child.stdin.on('error', (error) => {
      if (/** @type {{code?: string}} */ (error).code !== 'EPIPE') spawnError ??= error
    })
    child.stdin.write(opts.input)
    child.stdin.end()
  }

  /** @type {NodeJS.Timeout | undefined} */
  let exitTimer
  /** @type {Promise<number>} */
  const finished = new Promise((resolve) => {
    let settled = false
    /** @param {number} exitCode */
    const settle = (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer !== undefined) clearTimeout(killTimer)
      if (exitTimer !== undefined) clearTimeout(exitTimer)
      resolve(exitCode)
    }
    child.once('error', (error) => {
      spawnError = error instanceof Error ? error : new Error(String(error))
      settle(127)
    })
    child.once('close', (exitCode) => settle(exitCode ?? exitCodeFor(child)))
    // `close` waits for every stdio stream, so a grandchild that inherited
    // stdout can keep it pending forever. Once the direct child is gone, give
    // the pipes a short drain window and settle anyway.
    child.once('exit', () => {
      exitTimer = setTimeout(() => settle(child.exitCode ?? exitCodeFor(child)), EXIT_DRAIN_MS)
    })
  })

  const code = await finished
  const [bytes, stderr] = await withTimeout(
    Promise.all([out, err]),
    EXIT_DRAIN_MS * 2,
    [Buffer.alloc(0), ''],
  )
  const record = {
    cmd,
    code,
    stdout: bytes.toString('utf8'),
    stderr: spawnError ? [stderr.trim(), spawnError.message].filter(Boolean).join('\n') : stderr,
    timed,
  }
  return binary ? { ...record, bytes } : record
}

/** Grace period between SIGTERM and SIGKILL on a timeout. */
const TERM_KILL_GRACE_MS = 2_000

/** How long the pipes may take to drain after the direct child exited. */
const EXIT_DRAIN_MS = 500

/**
 * Resolve with `fallback` when `promise` does not settle in time.
 *
 * @template T
 * @param {Promise<T>} promise - the promise to bound.
 * @param {number} ms - the deadline.
 * @param {T} fallback - the value to use when the deadline wins.
 * @returns {Promise<T>} the promise or the fallback.
 */
async function withTimeout(promise, ms, fallback) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer
  try {
    return await /** @type {Promise<T>} */ (
      Promise.race([
        promise,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(fallback), ms)
        }),
      ])
    )
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Spawn without a shell, returning the error instead of throwing on a bad argv.
 *
 * @param {string[]} cmd - argv vector.
 * @param {string | undefined} cwd - the working directory.
 * @param {NodeJS.ProcessEnv} env - the child's environment.
 * @param {boolean} pipeStdin - whether stdin is a pipe rather than ignored.
 * @param {boolean} verbatim - whether the arguments reach the child exactly as written.
 * @returns {import('node:child_process').ChildProcess | Error} the child, or the failure.
 */
function spawn(cmd, cwd, env, pipeStdin, verbatim) {
  const [command, ...args] = cmd
  if (!command) return new Error('Missing command')
  try {
    return spawnChild(command, args, {
      cwd,
      env,
      shell: false,
      windowsVerbatimArguments: verbatim,
      stdio: [pipeStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
}

/**
 * Buffer one readable stream fully as UTF-8 text (nullable for a failed spawn).
 *
 * @param {import('node:stream').Readable | null} [stream] - the stream to drain.
 * @returns {Promise<string>} the decoded text.
 */
async function collect(stream) {
  if (!stream) return ''
  return (await collectBytes(stream)).toString('utf8')
}

/**
 * Buffer one readable stream fully as raw bytes (no UTF-8 decode).
 *
 * @param {import('node:stream').Readable | null} [stream] - the stream to drain.
 * @returns {Promise<Buffer>} the bytes.
 */
async function collectBytes(stream) {
  if (!stream) return Buffer.alloc(0)
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks)
}

/**
 * How one command line is launched on this platform.
 *
 * @typedef {object} PlatformCommand
 * @property {string[]} argv - the argv vector to spawn.
 * @property {boolean} verbatim - whether the arguments reach the child exactly as written.
 */

/**
 * Build the argv to spawn for a command line on this platform.
 *
 * @param {string[]} cmd - argv vector.
 * @param {Record<string, string|undefined>} [env] - child env, to decide `%NAME%` expansion.
 * @returns {PlatformCommand} the argv to spawn and how to pass it.
 */
export function platformCommand(cmd, env = process.env) {
  const head = cmd[0]
  if (process.platform !== 'win32' || !head || !/\.(bat|cmd)$/i.test(head)) {
    return { argv: cmd, verbatim: false }
  }
  // `cmd.exe /d /s /c "<tool> <args>"`: /S strips the outer quotes and every
  // token keeps its own pair — a caret outside quotes dies in the batch's second
  // parse (`a^&b` skipped the batch but still exited 0), so quote instead. No
  // `call`: its extra expansion pass reinterpreted tokens; /c returns the batch's code.
  const line = cmd.map((token) => cmdQuote(token, env)).join(' ')
  return { argv: ['cmd.exe', '/d', '/s', '/c', `"${line}"`], verbatim: true }
}

/**
 * Variables `cmd.exe` defines itself, whatever the child's environment holds.
 *
 * A reference to one of these expands even though it may not be present in
 * `process.env`, so they are treated as always defined.
 */
const CMD_DYNAMIC_VARIABLES = new Set(['cd', 'date', 'time', 'random', 'errorlevel', 'cmdextversion', 'cmdcmdline'])

/**
 * Quote one argv token for `cmd.exe`: double-quote it, refuse the unsafe.
 *
 * @param {string} value - the token.
 * @param {Record<string, string|undefined>} [env] - the child's environment.
 * @returns {string} the token, safe to place on the batch command line.
 * @throws When the token carries a character no batch argument can carry.
 */
export function cmdQuote(value, env = process.env) {
  // Quoting keeps `& | < > ^ ()` literal; three things are refused, not
  // rewritten: `"` (ambiguous batch escaping), a `%NAME%` that would expand
  // (a caret does not stop it — a real batch probe proved it), and CR/LF (ends
  // the line). Undefined `%s` stays literal, so `input text` still works.
  const text = String(value ?? '')
  if (text.includes('"')) {
    throw new Error(`Cannot pass an argument containing a double quote to a batch file: ${text}`)
  }
  const reference = expandingReference(text, env)
  if (reference !== undefined) {
    throw new Error(
      `Cannot pass an argument containing the batch variable ${reference} (cmd.exe would expand it): ${text}`,
    )
  }
  if (/[\r\n]/.test(text)) {
    throw new Error('Cannot pass an argument containing a line break to a batch file.')
  }
  return `"${text}"`
}

/**
 * Find the first `%NAME%` in an argument that `cmd.exe` would expand.
 *
 * Undefined names are left literal, which keeps `input text`'s `%s` intact.
 *
 * @param {string} text - one argument.
 * @param {Record<string, string|undefined>} env - the child's environment.
 * @returns {string|undefined} the reference that would expand, if any.
 */
function expandingReference(text, env) {
  for (const match of text.matchAll(/%.+?%/g)) {
    const reference = match[0]
    const inner = reference.slice(1, -1)
    const name = inner.includes(':') ? inner.slice(0, inner.indexOf(':')) : inner
    if (name === '') continue
    if (CMD_DYNAMIC_VARIABLES.has(name.toLowerCase())) return reference
    if (environmentValue(env, name) !== undefined) return reference
  }
  return undefined
}

/**
 * Read one environment value, matching names case-insensitively as `cmd.exe` does.
 *
 * @param {Record<string, string|undefined>} env - the child's environment.
 * @param {string} name - the variable name without its percent signs.
 * @returns {string|undefined} the value, when the variable is defined.
 */
function environmentValue(env, name) {
  if (Object.hasOwn(env, name)) return env[name]
  const wanted = name.toLowerCase()
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === wanted) return env[key]
  }
  return undefined
}

/**
 * Whether a `run()` result represents a clean, non-timed-out exit.
 *
 * @param {RunResult} item - the command's record.
 * @returns {boolean} true when the command succeeded.
 */
export function ok(item) {
  return item.code === 0 && !item.timed
}

/** Largest delay `setTimeout` accepts; a bigger one fires after 1 ms. */
const MAX_TIMER_MS = 2_147_483_647

/**
 * Resolve a call timeout from a millisecond override and a seconds setting.
 *
 * @param {number | undefined} overrideMs - `timeoutMs` from the tool arguments.
 * @param {number} settingSeconds - the live setting, in seconds.
 * @returns {number} the deadline in milliseconds.
 * @throws When the override is not a positive, finite number.
 */
export function callTimeoutMs(overrideMs, settingSeconds) {
  // Refuse rather than clamp: `0` would hit `setTimeout` as "immediately"
  // (a silent empty timeout), and a negative raises TimeoutNegativeWarning.
  if (overrideMs === undefined) return settingSeconds * 1000
  if (!Number.isFinite(overrideMs) || overrideMs <= 0) throw new Error(`Invalid timeoutMs: ${overrideMs}`)
  // Node stores a timer's delay in a 32-bit signed integer: anything above
  // 2^31-1 wraps and fires after 1 ms, so a caller asking for a very long
  // deadline would have its command killed at once and reported as timed out.
  // The ceiling is refused rather than clamped, for the same reason as above.
  if (overrideMs > MAX_TIMER_MS) {
    throw new Error(`Invalid timeoutMs: ${overrideMs} (the largest supported deadline is ${MAX_TIMER_MS})`)
  }
  return overrideMs
}

/**
 * Join a result's output and truncate it to a model-friendly size.
 *
 * A no-output record describes its exit instead of returning `''`, so the
 * caller never sees `android_install_app: ` with nothing to act on.
 *
 * @param {RunResult} item - the command's record.
 * @param {number} [limit] - the character budget.
 * @returns {string} the truncated output, never empty.
 */
export function brief(item, limit = 4000) {
  const text = [item.stdout.trim(), item.stderr.trim()].filter(Boolean).join('\n')
  if (text.length === 0) return describeExit(item)
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n...[truncated]`
}

/**
 * Report a signalled child's exit as `128 + signal`, else 1.
 *
 * @param {import('node:child_process').ChildProcess} child - the child that settled.
 * @returns {number} the exit code to report.
 */
function exitCodeFor(child) {
  const signal = child.signalCode
  if (!signal) return 1
  const number = osConstants.signals[signal]
  return typeof number === 'number' ? 128 + number : 1
}

/**
 * One line describing how a command ended, for a record with no output.
 *
 * @param {RunResult} item - the command's record.
 * @returns {string} a human-readable exit description.
 */
function describeExit(item) {
  const name = item.cmd[0] ?? 'the command'
  if (item.timed) return `${name} timed out with no output`
  if (item.code === 127) return `${name} could not be started`
  if (item.code > 128) return `${name} was killed by signal ${item.code - 128}`
  return `${name} exited with code ${item.code} and no output`
}

/**
 * Split a settings textarea into argv tokens, one argument per line.
 *
 * Line-by-line (not shell-ish), so an argument can hold spaces unquoted; `#`
 * comments and blanks are dropped.
 *
 * @param {string} value - the raw setting text.
 * @returns {string[]} the arguments, in order.
 */
export function splitArgumentLines(value) {
  if (typeof value !== 'string') return []
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}
