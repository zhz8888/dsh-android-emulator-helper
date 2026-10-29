import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRuntime } from '../lib/runtime.js'
import { startEmulator } from '../lib/providers/avd.js'
import { writeFakeTool } from './helpers/fake-tool.mjs'

/**
 * Emulator startup failure reporting, tested hermetically.
 *
 * A fake `emulator` on `PATH` is enough to drive the whole path: discovery,
 * spawn, output capture, early-exit detection and the error message. This is
 * the behaviour the original plugin could not offer — it discarded the
 * emulator's output, so every startup failure looked like an unexplained boot
 * timeout.
 *
 * The fake is rendered for the host by `helpers/fake-tool.mjs`: a shell script
 * on POSIX, a PowerShell script behind a `.cmd` launcher on Windows, so the
 * same three contracts are pinned on both.
 */

/**
 * Create a fake `emulator` that lists one AVD, then fails on start.
 *
 * @param {string} binDir - the directory to put it on `PATH` from.
 * @returns {Promise<void>} resolves when the fake is on disk.
 */
async function fakeEmulator(binDir) {
  await writeFakeTool(binDir, 'emulator', [
    { ifSub: '-list-avds', then: [{ out: 'Fake_AVD' }, { exit: 0 }] },
    { out: 'INFO  | starting' },
    { out: 'FATAL | fake snapshot failure' },
    { exit: 1 },
  ])
}

/**
 * A runtime whose `PATH` sees the fake toolchain.
 *
 * @param {object} [config] - extra live settings.
 * @returns {Promise<{rt: object, binDir: string, dataDir: string}>} the runtime and its directories.
 */
async function fakeRuntime({ binDir, config = {} } = {}) {
  const bin = binDir ?? (await mkdtemp(path.join(tmpdir(), 'aemh-fake-')))
  const dataDir = await mkdtemp(path.join(tmpdir(), 'aemh-data-'))
  if (binDir === undefined) await fakeEmulator(bin)
  const rt = createRuntime({
    config: {
      dataDir: { get: () => dataDir },
      bootTimeoutSeconds: { get: () => 20 },
      // The plugin discovers the Android SDK on its own — including by scanning
      // the drive roots — so a host that has one installed would otherwise run
      // the real emulator instead of this fake. A configured root is
      // authoritative: point it at a directory that holds no tools.
      sdkPath: { get: () => dataDir },
      ...config,
    },
    exec: undefined,
    logger: { info() {}, warn() {}, error() {} },
    env: {
      ...process.env,
      PATH: [bin, process.env.PATH].filter(Boolean).join(path.delimiter),
      ANDROID_PLUGIN_DEFAULT_AVD: 'Fake_AVD',
    },
  })
  return { rt, binDir: bin, dataDir }
}

test('an emulator that exits during startup reports its own output, not a timeout', async () => {
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

test('the emulator transcript is kept on disk under the data directory', async () => {
  const { rt, dataDir } = await fakeRuntime()
  await startEmulator(rt, {}).catch(() => {})
  const entries = await readdir(path.join(dataDir, 'logs'))
  const logs = entries.filter((name) => name.endsWith('-emulator-Fake_AVD.log'))
  assert.equal(logs.length, 1, 'exactly one transcript per start attempt')
  const text = await readFile(path.join(dataDir, 'logs', logs[0]), 'utf8')
  assert.match(text, /FATAL \| fake snapshot failure/)
})

test('the configured emulator arguments are passed through to the binary', async () => {
  const binDir = await mkdtemp(path.join(tmpdir(), 'aemh-args-'))
  const argvFile = path.join(binDir, 'argv.txt')
  await writeFakeTool(binDir, 'emulator', [
    { ifSub: '-list-avds', then: [{ out: 'Fake_AVD' }, { exit: 0 }] },
    { recordLines: argvFile },
    { exit: 1 },
  ])
  const { rt } = await fakeRuntime({
    binDir,
    config: {
      emulatorArgs: { get: () => '-no-snapshot-load\n# a comment\n-gpu swiftshader_indirect' },
    },
  })
  await startEmulator(rt, {}).catch(() => {})
  const argv = (await readFile(argvFile, 'utf8')).trim().split(/\r?\n/)
  // One settings line is one argument — that is the documented grammar, and it
  // is what lets an argument contain a space without quoting. The trailing
  // `-gpu swiftshader_indirect` line therefore reaches the binary as a single
  // argument, not as two.
  assert.deepEqual(argv, ['-avd', 'Fake_AVD', '-no-snapshot-load', '-gpu swiftshader_indirect'])
})
