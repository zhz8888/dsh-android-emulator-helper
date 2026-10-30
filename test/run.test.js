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
 * The PowerShell this host can actually start: `pwsh` when installed, else
 * `powershell`.
 *
 * `pwsh` is PowerShell 7, which ships as a separate download; a stock Windows
 * 10/11 install only carries `powershell.exe` in
 * `System32\WindowsPowerShell\v1.0`. Naming `pwsh` unconditionally made every
 * test that shells out fail with exit code 127 on those machines — a failure
 * that says nothing about the code under test and looks unrelated to the cause.
 * The probe is exported so the fallback can be pinned without a machine that
 * lacks PowerShell 7, and `fake-tool.mjs` already resolves it the same way
 * (`where pwsh` else `powershell`).
 *
 * @param {{platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv, exists?: (candidate: string) => boolean}} [options]
 *   - the host to probe; every field is injectable for the test below.
 * @returns {'pwsh' | 'powershell' | undefined} the program, or undefined off Windows.
 */
export function powershellProgram({ platform = process.platform, env = process.env, exists = existsSync } = {}) {
  if (platform !== 'win32') return undefined
  const extensions = (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter((item) => item.length > 0)
  for (const directory of (env.PATH ?? '').split(path.delimiter)) {
    if (directory.length === 0) continue
    for (const extension of extensions) {
      if (exists(path.join(directory, `pwsh${extension}`))) return 'pwsh'
    }
    if (exists(path.join(directory, 'pwsh'))) return 'pwsh'
  }
  return 'powershell'
}

/**
 * The argv that runs `command` in this platform's shell.
 *
 * The two portable cases below only need a process that prints bytes and one
 * that exits without reading stdin; neither depends on POSIX signals, so on
 * Windows the same behaviour is expressed in PowerShell.
 *
 * @param {string} command - the script to run.
 * @returns {string[]} the argv.
 */
function shell(command) {
  if (process.platform !== 'win32') return ['/bin/sh', '-c', command]
  return [powershellProgram(), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]
}

test('the Windows shell falls back to powershell.exe when PowerShell 7 is absent', () => {
  // A stock Windows has `powershell.exe` and no `pwsh`: the probe must not
  // depend on a program the host was never guaranteed to have.
  const onlyWindowsPowerShell = (candidate) => candidate.toLowerCase().endsWith('powershell.exe')
  assert.equal(
    powershellProgram({
      platform: 'win32',
      env: { PATH: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0', PATHEXT: '.EXE;.CMD' },
      exists: onlyWindowsPowerShell,
    }),
    'powershell',
  )
  const onlyPowerShell7 = (candidate) => candidate.toLowerCase().endsWith('pwsh.exe')
  assert.equal(
    powershellProgram({
      platform: 'win32',
      env: { PATH: 'C:\\Program Files\\PowerShell\\7', PATHEXT: '.EXE' },
      exists: onlyPowerShell7,
    }),
    'pwsh',
  )
  // Off Windows the probe has no answer: the shell is `/bin/sh`.
  assert.equal(powershellProgram({ platform: 'linux', env: { PATH: '/usr/bin' }, exists: () => true }), undefined)
})

test('the platform shell these tests use can actually start', async () => {
  // This is the regression: with `pwsh` hardcoded, a stock Windows host failed
  // here with exit code 127 — `could not be started` — before any assertion
  // about the child-process helper ran.
  const out = await run(shell('exit 0'), { timeout: 20_000 })
  assert.equal(out.code, 0, `the shell this file uses must start: ${out.stderr}`)
})

/** A script that writes the eight PNG signature bytes on stdout. */
const PRINT_PNG = POSIX
  ? "printf '\\211PNG\\r\\n\\032\\n'"
  : '[Console]::OpenStandardOutput().Write([byte[]]@(137,80,78,71,13,10,26,10),0,8)'

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
  const out = await runBytes(shell(PRINT_PNG))
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
