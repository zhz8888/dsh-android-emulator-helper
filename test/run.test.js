import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { brief, callTimeoutMs, run, runBytes } from '../lib/util/run.js'

/**
 * Child-process hardening for the one helper every provider uses.
 *
 * Two failure modes are invisible in an ordinary regression test: a stream
 * error on `child.stdin` is not an error on the child, and `close` waits for
 * every pipe to drain, so a grandchild that inherited stdout can keep a command
 * pending past its timeout. Both are exercised here with real shells.
 */

const POSIX = process.platform !== 'win32'

/**
 * The Windows PowerShell the portable tests prefer: `pwsh`, PowerShell 7.
 *
 * `pwsh` is a separate download, not part of Windows 10/11, so the project
 * treats it as preferred-but-not-required: on Windows the shell is `pwsh` when
 * it is installed and `cmd.exe` when it is not. The in-box Windows PowerShell
 * 5.1 (`powershell.exe`) is never started. It is a different parser and a
 * different encoding stack, and a test that silently fell back to it would pin
 * behaviour the project does not support. `cmd.exe` is present on every
 * Windows, so the portable cases still run on a stock machine.
 *
 * The probe is exported so the fallback can be pinned without a machine that
 * lacks PowerShell 7.
 *
 * @param {{platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv, exists?: (candidate: string) => boolean}} [options]
 *   - the host to probe; every field is injectable for the test below.
 * @returns {'pwsh' | undefined} the program, or undefined when it is not installed.
 */
export function powershell7Program({ platform = process.platform, env = process.env, exists = existsSync } = {}) {
  if (platform !== 'win32') return undefined
  const extensions = (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter((item) => item.length > 0)
  for (const directory of (env.PATH ?? '').split(path.delimiter)) {
    if (directory.length === 0) continue
    for (const extension of extensions) {
      if (exists(path.join(directory, `pwsh${extension}`))) return 'pwsh'
    }
    if (exists(path.join(directory, 'pwsh'))) return 'pwsh'
  }
  return undefined
}

/**
 * The argv that runs `command` in this platform's shell.
 *
 * POSIX uses `/bin/sh`. On Windows `pwsh` (PowerShell 7) is preferred and
 * `cmd.exe /d /s /c` is the final fallback; `powershell.exe` is never started.
 * The command text has to be valid in whichever shell answers — `exit 0` is,
 * and that is what the portable cases below use.
 *
 * @param {string} command - the script to run.
 * @param {{platform?: NodeJS.Platform, pwsh?: string | null}} [options]
 *   - injectable for the test below; `pwsh: null` stands for "not installed".
 * @returns {string[]} the argv.
 */
export function shellArgv(command, { platform = process.platform, pwsh = powershell7Program() } = {}) {
  if (platform !== 'win32') return ['/bin/sh', '-c', command]
  if (typeof pwsh === 'string' && pwsh.length > 0) {
    return [pwsh, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]
  }
  return ['cmd.exe', '/d', '/s', '/c', command]
}

/**
 * The shell for this host.
 *
 * @param {string} command - the command to run.
 * @returns {string[]} the argv.
 */
function shell(command) {
  return shellArgv(command)
}

test('the Windows shell prefers pwsh and falls back to cmd.exe, never powershell.exe', () => {
  // `pwsh` is PowerShell 7, a separate install: preferred when it is present.
  const onlyPowerShell7 = (candidate) => candidate.toLowerCase().endsWith('pwsh.exe')
  assert.equal(
    powershell7Program({
      platform: 'win32',
      env: { PATH: 'C:\\Program Files\\PowerShell\\7', PATHEXT: '.EXE' },
      exists: onlyPowerShell7,
    }),
    'pwsh',
  )
  // A stock Windows carries only `powershell.exe`, which this project never
  // starts: the probe answers "not installed" so the caller takes cmd.exe.
  const onlyWindowsPowerShell = (candidate) => candidate.toLowerCase().endsWith('powershell.exe')
  assert.equal(
    powershell7Program({
      platform: 'win32',
      env: { PATH: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0', PATHEXT: '.EXE;.CMD' },
      exists: onlyWindowsPowerShell,
    }),
    undefined,
  )
  // Off Windows the probe has no answer: the shell is `/bin/sh`.
  assert.equal(powershell7Program({ platform: 'linux', env: { PATH: '/usr/bin' }, exists: () => true }), undefined)

  const installed = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
  assert.deepEqual(shellArgv('exit 0', { platform: 'win32', pwsh: installed }), [
    installed,
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    'exit 0',
  ])
  // `pwsh: null` is the no-PowerShell-7 host: the last resort is cmd.exe.
  assert.deepEqual(shellArgv('exit 0', { platform: 'win32', pwsh: null }), [
    'cmd.exe',
    '/d',
    '/s',
    '/c',
    'exit 0',
  ])
  assert.deepEqual(shellArgv('exit 0', { platform: 'linux' }), ['/bin/sh', '-c', 'exit 0'])
})

test(
  'the cmd.exe fallback starts a child and returns its exit code',
  { skip: process.platform !== 'win32', timeout: 20_000 },
  async () => {
    // The no-PowerShell-7 path has to be exercised on every Windows machine,
    // not only on one that happens not to have `pwsh` installed.
    const out = await run(shellArgv('exit 3', { pwsh: null }), { timeout: 20_000 })
    assert.equal(out.code, 3)
  },
)

test('the platform shell these tests use can actually start', async () => {
  // This is the regression: with `pwsh` hardcoded, a stock Windows host failed
  // here with exit code 127 — `could not be started` — before any assertion
  // about the child-process helper ran.
  const out = await run(shell('exit 0'), { timeout: 20_000 })
  assert.equal(out.code, 0, `the shell this file uses must start: ${out.stderr}`)
})

/**
 * The POSIX script that writes the eight PNG signature bytes on stdout.
 *
 * `cmd.exe` has no byte-exact primitive, so on Windows the bytes are written by
 * the Node that is already running the suite (see the `runBytes` case below)
 * rather than by a shell. That keeps the case runnable on a stock Windows and
 * leaves the `exit 0` cases to exercise the cmd.exe fallback.
 */
const PRINT_PNG = POSIX ? "printf '\\211PNG\\r\\n\\032\\n'" : undefined

test('a child that exits without reading stdin cannot crash the caller', async () => {
  // 2 MiB is larger than a pipe buffer; the payload is still queued when the
  // child exits, and the resulting EPIPE is emitted on the stdin stream.
  const out = await run(shell('exit 0'), { input: 'x'.repeat(2 * 1024 * 1024) })
  assert.equal(typeof out.code, 'number')
  assert.equal(out.timed, false)
})

// The three below are skipped on Windows because the behaviour they pin is
// POSIX signal semantics: `kill('SIGTERM')` is a *signal* there, while on
// Windows it is `TerminateProcess` on the direct child, with no handler to
// trap and no escalation step to observe. The escalation code still runs on
// Windows — there is simply no second stage to prove.

test('a child that ignores SIGTERM is terminated after the grace period', { skip: !POSIX, timeout: 10_000 }, async () => {
  const started = Date.now()
  const out = await run(['/bin/sh', '-c', 'trap "" TERM; sleep 5'], { timeout: 100 })
  const elapsed = Date.now() - started
  assert.equal(out.timed, true)
  assert.ok(elapsed < 5_000, `run() must not wait for the child's own exit: ${elapsed}ms`)
})

test('a grandchild holding stdout does not keep the call pending', { skip: !POSIX, timeout: 10_000 }, async () => {
  const started = Date.now()
  const out = await run(['/bin/sh', '-c', 'sleep 10 & exit 0'], { timeout: 5_000 })
  const elapsed = Date.now() - started
  assert.equal(out.code, 0)
  assert.ok(elapsed < 2_000, `close waits for the inherited pipe; run() must bound that wait: ${elapsed}ms`)
})

test('runBytes keeps the raw stdout bytes that run() would decode', async () => {
  // `adb exec-out screencap -p` is the reason this exists: decoding a PNG as
  // UTF-8 does not survive the round trip.
  const out = await runBytes(
    POSIX ? shell(PRINT_PNG) : [process.execPath, '-e', "process.stdout.write(Buffer.from([137,80,78,71,13,10,26,10]))"],
  )
  assert.equal(out.code, 0)
  assert.deepEqual(out.bytes, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  // `stdout` is a lossy UTF-8 decode and cannot be used to recover the payload:
  // 0x89 is not valid UTF-8, so it becomes U+FFFD. This is exactly why `bytes`
  // has to exist, and the assertion pins that trap rather than papering over it.
  assert.notEqual(Buffer.from(out.stdout, 'latin1').equals(out.bytes), true)
  assert.equal(out.bytes[0], 0x89)
})

test('runBytes applies the same SIGTERM escalation as run()', { skip: !POSIX, timeout: 20_000 }, async () => {
  const started = Date.now()
  const out = await runBytes(['/bin/sh', '-c', 'trap "" TERM; sleep 5'], { timeout: 100 })
  const elapsed = Date.now() - started
  assert.equal(out.timed, true)
  assert.ok(elapsed < 5_000, `runBytes must bound the call like run(): ${elapsed}ms`)
})

test('brief never returns an empty message', () => {
  // A child killed by a signal writes nothing, so the old brief() returned ''
  // and every `throw new Error(brief(out))` produced "android_install_app: ".
  const empty = { cmd: ['adb', 'install'], code: 1, stdout: '', stderr: '', timed: false }
  assert.notEqual(brief(empty).trim(), '')
  assert.match(brief(empty), /exited with code 1/)
  assert.match(brief({ ...empty, timed: true }), /timed out/)
  assert.match(brief({ ...empty, code: 137 }), /signal 9/)
  assert.match(brief({ ...empty, code: 127 }), /could not be started/)
})

test('brief still prefers real output when there is any', () => {
  const withOutput = { cmd: ['adb'], code: 1, stdout: 'boom', stderr: '', timed: false }
  assert.equal(brief(withOutput), 'boom')
})

test('callTimeoutMs converts seconds and refuses a non-positive override', () => {
  assert.equal(callTimeoutMs(undefined, 3), 3_000)
  assert.equal(callTimeoutMs(250, 3), 250)
  assert.throws(() => callTimeoutMs(0, 3), /Invalid timeoutMs: 0/)
  assert.throws(() => callTimeoutMs(-1, 3), /Invalid timeoutMs: -1/)
  assert.throws(() => callTimeoutMs(Number.NaN, 3), /Invalid timeoutMs/)
  assert.throws(() => callTimeoutMs(Number.POSITIVE_INFINITY, 3), /Invalid timeoutMs/)
})
