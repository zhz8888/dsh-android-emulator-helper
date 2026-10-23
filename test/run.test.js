import assert from 'node:assert/strict'
import { test } from 'node:test'
import { run, runBytes } from '../lib/util/run.js'

/**
 * Child-process hardening for the one helper every provider uses.
 *
 * Two failure modes are invisible in an ordinary regression test: a stream
 * error on `child.stdin` is not an error on the child, and `close` waits for
 * every pipe to drain, so a grandchild that inherited stdout can keep a command
 * pending past its timeout. Both are exercised here with real shells.
 */

const POSIX = process.platform !== 'win32'

test('a child that exits without reading stdin cannot crash the caller', { skip: !POSIX }, async () => {
  // 2 MiB is larger than a pipe buffer; the payload is still queued when the
  // child exits, and the resulting EPIPE is emitted on the stdin stream.
  const out = await run(['/bin/sh', '-c', 'exit 0'], { input: 'x'.repeat(2 * 1024 * 1024) })
  assert.equal(typeof out.code, 'number')
  assert.equal(out.timed, false)
})

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

test('runBytes keeps the raw stdout bytes that run() would decode', { skip: !POSIX }, async () => {
  // `adb exec-out screencap -p` is the reason this exists: decoding a PNG as
  // UTF-8 does not survive the round trip.
  const out = await runBytes(['/bin/sh', '-c', "printf '\\211PNG\\r\\n\\032\\n'"])
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
