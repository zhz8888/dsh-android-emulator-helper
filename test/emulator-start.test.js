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
 * A fake `emulator` and a fake `adb` on `PATH` drive the whole path: discovery,
 * spawn, output capture, early-exit detection, the boot poll and the error
 * message. This is the behaviour the original plugin could not offer — it
 * discarded the emulator's output, so every startup failure looked like an
 * unexplained boot timeout.
 *
 * The fake is rendered for the host by `helpers/fake-tool.mjs`: a shell script
 * on POSIX, a Node step script behind a `.cmd` launcher on Windows, so the
 * same contracts are pinned on both.
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
 * Every runtime pins a healthy, empty `adb` unless the case asks for another
 * one: the boot wait can only observe a start through `adb devices`, so a
 * machine with no adb (or with a real one on `PATH`) must not decide how these
 * tests behave. The broken-adb case below supplies its own fake.
 *
 * @param {{binDir?: string, config?: object, adb?: object[]}} [options] - extra live settings, the fake to use, or a directory already prepared.
 * @returns {Promise<{rt: object, binDir: string, dataDir: string}>} the runtime and its directories.
 */
async function fakeRuntime({ binDir, config = {}, adb } = {}) {
  const bin = binDir ?? (await mkdtemp(path.join(tmpdir(), 'aemh-fake-')))
  const dataDir = await mkdtemp(path.join(tmpdir(), 'aemh-data-'))
  if (binDir === undefined) await fakeEmulator(bin)
  await writeFakeTool(
    bin,
    'adb',
    adb ?? [
      { ifSub: 'devices', then: [{ out: 'List of devices attached' }, { exit: 0 }] },
      { exit: 1 },
    ],
  )
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
      // `listAvds` reads the AVD directory too, so the home is pinned: the
      // developer's own AVDs must not join the fake emulator's list.
      ANDROID_AVD_HOME: path.join(dataDir, 'avd'),
    },
  })
  return { rt, binDir: bin, dataDir }
}

/**
 * Read a pid file a fake wrote, waiting briefly for it to appear.
 *
 * @param {string} file - the pid file.
 * @returns {Promise<number>} the pid, or 0 when the fake never wrote one.
 */
async function readPid(file) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const pid = Number((await readFile(file, 'utf8').catch(() => '')).trim())
    if (Number.isInteger(pid) && pid > 0) return pid
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return 0
}

/**
 * Whether a pid is still alive.
 *
 * @param {number} pid - the process id.
 * @returns {boolean} true when the process exists.
 */
function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Wait until a pid is gone.
 *
 * @param {number} pid - the process id.
 * @param {number} timeoutMs - how long to wait.
 * @returns {Promise<boolean>} whether the process disappeared.
 */
async function waitForGone(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!alive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return !alive(pid)
}

/**
 * Kill whatever a fake emulator recorded, so a failed assertion cannot leak it.
 *
 * @param {string} file - the pid file.
 * @returns {Promise<void>} resolves when the cleanup was attempted.
 */
async function killRecordedPid(file) {
  const pid = await readPid(file)
  if (pid <= 0) return
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // The plugin's own teardown had already stopped it.
  }
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

test('an AVD name is sanitised before it becomes the transcript file name', async () => {
  // An AVD name may carry a space (`emulator -avd` accepts it), and the log is
  // named after the AVD. The component therefore goes through the same
  // filesystem-safe reduction the screenshot provider uses, so a name can never
  // decide that the log write fails and the start reports the wrong error.
  const binDir = await mkdtemp(path.join(tmpdir(), 'aemh-name-'))
  await writeFakeTool(binDir, 'emulator', [
    { ifSub: '-list-avds', then: [{ out: 'Fake AVD' }, { exit: 0 }] },
    { out: 'FATAL | fake snapshot failure' },
    { exit: 1 },
  ])
  const { rt, dataDir } = await fakeRuntime({ binDir })
  await startEmulator(rt, {}).catch(() => {})
  const entries = await readdir(path.join(dataDir, 'logs'))
  assert.equal(entries.length, 1, 'exactly one transcript per start attempt')
  assert.match(entries[0], /-emulator-Fake_AVD\.log$/)
  assert.doesNotMatch(entries[0], / /)
})

test('a broken adb is reported before an emulator is spawned', async () => {
  // The defect: `listDevices(...).catch(() => [])` read "cannot ask adb" as
  // "no devices yet", so a host with the emulator package but no working adb
  // burned the whole boot timeout and then blamed the boot — while the
  // emulator it had started was still running. The failure is adb's, and it is
  // known before the first process is started.
  const binDir = await mkdtemp(path.join(tmpdir(), 'aemh-badadb-'))
  const spawnArgv = path.join(binDir, 'emulator-argv.txt')
  await writeFakeTool(binDir, 'emulator', [
    { ifSub: '-list-avds', then: [{ out: 'Fake_AVD' }, { exit: 0 }] },
    { record: spawnArgv },
    { exit: 0 },
  ])
  const { rt } = await fakeRuntime({
    binDir,
    adb: [{ err: 'error: adb server is out of date. killing...' }, { exit: 1 }],
  })
  const error = await startEmulator(rt, {}).then(
    () => undefined,
    (thrown) => thrown,
  )
  assert.ok(error instanceof Error, 'a start whose boot can never be observed must reject')
  assert.match(error.message, /adb server is out of date/)
  assert.doesNotMatch(error.message, /boot deadline/)
  const spawned = await readFile(spawnArgv, 'utf8').catch(() => '')
  assert.equal(spawned, '', 'no emulator may be started when its boot cannot be observed')
})

test('an adb failure during the boot wait is carried into the timeout error', { timeout: 20_000 }, async () => {
  // adb answers the pre-start device list, then dies once the emulator is up.
  // The wait cannot observe the boot any more, so the timeout must say that
  // instead of reporting a boot deadline that never had a chance.
  const binDir = await mkdtemp(path.join(tmpdir(), 'aemh-adbwait-'))
  const brokenFlag = path.join(binDir, 'adb-broken')
  const pidFile = path.join(binDir, 'emulator.pid')
  const { rt } = await fakeRuntime({
    binDir,
    config: { bootTimeoutSeconds: { get: () => 3 } },
    adb: [
      {
        ifSub: 'devices',
        then: [
          { ifFile: brokenFlag, then: [{ err: 'error: adb server died' }, { exit: 1 }] },
          { out: 'List of devices attached' },
          { exit: 0 },
        ],
      },
      { exit: 1 },
    ],
  })
  await writeFakeTool(binDir, 'emulator', [
    { ifSub: '-list-avds', then: [{ out: 'Fake_AVD' }, { exit: 0 }] },
    { pidTo: pidFile },
    { write: [brokenFlag, ''] },
    { sleep: 60 },
  ])
  try {
    await assert.rejects(
      () => startEmulator(rt, {}),
      (error) => {
        assert.match(error.message, /Emulator boot deadline reached/)
        assert.match(error.message, /adb server died/, 'the real cause must be carried verbatim')
        assert.match(error.message, /was terminated/, 'the started emulator must not be left running')
        return true
      },
    )
  } finally {
    await killRecordedPid(pidFile)
  }
})

test('a failing boot probe during the wait is carried into the timeout error', { timeout: 20_000 }, async () => {
  // `isBootComplete` answers "not ready" for a failed `adb shell`, which is the
  // right answer for a target that is already running and nowhere near a boot
  // deadline. In a start, the boot probe is the only observation of the process
  // this call launched: a probe that keeps failing will never turn into a
  // booted device, so the timeout has to name it.
  const binDir = await mkdtemp(path.join(tmpdir(), 'aemh-getprop-'))
  const startedFlag = path.join(binDir, 'started')
  const pidFile = path.join(binDir, 'emulator.pid')
  const readyLine = 'emulator-5559          device product:sdk model:sdk device:emu transport_id:1'
  const { rt } = await fakeRuntime({
    binDir,
    config: { bootTimeoutSeconds: { get: () => 3 } },
    adb: [
      {
        ifSub: 'devices',
        then: [
          { out: 'List of devices attached' },
          { ifFile: startedFlag, then: [{ out: readyLine }] },
          { exit: 0 },
        ],
      },
      {
        ifArg: [3, 'shell'],
        then: [{ ifArgPrefix: [4, 'getprop'], then: [{ err: 'error: device offline' }, { exit: 1 }] }],
      },
      { exit: 1 },
    ],
  })
  await writeFakeTool(binDir, 'emulator', [
    { ifSub: '-list-avds', then: [{ out: 'Fake_AVD' }, { exit: 0 }] },
    { pidTo: pidFile },
    { write: [startedFlag, ''] },
    { sleep: 60 },
  ])
  try {
    await assert.rejects(
      () => startEmulator(rt, {}),
      (error) => {
        assert.match(error.message, /Emulator boot deadline reached/)
        assert.match(error.message, /device offline/, 'the failed probe must be carried verbatim')
        assert.match(error.message, /was terminated/)
        return true
      },
    )
  } finally {
    await killRecordedPid(pidFile)
  }
})

test('a timed-out start kills the wrapped emulator, not just its launcher', { skip: process.platform !== 'win32', timeout: 30_000 }, async () => {
  // A Windows `emulator.cmd` is started through cmd.exe, so the process the
  // plugin holds is the launcher and the emulator is a grandchild.
  // `child.kill()` reached only cmd.exe, leaving the emulator running and
  // holding the AVD, while the caller was told the start had been given up on.
  const binDir = await mkdtemp(path.join(tmpdir(), 'aemh-tree-'))
  const pidFile = path.join(binDir, 'emulator.pid')
  await writeFakeTool(binDir, 'emulator', [
    { ifSub: '-list-avds', then: [{ out: 'Fake_AVD' }, { exit: 0 }] },
    { pidTo: pidFile },
    { sleep: 60 },
  ])
  const { rt } = await fakeRuntime({ binDir, config: { bootTimeoutSeconds: { get: () => 1 } } })
  try {
    await assert.rejects(() => startEmulator(rt, {}), /was terminated/)
    const pid = await readPid(pidFile)
    assert.ok(pid > 0, 'the fake emulator must report its pid')
    assert.equal(await waitForGone(pid, 10_000), true, 'the emulator behind the launcher must be terminated')
  } finally {
    await killRecordedPid(pidFile)
  }
})
