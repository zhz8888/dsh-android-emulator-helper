import { spawn as spawnChild } from 'node:child_process'

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
 * Run one child process and collect its whole output as text.
 *
 * The ported providers only ever invoke Android SDK command-line tools, so this
 * stays deliberately small: no shell, an explicit environment, an optional
 * stdin payload, and a SIGTERM timeout. Everything the plugin needs to know
 * about a failure is in the returned record rather than in a thrown error, so
 * callers decide whether a non-zero exit is fatal.
 *
 * @param {string[]} cmd - argv vector; `cmd[0]` is the executable.
 * @param {{cwd?: string, env?: Record<string, string|undefined>, input?: string, timeout?: number}} [opts]
 *   Process options. `env` is merged over `process.env`; `input` is written to
 *   stdin and the stream is closed; `timeout` defaults to 120s.
 * @returns {Promise<RunResult>}
 *   Exit code (127 for a spawn failure), decoded output, and whether the
 *   timeout killed the process.
 */
export async function run(cmd, opts = {}) {
  return execute(cmd, opts, false)
}

/**
 * Run one child process and collect its whole output as bytes.
 *
 * `adb exec-out` streams a device command's raw stdout, which for `screencap`
 * is a PNG; decoding that as UTF-8 would corrupt it. This exists as a sibling
 * of {@link run} rather than as a second spawn implementation on purpose: the
 * timeout escalation, the bounded drain and the `error` handling are the parts
 * that are easy to get wrong, and the screenshot provider got them wrong by
 * re-implementing the spawn (see `docs/verification/pre-release-audit-v1.1.3.md`,
 * B-2).
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
  const actual = commandForPlatform(cmd)
  const child = spawn(actual, opts.cwd, env, opts.input !== undefined)
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
    child.once('close', (exitCode) => settle(exitCode ?? 1))
    // `close` waits for every stdio stream, so a grandchild that inherited
    // stdout can keep it pending forever. Once the direct child is gone, give
    // the pipes a short drain window and settle anyway.
    child.once('exit', () => {
      exitTimer = setTimeout(() => settle(child.exitCode ?? 1), EXIT_DRAIN_MS)
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
 * Used only after the direct child is gone, so a grandchild holding the pipes
 * open cannot keep the call alive past its timeout.
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
 * The error is returned rather than thrown so the caller can report it in the
 * command's own record: a missing binary is a failed command here, not a
 * failed tool call.
 *
 * @param {string[]} cmd - argv vector.
 * @param {string | undefined} cwd - the working directory.
 * @param {NodeJS.ProcessEnv} env - the child's environment.
 * @param {boolean} pipeStdin - whether stdin is a pipe rather than ignored.
 * @returns {import('node:child_process').ChildProcess | Error} the child, or the failure.
 */
function spawn(cmd, cwd, env, pipeStdin) {
  const [command, ...args] = cmd
  if (!command) return new Error('Missing command')
  try {
    return spawnChild(command, args, {
      cwd,
      env,
      shell: false,
      stdio: [pipeStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
}

/**
 * Buffer one readable stream fully as UTF-8 text.
 *
 * The stream is nullable because a child that could not start has none, and
 * the error path reads no output at all.
 *
 * @param {import('node:stream').Readable | null} [stream] - the stream to drain.
 * @returns {Promise<string>} the decoded text.
 */
async function collect(stream) {
  if (!stream) return ''
  return (await collectBytes(stream)).toString('utf8')
}

/**
 * Buffer one readable stream fully as raw bytes.
 *
 * Kept apart from {@link collect} because decoding is the destructive step: a
 * PNG streamed through UTF-8 does not survive the round trip.
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
 * Route `.bat`/`.cmd` launchers through `cmd.exe` on Windows, as Node requires.
 *
 * @param {string[]} cmd - argv vector.
 * @returns {string[]} the argv vector to launch.
 */
function commandForPlatform(cmd) {
  const head = cmd[0]
  if (process.platform !== 'win32' || !head || !/\.(bat|cmd)$/i.test(head)) return cmd
  return ['cmd.exe', '/d', '/s', '/c', cmd.map(cmdQuote).join(' ')]
}

/**
 * Quote one argv token for the `cmd.exe` fallback above.
 *
 * @param {string} value - the token.
 * @returns {string} the token, quoted when `cmd.exe` would split it.
 */
function cmdQuote(value) {
  if (!/[ \t&()^|<>"]/.test(value)) return value
  return `"${value.replace(/(["^])/g, '^$1')}"`
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

/**
 * Join a result's output and truncate it to a model-friendly size.
 *
 * @param {RunResult} item - the command's record.
 * @param {number} [limit] - the character budget.
 * @returns {string} the truncated output.
 */
export function brief(item, limit = 4000) {
  const text = [item.stdout.trim(), item.stderr.trim()].filter(Boolean).join('\n')
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n...[truncated]`
}

/**
 * Split a settings textarea into argv tokens, one argument per line.
 *
 * A line-by-line grammar is used instead of shell-ish splitting so an argument
 * may contain spaces without needing quotes: everything after the first
 * non-space character of a line is kept verbatim, `#` comments and blank lines
 * are dropped, and a trailing newline is insignificant.
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
