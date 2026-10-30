import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRuntime } from '../lib/runtime.js'
import { logs } from '../lib/providers/logs.js'
import { terminate } from '../lib/providers/app.js'
import { writeFakeTool } from './helpers/fake-tool.mjs'

/**
 * Logcat and app-lifecycle behaviour, pinned without a device.
 *
 * The log filter and the terminate check both used to answer from a signal that
 * cannot carry the answer: `android_logs({applicationId})` matched the app id
 * as text in a `-v time` tail — where an app's own lines never repeat it — and
 * `android_terminate_app` trusted `am force-stop`, which exits 0 for a package
 * that is not installed. These tests drive the real providers through a fake
 * `adb` on `PATH` and assert both the result and the exact device command, so
 * the fix cannot regress into "it returned something".
 *
 * `helpers/fake-tool.mjs` renders the fake once for both platforms, and the
 * runtime pins `sdkPath` and `ANDROID_AVD_HOME` for the reasons that helper's
 * other users document: a developer's own SDK and AVDs must not leak in.
 */

/** A healthy USB-attached device; a USB serial skips the emulator boot poll. */
const USB_DEVICE =
  'R58M12ABCDE           device usb:336592896X product:oriole model:Pixel_6 device:oriole transport_id:2'

/** The default `adb devices -l` transcript: one healthy USB device. */
const READY_DEVICES = ['List of devices attached', USB_DEVICE, ''].join('\n')

/** A logcat `-v time` line written by the app under test (PID 100). */
const APP_STARTED = '10-30 11:00:00.000 I/com.example.app( 100): started'

/** A logcat line from an unrelated service (PID 101). */
const OTHER_CHATTER = '10-30 11:00:01.000 I/other.service( 101): unrelated chatter'

/** A second line written by the app under test. */
const APP_STOPPED = '10-30 11:00:02.000 I/com.example.app( 100): stopped'

/** The whole tail the fake device publishes. */
const LOGCAT = [APP_STARTED, OTHER_CHATTER, APP_STOPPED].join('\n') + '\n'

/** What the fake publishes for a `--pid`-filtered read. */
const APP_LOGS = [APP_STARTED, APP_STOPPED].join('\n') + '\n'

/** One long chatter line, used to exercise the rendered-output ceiling. */
const LONG_LINE = '10-30 11:00:00.000 I/chatty.service( 200): ' + 'x'.repeat(120)

/** More than the 200000-character ceiling, so the clamp is observable. */
const LONG_LOGS = Array.from({ length: 1400 }, () => LONG_LINE).join('\n') + '\n'

/**
 * Install a fake `adb` that answers the calls the log and app providers make.
 *
 * The transcript files are the knobs: `pids` decides whether `pidof` names a
 * running process, `appLogcat` is what a `--pid`-filtered read prints,
 * `packages` is what `pm list packages` prints, and `pidUnsupported` makes a
 * `--pid` read fail the way an old `logcat` does.
 *
 * @param {{devices?: string, logcat?: string, appLogcat?: string, pids?: string, packages?: string, pidUnsupported?: boolean}} [options]
 *   - the transcripts the fake serves.
 * @returns {Promise<{rt: object, stateDir: string, argv: () => Promise<string[]>}>} the harness.
 */
async function fakeAdb(options = {}) {
  const binDir = await mkdtemp(path.join(tmpdir(), 'aemh-la-bin-'))
  const stateDir = await mkdtemp(path.join(tmpdir(), 'aemh-la-state-'))
  const dataDir = await mkdtemp(path.join(tmpdir(), 'aemh-la-data-'))
  const state = (name) => path.join(stateDir, name)
  await writeFile(state('devices.txt'), options.devices ?? READY_DEVICES, 'utf8')
  await writeFile(state('logcat.txt'), options.logcat ?? '', 'utf8')
  await writeFile(state('logcat-app.txt'), options.appLogcat ?? options.logcat ?? '', 'utf8')
  if (options.pids !== undefined) await writeFile(state('pids.txt'), options.pids, 'utf8')
  if (options.packages !== undefined) await writeFile(state('packages.txt'), options.packages, 'utf8')
  if (options.pidUnsupported === true) await writeFile(state('pid-unsupported'), '', 'utf8')

  await writeFakeTool(binDir, 'adb', [
    { record: state('argv.log') },
    // `adb -s <serial> devices -l`: the handshake every device tool makes.
    { ifSub: 'devices', then: [{ cat: state('devices.txt') }, { exit: 0 }] },
    {
      ifSub: 'shell',
      then: [
        { ifRest: { pattern: 'getprop sys.boot_completed' }, then: [{ out: '1' }, { exit: 0 }] },
        {
          // `pidof` exits non-zero when nothing matches; a missing transcript
          // file is the fake's way of saying "no running process".
          ifRest: { pattern: 'pidof *' },
          then: [{ ifFile: state('pids.txt'), then: [{ cat: state('pids.txt') }, { exit: 0 }] }, { exit: 1 }],
        },
        { ifRest: { pattern: 'pm list packages*' }, then: [{ cat: state('packages.txt') }, { exit: 0 }] },
        { ifRest: { pattern: 'am force-stop *' }, then: [{ exit: 0 }] },
        { exit: 0 },
      ],
    },
    {
      ifSub: 'logcat',
      then: [
        {
          // `logcat -d --pid=...`: the device-side PID filter.
          ifArgPrefix: [5, '--pid='],
          then: [
            { ifFile: state('pid-unsupported'), then: [{ err: 'logcat: unrecognized option --pid' }, { exit: 1 }] },
            { cat: state('logcat-app.txt') },
            { exit: 0 },
          ],
        },
        { cat: state('logcat.txt') },
        { exit: 0 },
      ],
    },
    { exit: 0 },
  ])

  const rt = createRuntime({
    config: {
      dataDir: { get: () => dataDir },
      bootTimeoutSeconds: { get: () => 5 },
      // The plugin discovers the Android SDK on its own, including by scanning
      // the drive roots; a configured empty root makes it fall back to `PATH`,
      // which is where the fake lives.
      sdkPath: { get: () => dataDir },
    },
    exec: undefined,
    logger: { info() {}, warn() {}, error() {} },
    env: {
      ...process.env,
      PATH: [binDir, process.env.PATH].filter(Boolean).join(path.delimiter),
      ANDROID_AVD_HOME: path.join(dataDir, 'avd'),
    },
  })
  return {
    rt,
    stateDir,
    argv: async () => {
      const text = await readFile(path.join(stateDir, 'argv.log'), 'utf8').catch(() => '')
      return text
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => `ARGV ${line.split('|').slice(0, -1).map((argument) => `[${argument}]`).join(' ')}`)
    },
  }
}

/*
 * ---------------------------------------------------------------------------
 * B1: the applicationId filter works from the PID, not from the line text
 * ---------------------------------------------------------------------------
 */

test('applicationId reads the app lines by PID, and reports both line counts', async () => {
  const { rt, argv } = await fakeAdb({
    pids: '100\n',
    logcat: LOGCAT,
    appLogcat: APP_LOGS,
  })
  const result = await logs(rt, { serial: 'R58M12ABCDE', applicationId: 'com.example.app', lines: 40 })
  assert.equal(result.applicationId, 'com.example.app')
  // `lines` is the tail the caller asked for; `returnedLines` is what the
  // result actually carries. A caller that asked for 40 and got 2 needs both.
  assert.equal(result.lines, 40)
  assert.equal(result.returnedLines, 2)
  // The PID path does not post-filter: the device already answered with the
  // app's own lines, which is why the app's text does not have to name it.
  assert.equal(result.filter, 'pid')
  assert.deepEqual(result.pids, [100])
  assert.equal(result.output, APP_LOGS)
  assert.equal(result.note, undefined)

  const calls = await argv()
  const pidofAt = calls.findIndex((line) => line.includes('[pidof com.example.app]'))
  const logcatAt = calls.findIndex((line) => line.includes('[logcat]'))
  assert.ok(pidofAt >= 0, 'the PID has to be asked for')
  assert.ok(logcatAt > pidofAt, 'the logcat read must be filtered by the PID found first')
  // The exact device command matters: `--pid` is what makes the device filter.
  assert.equal(
    calls[logcatAt],
    'ARGV [-s] [R58M12ABCDE] [logcat] [-d] [--pid=100] [-v] [time] [-t] [40]',
  )
})

test('every process of one app is included in the PID filter', async () => {
  const { rt, argv } = await fakeAdb({ pids: '100 101\n', logcat: LOGCAT, appLogcat: APP_LOGS })
  const result = await logs(rt, { serial: 'R58M12ABCDE', applicationId: 'com.example.app' })
  assert.deepEqual(result.pids, [100, 101])
  assert.ok(
    (await argv()).some((line) => line.includes('[--pid=100,101]')),
    'a multi-process app must be read as one set of PIDs',
  )
})

test('a stopped app is reported honestly and the tail falls back to text matching', async () => {
  // No `pids.txt`: `pidof` exits 1, which is what a stopped app looks like.
  const { rt } = await fakeAdb({ logcat: LOGCAT })
  const result = await logs(rt, { serial: 'R58M12ABCDE', applicationId: 'com.example.app' })
  assert.equal(result.filter, 'text')
  assert.deepEqual(result.pids, [])
  // The fallback must not read as a PID-filtered success: the note says the
  // app was not running and that the text match misses some of its lines.
  assert.match(result.note, /pidof reported no running process for com\.example\.app/)
  assert.match(result.note, /misses the app lines which do not name it/)
  assert.equal(result.output, [APP_STARTED, APP_STOPPED].join('\n'))
  assert.equal(result.returnedLines, 2)
})

test('a device that rejects logcat --pid is filtered by the PID column instead', async () => {
  const { rt } = await fakeAdb({ pids: '100\n', logcat: LOGCAT, pidUnsupported: true })
  const result = await logs(rt, { serial: 'R58M12ABCDE', applicationId: 'com.example.app' })
  assert.equal(result.filter, 'pid-column')
  assert.deepEqual(result.pids, [100])
  assert.match(result.note, /PID column/)
  assert.equal(result.output, [APP_STARTED, APP_STOPPED].join('\n'))
  assert.equal(result.returnedLines, 2)
})

test('an invalid application id is refused before the device is queried for a PID', async () => {
  const { rt, argv } = await fakeAdb({ logcat: LOGCAT })
  await assert.rejects(
    () => logs(rt, { serial: 'R58M12ABCDE', applicationId: 'not a package' }),
    /Invalid Android application id/,
  )
  const calls = await argv()
  assert.equal(calls.some((line) => line.includes('pidof') || line.includes('logcat')), false)
})

/*
 * ---------------------------------------------------------------------------
 * B6: the rendered-output ceiling cannot be switched off
 * ---------------------------------------------------------------------------
 */

test('a non-positive limit falls back to the default ceiling instead of disabling it', async () => {
  const { rt } = await fakeAdb({ logcat: LONG_LOGS })
  const expected = `${LONG_LOGS.slice(0, 20_000)}\n...[truncated ${LONG_LOGS.length - 20_000} characters]`
  // `0` and `-1` are what a caller sends when it means "no limit"; they used to
  // pass through to a truncator that returned the whole, unbounded tail.
  for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = await logs(rt, { serial: 'R58M12ABCDE', limit })
    assert.equal(result.output, expected, `limit ${limit} must fall back to 20000`)
  }
})

test('a large limit is raised to the documented ceiling, not honoured literally', async () => {
  const { rt } = await fakeAdb({ logcat: LONG_LOGS })
  assert.ok(LONG_LOGS.length > 200_000, 'the fixture has to exceed the ceiling')
  const result = await logs(rt, { serial: 'R58M12ABCDE', limit: 5_000_000 })
  assert.equal(
    result.output,
    `${LONG_LOGS.slice(0, 200_000)}\n...[truncated ${LONG_LOGS.length - 200_000} characters]`,
  )
})

test('a positive limit still caps the rendered output exactly', async () => {
  const { rt } = await fakeAdb({ logcat: LONG_LOGS })
  const result = await logs(rt, { serial: 'R58M12ABCDE', limit: 100 })
  assert.equal(result.output, `${LONG_LOGS.slice(0, 100)}\n...[truncated ${LONG_LOGS.length - 100} characters]`)
})

/*
 * ---------------------------------------------------------------------------
 * B5: terminate refuses a package that is not installed
 * ---------------------------------------------------------------------------
 */

test('terminate force-stops an installed package and reports the device command', async () => {
  const { rt, argv } = await fakeAdb({
    packages: 'package:com.example.app\npackage:com.example.application\n',
  })
  const report = await terminate(rt, { serial: 'R58M12ABCDE', applicationId: 'com.example.app' })
  assert.deepEqual(report, { terminated: true, serial: 'R58M12ABCDE', applicationId: 'com.example.app' })
  const calls = await argv()
  assert.ok(calls.some((line) => line.includes('[pm list packages com.example.app]')))
  assert.ok(calls.some((line) => line.includes('[am force-stop com.example.app]')))
})

test('terminate refuses a package the device does not have', async () => {
  // `pm list packages com.example.app` is a substring filter, so a longer id
  // with the requested id as its prefix is a real answer here — and it must
  // not be read as "installed".
  const { rt, argv } = await fakeAdb({ packages: 'package:com.example.application\n' })
  await assert.rejects(
    () => terminate(rt, { serial: 'R58M12ABCDE', applicationId: 'com.example.app' }),
    /Android application is not installed on R58M12ABCDE: com\.example\.app/,
  )
  const calls = await argv()
  assert.ok(calls.some((line) => line.includes('[pm list packages com.example.app]')))
  assert.equal(calls.some((line) => line.includes('[am force-stop')), false, 'a missing package must not reach am force-stop')
})
