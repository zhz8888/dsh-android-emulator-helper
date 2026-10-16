import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRuntime } from '../lib/runtime.js'
import { startEmulator } from '../lib/providers/avd.js'

/**
 * Emulator startup failure reporting, tested hermetically.
 *
 * A fake `emulator` on `PATH` is enough to drive the whole path: discovery,
 * spawn, output capture, early-exit detection and the error message. This is
 * the behaviour the original plugin could not offer — it discarded the
 * emulator's output, so every startup failure looked like an unexplained boot
 * timeout.
 */

/** Create an executable fake `emulator` that lists one AVD, then fails on start. */
async function fakeEmulator() {
  const dir = await mkdtemp(path.join(tmpdir(), 'aemh-fake-'))
  const file = path.join(dir, 'emulator')
  await writeFile(
    file,
    [
      '#!/bin/sh',
      'if [ "$1" = "-list-avds" ]; then',
      '  echo Fake_AVD',
      '  exit 0',
      'fi',
      'echo "INFO  | starting"',
      'echo "FATAL | fake snapshot failure"',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  )
  await chmod(file, 0o755)
  return dir
}

/** A runtime whose PATH only sees the fake toolchain. */
async function fakeRuntime() {
  const binDir = await fakeEmulator()
  const dataDir = await mkdtemp(path.join(tmpdir(), 'aemh-data-'))
  const config = {
    dataDir: { get: () => dataDir },
    bootTimeoutMs: { get: () => 20_000 },
  }
  const rt = createRuntime({
    config,
    exec: undefined,
    logger: { info() {}, warn() {}, error() {} },
    env: { ...process.env, PATH: `${binDir}:/usr/bin:/bin`, ANDROID_PLUGIN_DEFAULT_AVD: 'Fake_AVD' },
  })
  return { rt, dataDir }
}

test('an emulator that exits during startup reports its own output, not a timeout', { skip: process.platform === 'win32' }, async () => {
  const { rt } = await fakeRuntime()
  const error = await startEmulator(rt, {}).then(
    () => undefined,
    (thrown) => thrown,
  )
  assert.ok(error instanceof Error, 'starting a failing emulator must reject')
  assert.match(error.message, /exited during startup/)
  assert.match(error.message, /exit code 1/)
  assert.match(error.message, /Log: /)
  // The tail of the emulator's own log is what makes the failure actionable.
  assert.match(error.message, /FATAL \| fake snapshot failure/)
})

test('the emulator transcript is kept on disk under the data directory', { skip: process.platform === 'win32' }, async () => {
  const { rt, dataDir } = await fakeRuntime()
  await startEmulator(rt, {}).catch(() => {})
  const { readdir, readFile } = await import('node:fs/promises')
  const entries = await readdir(path.join(dataDir, 'logs'))
  const logs = entries.filter((name) => name.endsWith('-emulator-Fake_AVD.log'))
  assert.equal(logs.length, 1, 'exactly one transcript per start attempt')
  const text = await readFile(path.join(dataDir, 'logs', logs[0]), 'utf8')
  assert.match(text, /FATAL \| fake snapshot failure/)
})

test('the configured emulator arguments are passed through to the binary', { skip: process.platform === 'win32' }, async () => {
  const binDir = await mkdtemp(path.join(tmpdir(), 'aemh-args-'))
  const argvFile = path.join(binDir, 'argv.txt')
  const file = path.join(binDir, 'emulator')
  await writeFile(
    file,
    [
      '#!/bin/sh',
      'if [ "$1" = "-list-avds" ]; then echo Fake_AVD; exit 0; fi',
      `printf '%s\\n' "$@" > ${JSON.stringify(argvFile)}`,
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  )
  await chmod(file, 0o755)
  const dataDir = await mkdtemp(path.join(tmpdir(), 'aemh-data-'))
  const rt = createRuntime({
    config: {
      dataDir: { get: () => dataDir },
      emulatorArgs: { get: () => '-no-snapshot-load\n# a comment\n-gpu swiftshader_indirect' },
      bootTimeoutMs: { get: () => 20_000 },
    },
    exec: undefined,
    logger: { info() {}, warn() {}, error() {} },
    env: { ...process.env, PATH: `${binDir}:/usr/bin:/bin`, ANDROID_PLUGIN_DEFAULT_AVD: 'Fake_AVD' },
  })
  await startEmulator(rt, {}).catch(() => {})
  const { readFile } = await import('node:fs/promises')
  const argv = (await readFile(argvFile, 'utf8')).trim().split('\n')
  assert.deepEqual(argv, ['-avd', 'Fake_AVD', '-no-snapshot-load', '-gpu swiftshader_indirect'])
})
