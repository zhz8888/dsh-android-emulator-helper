import { spawn as spawnChild } from 'node:child_process'

/**
 * Run one child process and collect its whole output.
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
 * @returns {Promise<{cmd: string[], code: number, stdout: string, stderr: string, timed: boolean}>}
 *   Exit code (127 for a spawn failure), decoded output, and whether the
 *   timeout killed the process.
 */
export async function run(cmd, opts = {}) {
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
  const timer = setTimeout(() => {
    timed = true
    child.kill('SIGTERM')
  }, timeout)

  const out = collect(child.stdout)
  const err = collect(child.stderr)
  if (opts.input !== undefined && child.stdin) {
    child.stdin.write(opts.input)
    child.stdin.end()
  }

  let spawnError
  const code = await new Promise((resolve) => {
    let settled = false
    const settle = (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(exitCode)
    }
    child.once('error', (error) => {
      spawnError = error instanceof Error ? error : new Error(String(error))
      settle(127)
    })
    child.once('close', (exitCode) => settle(exitCode ?? 1))
  })

  const [stdout, stderr] = await Promise.all([out, err])
  return {
    cmd,
    code,
    stdout,
    stderr: spawnError ? [stderr.trim(), spawnError.message].filter(Boolean).join('\n') : stderr,
    timed,
  }
}

/** Spawn without a shell, returning the error instead of throwing on a bad argv. */
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

/** Buffer one readable stream fully as UTF-8 text. */
async function collect(stream) {
  if (!stream) return ''
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Route `.bat`/`.cmd` launchers through `cmd.exe` on Windows, as Node requires. */
function commandForPlatform(cmd) {
  const head = cmd[0]
  if (process.platform !== 'win32' || !head || !/\.(bat|cmd)$/i.test(head)) return cmd
  return ['cmd.exe', '/d', '/s', '/c', cmd.map(cmdQuote).join(' ')]
}

/** Quote one argv token for the `cmd.exe` fallback above. */
function cmdQuote(value) {
  if (!/[ \t&()^|<>"]/.test(value)) return value
  return `"${value.replace(/(["^])/g, '^$1')}"`
}

/** Whether a `run()` result represents a clean, non-timed-out exit. */
export function ok(item) {
  return item.code === 0 && !item.timed
}

/** Join a result's output and truncate it to a model-friendly size. */
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
