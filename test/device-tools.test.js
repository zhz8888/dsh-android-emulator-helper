import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../lib/runtime.js'
import { readSettings, systemImagePackage } from '../lib/settings.js'
import { inside, insideForWrite } from '../lib/util/path.js'
import { parseAdbDevices, pickDevice } from '../lib/providers/device.js'
import { bootTimeoutMs, createAvd, ensureDevice, startEmulator, stopEmulator } from '../lib/providers/avd.js'
import { logs } from '../lib/providers/logs.js'
import { shot } from '../lib/providers/screenshot.js'
import { preflightOk } from '../lib/providers/preflight.js'

/**
 * Device-facing tool behaviour, pinned without a device.
 *
 * Everything asserted here was first observed by driving the real `android_*`
 * tools against a live Pixel_10 emulator (`emulator-5554`, API 37), then
 * reduced to a hermetic test so the contract survives on a machine with no SDK
 * and no emulator. A fake `adb`, `emulator` and `avdmanager` on `PATH` drive the
 * real providers — the technique `emulator-start.test.js` already uses.
 *
 * Three groups are worth calling out because they encode live defects:
 * the preflight verdict, the AVD fallback in `pickAvd`, and the treatment of a
 * newly started emulator that never leaves the `unauthorized` state.
 */

/** The eight PNG signature bytes, as `xxd` showed them for a real capture. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** A logger that says nothing; the providers only ever warn through it. */
const QUIET = { info() {}, warn() {}, error() {} }

/** One `adb devices -l` line for a healthy USB-attached device. */
const USB_DEVICE = 'R58M12ABCDE           device usb:336592896X product:oriole model:Pixel_6 device:oriole transport_id:2'

/** One `adb devices -l` line for a healthy emulator. */
const EMULATOR_DEVICE = 'emulator-5554          device product:sdk model:sdk device:emu transport_id:1'

/**
 * Shell fragment appending one invocation's argv to `file`, as a single
 * `|`-separated record, so a test can assert exactly what a provider spawned.
 *
 * @param {string} file - absolute record path.
 * @returns {string} shell source.
 */
function record(file) {
  return `{ for a in "$@"; do printf '%s|' "$a"; done; printf '\\n'; } >> ${JSON.stringify(file)}`
}

/**
 * Read the argv records {@link record} wrote.
 *
 * @param {string} file - absolute record path.
 * @returns {Promise<string[][]>} one argv per invocation.
 */
async function argvs(file) {
  const text = await readFile(file, 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('|').slice(0, -1))
}

/**
 * The first recorded invocation mentioning `needle`, or undefined.
 *
 * Matching is a substring test per argument because `adb shell` collapses the
 * device command into a single argv element (`"getprop sys.boot_completed"`).
 */
async function argvWith(file, needle) {
  return (await argvs(file)).find((argv) => argv.some((arg) => arg.includes(needle)))
}

/**
 * Build a fake `adb` body.
 *
 * @param {object} options - what the fake answers.
 * @param {string} options.argvFile - where to record invocations.
 * @param {string[]} [options.devices] - device lines listed from the start.
 * @param {string} [options.flag] - marker file whose presence enables `appearing`.
 * @param {string[]} [options.appearing] - device lines listed once `flag` exists.
 * @param {string} [options.boot] - value of `getprop sys.boot_completed`.
 * @param {string} [options.avdName] - answer of `emu avd name`.
 * @param {string[]} [options.logcat] - lines `logcat` prints.
 * @param {boolean} [options.png] - whether `exec-out screencap -p` prints a PNG.
 * @returns {string} shell source.
 */
function adbBody({
  argvFile,
  devices = [],
  flag,
  appearing = [],
  boot = '1',
  avdName,
  logcat = [],
  png,
  screencapPrefix,
  screencapHangs = false,
}) {
  // A prefix models the chatter a multi-display device prints *before* the
  // image, so it implies an image unless the test explicitly opts out.
  const withPng = png ?? screencapPrefix !== undefined
  const out = [record(argvFile), 'if [ "$1" = "devices" ]; then', '  echo "List of devices attached"']
  for (const line of devices) out.push(`  echo ${JSON.stringify(line)}`)
  if (flag !== undefined && appearing.length > 0) {
    out.push(`  if [ -f ${JSON.stringify(flag)} ]; then`)
    for (const line of appearing) out.push(`    echo ${JSON.stringify(line)}`)
    out.push('  fi')
  }
  out.push('  exit 0', 'fi')
  // `adb shell` passes the device command as one argv element, so `$4` is
  // "getprop sys.boot_completed" rather than a bare "getprop".
  out.push(
    'if [ "$3" = "shell" ]; then',
    '  case "$4" in',
    `    getprop*) echo ${JSON.stringify(boot)}; exit 0 ;;`,
    '  esac',
    'fi',
  )
  if (avdName !== undefined) {
    out.push('if [ "$3" = "emu" ]; then', `  echo ${JSON.stringify(avdName)}`, '  echo OK', '  exit 0', 'fi')
  }
  if (logcat.length > 0) {
    out.push('if [ "$3" = "logcat" ]; then')
    for (const line of logcat) out.push(`  echo ${JSON.stringify(line)}`)
    out.push('  exit 0', 'fi')
  }
  if (withPng || screencapPrefix !== undefined || screencapHangs) {
    out.push('if [ "$3" = "exec-out" ]; then')
    if (screencapHangs) {
      // A wedged adb client: the tool must still bound the call.
      out.push('  trap "" TERM', '  while true; do sleep 0.2; done')
    } else {
      if (screencapPrefix !== undefined) out.push(`  printf '%s' ${JSON.stringify(screencapPrefix)}`)
      if (withPng) out.push("  printf '\\211PNG\\r\\n\\032\\n'", "  printf '\\000\\000\\000\\015IHDR'")
    }
    out.push('  exit 0', 'fi')
  }
  out.push('exit 1')
  return out.join('\n')
}

/**
 * Build a runtime whose PATH resolves the SDK tools to fakes, in a throwaway tree.
 *
 * `cwd` is a temp directory rather than the session workspace, so the path
 * tests exercise resolution without writing into the repository. Each fake is
 * declared as a function of this run's paths, so a body can reference the argv
 * record, the spawn marker and the like without string surgery afterwards.
 *
 * @param {{adb?: Function|string, emulator?: Function|string, avdmanager?: Function|string, config?: object, env?: object}} [options] - fakes and overrides.
 * @returns {Promise<{rt: object, paths: object}>} the runtime and its directories.
 */
async function toolchain({ adb, emulator, avdmanager, config = {}, env = {} } = {}) {
  const binDir = await mkdtemp(path.join(tmpdir(), 'aemh-bin-'))
  const workDir = await mkdtemp(path.join(tmpdir(), 'aemh-work-'))
  const paths = {
    workDir,
    binDir,
    argvFile: path.join(workDir, 'adb-argv.txt'),
    spawnArgv: path.join(workDir, 'emulator-argv.txt'),
    spawnFlag: path.join(workDir, 'spawned.flag'),
    pidFile: path.join(workDir, 'emulator.pid'),
    stdinFile: path.join(workDir, 'stdin.txt'),
  }
  for (const [name, body] of Object.entries({ adb, emulator, avdmanager })) {
    if (body === undefined) continue
    const file = path.join(binDir, name)
    await writeFile(file, `#!/bin/sh\n${typeof body === 'function' ? body(paths) : body}\n`, 'utf8')
    await chmod(file, 0o755)
  }
  const rt = createRuntime({
    config: { dataDir: { get: () => path.join(workDir, 'data') }, ...config },
    exec: undefined,
    logger: QUIET,
    cwd: workDir,
    env: { ...process.env, PATH: `${binDir}:/usr/bin:/bin`, ...env },
  })
  return { rt, paths }
}

/** An `adb` with nothing attached — the state after an emulator dies. */
const ADB_EMPTY = (p) =>
  `${record(p.argvFile)}\nif [ "$1" = "devices" ]; then echo "List of devices attached"; exit 0; fi\nexit 1`

// ---------------------------------------------------------------------------
// Session-workspace path policy
// ---------------------------------------------------------------------------

test('a relative path resolves under the session workspace', () => {
  assert.equal(inside('/work/project', 'artifacts/shot.png'), '/work/project/artifacts/shot.png')
  assert.equal(inside('/work/project', 'a/../b.png'), '/work/project/b.png')
  assert.equal(inside('/work/project', '.'), '/work/project')
})

test('an absolute path inside the workspace is accepted', () => {
  assert.equal(inside('/work/project', '/work/project/shot.png'), '/work/project/shot.png')
})

test('an absolute path outside the workspace is refused', () => {
  // Observed live: android_screenshot path=/etc/device-sweeper-evil.png was
  // refused with this exact message, before the capture ran.
  assert.throws(() => inside('/work/project', '/etc/shot.png'), /Path escapes the session workspace: \/etc\/shot\.png/)
})

test('a parent-directory traversal is refused', () => {
  assert.throws(() => inside('/work/project', '../../shot.png'), /escapes the session workspace/)
  assert.throws(() => inside('/work/project', 'a/../../../shot.png'), /escapes the session workspace/)
})

test('a sibling directory sharing the workspace prefix is refused', () => {
  // A bare `startsWith(base)` containment check would let this through.
  assert.throws(() => inside('/work/project', '/work/project-evil/shot.png'), /escapes the session workspace/)
})

test('case-insensitive volumes compare the workspace case-insensitively', { skip: process.platform !== 'darwin' && process.platform !== 'win32' }, () => {
  // The default macOS and Windows volumes treat these as the same directory;
  // a byte-wise prefix test would reject a path the user really opened.
  assert.equal(inside('/work/Project', '/work/project/shot.png'), path.resolve('/work/project/shot.png'))
})

test('a symbolic link inside the workspace cannot carry a write outside', { skip: process.platform === 'win32' }, async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'aemh-ws-'))
  const outside = await mkdtemp(path.join(tmpdir(), 'aemh-out-'))
  try {
    await symlink(outside, path.join(workspace, 'link'), 'dir')
    await assert.rejects(() => insideForWrite(workspace, 'link/escaped.txt'), /symbolic link/)
    assert.equal(await insideForWrite(workspace, 'safe/file.txt'), path.join(workspace, 'safe', 'file.txt'))
    await mkdir(path.join(workspace, 'safe'), { recursive: true })
    await assert.rejects(() => insideForWrite(workspace, 'link'), /symbolic link/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Preflight verdict
// ---------------------------------------------------------------------------

test('a failed Gradle check makes the preflight verdict false', () => {
  // Observed live on this machine (Gradle is not on PATH and the session
  // workspace holds no wrapper): the verdict was false with Gradle ok:false.
  const checks = [
    { name: 'Host OS', ok: true },
    { name: 'Gradle', ok: false },
    { name: 'ADB devices', ok: true },
  ]
  assert.equal(preflightOk(checks, { hasReadyTarget: true }), false)
})

test('emulator-only checks are excused only while a target can still be produced', () => {
  // With a ready target every emulator-only check is moot.
  for (const name of ['emulator', 'avdmanager', 'Android Virtual Devices', 'Emulator acceleration']) {
    assert.equal(preflightOk([{ name, ok: false }], { hasReadyTarget: true }), true, `${name} with a ready target`)
  }
  // Without one they are kept only while the plugin could still start an
  // emulator. A missing emulator binary ends that: there is nothing to start,
  // so no emulator-only check stays optional and the verdict is false.
  for (const name of ['emulator', 'avdmanager', 'Android Virtual Devices', 'Emulator acceleration']) {
    assert.equal(
      preflightOk(
        [
          { name, ok: false },
          { name: 'emulator', ok: false },
          { name: 'ADB devices', ok: false },
        ],
        { hasReadyTarget: false, autoStartEmulator: true },
      ),
      false,
      `${name} without a ready target and no emulator to start`,
    )
  }
  // With the emulator binary present, a secondary emulator tool failing is
  // still excused: the plugin can start a target, which is the whole point.
  assert.equal(
    preflightOk(
      [
        { name: 'avdmanager', ok: false },
        { name: 'emulator', ok: true },
        { name: 'ADB devices', ok: false },
      ],
      { hasReadyTarget: false, autoStartEmulator: true },
    ),
    true,
  )
})

test('a missing device is excused only while the plugin can still start one', () => {
  // The device check is optional because `ensureDevice` starts an emulator on
  // demand — so the exemption must be exactly as wide as that recovery. With
  // `autoStartEmulator` off (or with no emulator binary / no AVD) every
  // device-targeted tool refuses, and "ready" becomes a verdict the caller only
  // discovers is wrong on its first real call.
  const canRecover = [
    { name: 'Gradle', ok: true },
    { name: 'emulator', ok: true },
    { name: 'Android Virtual Devices', ok: true },
    { name: 'ADB devices', ok: false },
  ]
  assert.equal(preflightOk(canRecover, { hasReadyTarget: false, autoStartEmulator: true }), true)
  assert.equal(
    preflightOk(canRecover, { hasReadyTarget: false, autoStartEmulator: false }),
    false,
    'auto-start off must not report ready with no device',
  )
  // No emulator binary and no AVD: there is nothing to auto-start either.
  assert.equal(
    preflightOk(
      [
        { name: 'emulator', ok: false },
        { name: 'Android Virtual Devices', ok: false },
        { name: 'ADB devices', ok: false },
      ],
      { hasReadyTarget: false, autoStartEmulator: true },
    ),
    false,
  )
  // A ready device makes the device check moot, whatever auto-start says.
  assert.equal(
    preflightOk([{ name: 'ADB devices', ok: true }], { hasReadyTarget: true, autoStartEmulator: false }),
    true,
  )
})

test('a host with no AVDs and no devices is still not ready', () => {
  const checks = [
    { name: 'Android Virtual Devices', ok: false },
    { name: 'ADB devices', ok: false },
  ]
  assert.equal(preflightOk(checks, { hasReadyTarget: false }), false)
})

// ---------------------------------------------------------------------------
// Target selection: unauthorized, offline, absent, ambiguous
// ---------------------------------------------------------------------------

test('adb parsing keeps the unauthorized and offline states verbatim', () => {
  const devices = parseAdbDevices(
    ['List of devices attached', 'emulator-5556          unauthorized', 'emulator-5558          offline', ''].join('\n'),
  )
  assert.deepEqual(
    devices.map((item) => [item.serial, item.state]),
    [
      ['emulator-5556', 'unauthorized'],
      ['emulator-5558', 'offline'],
    ],
  )
})

test('an implicit pick ignores unauthorized and offline devices', async () => {
  const { rt } = await toolchain({
    adb: (p) =>
      adbBody({
        argvFile: p.argvFile,
        devices: ['emulator-5556          unauthorized', 'emulator-5558          offline'],
      }),
  })
  await assert.rejects(() => pickDevice(rt, {}), /No ready Android device or emulator found\./)
})

test('an explicit serial in a non-ready state is refused with its state', async () => {
  const { rt } = await toolchain({
    adb: (p) => adbBody({ argvFile: p.argvFile, devices: ['emulator-5556          unauthorized'] }),
  })
  await assert.rejects(() => pickDevice(rt, { serial: 'emulator-5556' }), /not ready: emulator-5556 \(unauthorized\)/)
})

test('an explicit serial that is absent is never retargeted', async () => {
  // The crash-recovery case: the emulator died, so its serial is gone from
  // `adb devices`. Observed live for screenshot, logs and ui_describe — all
  // three failed with this message instead of falling back to another device.
  const { rt } = await toolchain({ adb: ADB_EMPTY })
  await assert.rejects(() => pickDevice(rt, { serial: 'emulator-5556' }), /Android device not found: emulator-5556/)
})

test('a malformed serial is refused before it reaches adb', async () => {
  const { rt } = await toolchain({ adb: 'exit 0' })
  await assert.rejects(() => pickDevice(rt, { serial: 'emulator-5554; rm -rf /' }), /Invalid Android device serial/)
})

test('an implicit pick prefers a ready emulator over a ready USB device', async () => {
  const { rt } = await toolchain({
    adb: (p) => adbBody({ argvFile: p.argvFile, devices: [USB_DEVICE, EMULATOR_DEVICE] }),
  })
  const device = await pickDevice(rt, {})
  assert.equal(device.serial, 'emulator-5554')
  assert.equal(device.kind, 'emulator')
})

test('ensureDevice refuses instead of starting an emulator when autoStartEmulator is off', async () => {
  // The concrete cost of the preflight defect above: the verdict says ready,
  // and the very next device call says nothing is ready.
  const { rt } = await toolchain({
    adb: (p) => adbBody({ argvFile: p.argvFile, devices: ['emulator-5556          unauthorized'] }),
    emulator: 'if [ "$1" = "-list-avds" ]; then echo Pixel_10; exit 0; fi\nexit 1',
    config: { autoStartEmulator: { get: () => false } },
  })
  await assert.rejects(() => ensureDevice(rt, {}), /autoStartEmulator is disabled/)
})

test('the log and screenshot providers surface a vanished serial and capture nothing', async () => {
  for (const [label, call] of [
    ['android_logs', (rt) => logs(rt, { serial: 'emulator-5556' })],
    ['android_screenshot', (rt) => shot(rt, { serial: 'emulator-5556' })],
  ]) {
    const { rt, paths } = await toolchain({ adb: ADB_EMPTY })
    await assert.rejects(() => call(rt), /Android device not found: emulator-5556/, label)
    const invocations = await argvs(paths.argvFile)
    assert.equal(
      invocations.some((argv) => argv.includes('logcat') || argv.includes('exec-out')),
      false,
      `${label} must not reach the device after the target vanished`,
    )
  }
})

// ---------------------------------------------------------------------------
// Logcat: tail size, filtering and the rendering cap
// ---------------------------------------------------------------------------

/** Log lines used below, chosen so the applicationId filter is unambiguous. */
const LOGCAT = [
  '10-17 23:00:00.000 I/com.example.app( 100): started',
  '10-17 23:00:01.000 I/other.service( 101): unrelated chatter',
  '10-17 23:00:02.000 I/com.example.app( 100): stopped',
]

/** A runtime serving {@link LOGCAT} from a healthy USB device. */
async function logsRuntime(config = {}) {
  return toolchain({
    adb: (p) => adbBody({ argvFile: p.argvFile, devices: [USB_DEVICE], logcat: LOGCAT }),
    config,
  })
}

test('the default log tail comes from the logTailLines setting', async () => {
  const { rt, paths } = await logsRuntime({ logTailLines: { get: () => 7 } })
  const result = await logs(rt, { serial: 'R58M12ABCDE' })
  assert.equal(result.lines, 7)
  assert.deepEqual(await argvWith(paths.argvFile, 'logcat'), [
    '-s',
    'R58M12ABCDE',
    'logcat',
    '-d',
    '-v',
    'time',
    '-t',
    '7',
  ])
})

test('an explicit line count wins over the setting', async () => {
  const { rt, paths } = await logsRuntime({ logTailLines: { get: () => 7 } })
  const result = await logs(rt, { serial: 'R58M12ABCDE', lines: 3 })
  assert.equal(result.lines, 3)
  assert.equal((await argvWith(paths.argvFile, 'logcat')).at(-1), '3')
})

test('the line count is clamped to 1..5000', async () => {
  const { rt, paths } = await logsRuntime()
  // Observed live: lines=99999 ran `logcat -t 5000`, lines=0 ran `-t 1`.
  assert.equal((await logs(rt, { serial: 'R58M12ABCDE', lines: 99999 })).lines, 5000)
  assert.equal((await logs(rt, { serial: 'R58M12ABCDE', lines: 0 })).lines, 1)
  assert.equal((await logs(rt, { serial: 'R58M12ABCDE', lines: -5 })).lines, 1)
  const requested = (await argvs(paths.argvFile)).filter((argv) => argv.includes('logcat')).map((argv) => argv.at(-1))
  assert.deepEqual(requested, ['5000', '1', '1'])
})

test('a non-finite line count never reaches adb as -t NaN', async () => {
  // `Math.max(1, Math.min(NaN, 5000))` is NaN, and `String(NaN)` became the
  // literal argument "-t NaN". The registry's `integer` schema already refuses
  // this from the model, so this pins the programmatic path.
  const { rt, paths } = await logsRuntime()
  assert.equal((await logs(rt, { serial: 'R58M12ABCDE', lines: Number.NaN })).lines, 5000)
  const requested = (await argvs(paths.argvFile)).filter((argv) => argv.includes('logcat')).map((argv) => argv.at(-1))
  assert.equal(requested.includes('NaN'), false, `adb must never see -t NaN: ${JSON.stringify(requested)}`)
})

test('an applicationId filters the tail and is validated first', async () => {
  const { rt } = await logsRuntime()
  const result = await logs(rt, { serial: 'R58M12ABCDE', applicationId: 'com.example.app' })
  assert.equal(result.applicationId, 'com.example.app')
  assert.equal(result.output.split('\n').filter(Boolean).length, 2)
  assert.match(result.output, /started/)
  assert.match(result.output, /stopped/)
  assert.doesNotMatch(result.output, /unrelated chatter/)
  await assert.rejects(
    () => logs(rt, { serial: 'R58M12ABCDE', applicationId: 'not a package' }),
    /Invalid Android application id/,
  )
})

test('the limit argument caps the rendered output with an explicit marker', async () => {
  const { rt } = await logsRuntime()
  const full = (await logs(rt, { serial: 'R58M12ABCDE' })).output
  const capped = (await logs(rt, { serial: 'R58M12ABCDE', limit: 25 })).output
  assert.equal(capped, `${full.slice(0, 25)}\n...[truncated ${full.length - 25} characters]`)
})

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------

/** A runtime whose fake adb answers `screencap` with a PNG signature. */
async function shotRuntime() {
  return toolchain({ adb: (p) => adbBody({ argvFile: p.argvFile, devices: [USB_DEVICE], png: true }) })
}

test('an explicit relative path is written under the session workspace', async () => {
  const { rt, paths } = await shotRuntime()
  const capture = await shot(rt, { serial: 'R58M12ABCDE', path: 'artifacts/shot.png' })
  assert.equal(capture.path, 'artifacts/shot.png')
  assert.equal(capture.absolutePath, path.join(paths.workDir, 'artifacts', 'shot.png'))
  assert.equal(capture.bytes, 16)
  const bytes = await readFile(capture.absolutePath)
  assert.equal(bytes.byteLength, 16)
  assert.deepEqual(bytes.subarray(0, 8), PNG_MAGIC)
})

test('the default path lands under the configured data directory', async () => {
  const { rt } = await shotRuntime()
  const capture = await shot(rt, { serial: 'R58M12ABCDE' })
  assert.match(capture.path, /^data\/screenshots\/.+\.png$/)
  assert.match(capture.path, /-R58M12ABCDE\.png$/)
  assert.deepEqual((await readFile(capture.absolutePath)).subarray(0, 8), PNG_MAGIC)
})

// A device with more than one display prints its `screencap` warning to stdout,
// and `adb exec-out` forwards it, so the stream is "chatter + PNG". Writing it
// verbatim produced a file no image tool could open while the tool still
// reported success (pre-release audit B-1, reproduced on Pixel_10_Pro_Fold).
const MULTI_DISPLAY_WARNING =
  '[Warning] Multiple displays were found, but no display id was specified! Defaulting to the first display found, however this default is not guaranteed to be consistent across captures. A display id should be specified.\n'

test('a device warning before the PNG is stripped from the written file', async () => {
  const { rt } = await toolchain({
    adb: (p) =>
      adbBody({
        argvFile: p.argvFile,
        devices: [USB_DEVICE],
        screencapPrefix: MULTI_DISPLAY_WARNING,
      }),
  })
  const capture = await shot(rt, { serial: 'R58M12ABCDE', path: 'artifacts/shot.png' })
  const bytes = await readFile(capture.absolutePath)
  assert.deepEqual(bytes.subarray(0, 8), PNG_MAGIC, 'the file must start with the PNG signature')
  assert.equal(bytes.includes('Multiple displays'), false, 'the device chatter must not reach the file')
  assert.equal(capture.bytes, bytes.byteLength)
})

test('a capture with no PNG at all is refused instead of written', async () => {
  const { rt } = await toolchain({
    adb: (p) =>
      adbBody({
        argvFile: p.argvFile,
        devices: [USB_DEVICE],
        png: false,
        screencapPrefix: 'ERROR: could not get idle state.\n',
      }),
  })
  await assert.rejects(
    () => shot(rt, { serial: 'R58M12ABCDE', path: 'artifacts/shot.png' }),
    /screencap produced no PNG image data/,
  )
})

test('an escaping screenshot path is refused before the capture runs', async () => {
  const { rt, paths } = await shotRuntime()
  await assert.rejects(
    () => shot(rt, { serial: 'R58M12ABCDE', path: '/etc/shot.png' }),
    /Path escapes the session workspace/,
  )
  await assert.rejects(
    () => shot(rt, { serial: 'R58M12ABCDE', path: '../../shot.png' }),
    /Path escapes the session workspace/,
  )
  const invocations = await argvs(paths.argvFile)
  assert.equal(
    invocations.some((argv) => argv.includes('exec-out')),
    false,
    'no capture may run for a refused path',
  )
})

// ---------------------------------------------------------------------------
// Emulator lifecycle
// ---------------------------------------------------------------------------

test('start_emulator never reuses an existing target by serial', async () => {
  const { rt, paths } = await toolchain({ adb: 'exit 0', emulator: 'exit 0' })
  await assert.rejects(() => startEmulator(rt, { serial: 'emulator-5554' }), /always starts a new emulator/)
  assert.deepEqual(await argvs(paths.argvFile), [], 'the refusal happens before any tool is spawned')
})

test('stop_emulator kills through the adb console and reports an unreachable one', async () => {
  const { rt, paths } = await toolchain({ adb: (p) => `${record(p.argvFile)}\nexit 0` })
  assert.deepEqual(await stopEmulator(rt, { serial: 'emulator-5556' }), { stopped: true, serial: 'emulator-5556' })
  assert.deepEqual(await argvWith(paths.argvFile, 'emu'), ['-s', 'emulator-5556', 'emu', 'kill'])
  await assert.rejects(() => stopEmulator(rt, { serial: 'bad;serial' }), /Invalid Android device serial/)
})

test('stop_emulator surfaces a vanished emulator instead of claiming success', async () => {
  // Observed live after emulator-5556 died on its own: `adb emu kill` could not
  // reach the console port, and the message said so rather than reporting a
  // stop that never happened.
  const { rt } = await toolchain({
    adb: 'echo "error: could not connect to TCP port 5556: Connection refused" >&2\nexit 1',
  })
  await assert.rejects(
    () => stopEmulator(rt, { serial: 'emulator-5556' }),
    /could not connect to TCP port 5556: Connection refused/,
  )
})

test('an AVD that is already running is refused by name, not restarted', async () => {
  const { rt, paths } = await toolchain({
    adb: (p) => adbBody({ argvFile: p.argvFile, devices: [EMULATOR_DEVICE], avdName: 'Pixel_10' }),
    emulator: (p) => `if [ "$1" = "-list-avds" ]; then echo Pixel_10; exit 0; fi\n${record(p.spawnArgv)}\nexit 1`,
  })
  await assert.rejects(() => startEmulator(rt, { avd: 'Pixel_10' }), /is already running as emulator-5554/)
  assert.deepEqual(await argvs(paths.spawnArgv), [], 'the running AVD must not be started a second time')
})

test('an unknown AVD name is refused instead of falling back to the first AVD', async () => {
  // Observed live: `android_start_emulator avd="NoSuchAvd_zzz"` answered
  // `Android AVD "Pixel_10" is already running as emulator-5554`, i.e. pickAvd
  // had resolved the request to a *different* AVD. On a host where that first
  // AVD is not running, the tool would start the wrong emulator and the caller
  // would never learn which device it is actually talking to.
  const { rt, paths } = await toolchain({
    adb: ADB_EMPTY,
    emulator: (p) =>
      `if [ "$1" = "-list-avds" ]; then echo Alpha_AVD; echo Beta_AVD; exit 0; fi\n${record(p.spawnArgv)}\necho "INFO  | starting"\nexit 1`,
  })
  await assert.rejects(
    () => startEmulator(rt, { avd: 'Nonexistent_AVD' }),
    /Android AVD "Nonexistent_AVD" not found\. Available AVDs: Alpha_AVD, Beta_AVD\./,
  )
  assert.deepEqual(await argvs(paths.spawnArgv), [], 'no emulator may be spawned for an AVD that does not exist')
})

test('the configured default AVD may still fall back to the first one', async () => {
  // The fallback stays for the case it was written for: nothing was asked for
  // by name, so any AVD is an acceptable answer.
  const { rt, paths } = await toolchain({
    adb: ADB_EMPTY,
    emulator: (p) =>
      `if [ "$1" = "-list-avds" ]; then echo Alpha_AVD; echo Beta_AVD; exit 0; fi\n${record(p.spawnArgv)}\necho "INFO  | starting"\nexit 1`,
  })
  rt.settings.defaultAvd = 'Not_Installed_Anymore'
  await assert.rejects(() => startEmulator(rt, {}), /exited during startup/)
  const [argv] = await argvs(paths.spawnArgv)
  assert.deepEqual(argv, ['-avd', 'Alpha_AVD'])
})

test('a stale configured serial fails instead of starting another emulator', async () => {
  // `pickDevice` treats defaultSerial as an explicit request. Swallowing its
  // "not found" error used to start a fresh emulator even though a ready USB
  // device was attached, and the caller was never told which target it got.
  const { rt, paths } = await toolchain({
    adb: (p) =>
      adbBody({
        argvFile: p.argvFile,
        devices: ['R58M12ABCDE            device usb:1 transport_id:2'],
      }),
    emulator: (p) => `if [ "$1" = "-list-avds" ]; then echo Alpha_AVD; exit 0; fi\n${record(p.spawnArgv)}\nexit 1`,
  })
  rt.settings.defaultSerial = 'emulator-9999'
  await assert.rejects(() => ensureDevice(rt, {}), /Android device not found: emulator-9999/)
  assert.deepEqual(await argvs(paths.spawnArgv), [], 'no emulator may be started when a ready device exists')
})

test('a partial AVD name does not silently select another AVD', async () => {
  // The contract says an explicitly requested AVD that does not exist must
  // fail. Substring matching turned `avd: "Pixel"` into `Pixel_10` and told the
  // caller nothing about the substitution.
  const { rt, paths } = await toolchain({
    adb: ADB_EMPTY,
    emulator: (p) => `if [ "$1" = "-list-avds" ]; then echo Pixel_10; exit 0; fi\n${record(p.spawnArgv)}\nexit 1`,
  })
  await assert.rejects(() => startEmulator(rt, { avd: 'Pixel' }), /Android AVD "Pixel" not found/)
  assert.deepEqual(await argvs(paths.spawnArgv), [], 'no emulator may be spawned for a partial name')
})

test('an exact AVD name wins over a longer name that contains it', async () => {
  // `includes` alone resolves "Pixel" to "Pixel_10" even when an AVD literally
  // called "Pixel" exists, which is the same wrong-device failure by another route.
  const { rt, paths } = await toolchain({
    adb: ADB_EMPTY,
    emulator: (p) =>
      `if [ "$1" = "-list-avds" ]; then echo Pixel_10; echo Pixel; exit 0; fi\n${record(p.spawnArgv)}\necho "INFO  | starting"\nexit 1`,
  })
  await assert.rejects(() => startEmulator(rt, { avd: 'Pixel' }), /exited during startup/)
  const [argv] = await argvs(paths.spawnArgv)
  assert.deepEqual(argv, ['-avd', 'Pixel'])
})

test('bootTimeoutSeconds is seconds and the call override is milliseconds', () => {
  // Pinned directly rather than by counting polls: a poll count depends on the
  // machine's timing and on the poll cadence, neither of which is this contract.
  assert.equal(bootTimeoutMs(undefined, 3), 3_000)
  assert.equal(bootTimeoutMs(100, 5), 100)
  assert.throws(() => bootTimeoutMs(0, 5), /Invalid timeoutMs: 0/)
  assert.throws(() => bootTimeoutMs(-1, 5), /Invalid timeoutMs: -1/)
})

test('an explicit timeoutMs overrides the bootTimeoutSeconds setting', { timeout: 30_000 }, async () => {
  const { rt } = await toolchain({
    adb: (p) => adbBody({ argvFile: p.argvFile, devices: [EMULATOR_DEVICE], boot: '0' }),
    config: { bootTimeoutSeconds: { get: () => 5 } },
  })
  await assert.rejects(
    () => ensureDevice(rt, { serial: 'emulator-5554', timeoutMs: 100 }),
    /Timed out waiting for Android Emulator to boot/,
  )
})

test('a new emulator stuck in unauthorized burns the boot timeout, then names the state', { timeout: 30_000 }, async () => {
  // Pinned defect: `startedEmulatorCandidates` only accepts `device`-state
  // emulators, so an unauthorized one is never a candidate. The start never
  // reports the real problem — it polls until the timeout and only then
  // mentions `unauthorized`, in the parenthesised detail line. `isBootComplete`
  // is not even attempted against it.
  const { rt, paths } = await toolchain({
    adb: (p) =>
      adbBody({
        argvFile: p.argvFile,
        flag: p.spawnFlag,
        appearing: ['emulator-5558          unauthorized'],
      }),
    emulator: (p) =>
      `if [ "$1" = "-list-avds" ]; then echo Alpha_AVD; exit 0; fi\n: > ${JSON.stringify(p.spawnFlag)}\necho $$ > ${JSON.stringify(p.pidFile)}\necho "INFO  | starting"\nexec sleep 60`,
    config: { bootTimeoutSeconds: { get: () => 1 } },
  })
  // Pre-create the marker the fake adb reads: the start polls immediately, so
  // the assertion must not depend on the fake emulator winning that race.
  await writeFile(paths.spawnFlag, '', 'utf8')
  try {
    await assert.rejects(
      () => startEmulator(rt, {}),
      (error) => {
        assert.match(error.message, /Timed out waiting for Android Emulator to boot/)
        assert.match(error.message, /emulator-5558:unauthorized/)
        return true
      },
    )
  } finally {
    // The timeout path leaves the emulator running; the fake must not outlive the test.
    const pid = Number((await readFile(paths.pidFile, 'utf8').catch(() => '')).trim())
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // The fake had already exited.
      }
    }
  }
})

// ---------------------------------------------------------------------------
// AVD creation
// ---------------------------------------------------------------------------

test('the default system image is the android-35 default image', () => {
  // This machine carries android-37.0 and android-37.2
  // google_apis_playstore_ps16k images only, so the plugin default below names
  // a package that is not installed: `android_create_avd` without an explicit
  // packageId always fails here, and preflight echoes the uninstalled id under
  // "Android plugin defaults" without checking it.
  const settings = readSettings({}, {})
  assert.equal(settings.apiLevel, '35')
  assert.equal(settings.systemImageVariant, 'default')
  const expectedAbi = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64'
  assert.equal(systemImagePackage(settings), `system-images;android-35;default;${expectedAbi}`)
})

test('create_avd answers avdmanager down the "no" path and surfaces its refusal', async () => {
  // Observed live: the real avdmanager replied "Package path is not valid.
  // Valid system image paths are: …". The contract that matters is that the
  // plugin never lets that prompt turn into a multi-gigabyte download.
  const { rt, paths } = await toolchain({
    avdmanager: (p) =>
      `cat > ${JSON.stringify(p.stdinFile)}\necho "Error: Package path is not valid. Valid system image paths are:" >&2\necho "system-images;android-37.0;google_apis_playstore_ps16k;arm64-v8a" >&2\nexit 1`,
  })
  await assert.rejects(
    () => createAvd(rt, { name: 'probe_avd', packageId: 'system-images;android-35;default;arm64-v8a' }),
    /Package path is not valid/,
  )
  assert.equal(await readFile(paths.stdinFile, 'utf8'), 'no\n')
})

test('create_avd refuses an invalid AVD name before spawning avdmanager', async () => {
  const { rt, paths } = await toolchain({ avdmanager: (p) => record(p.argvFile) })
  await assert.rejects(() => createAvd(rt, { name: 'bad;name' }), /Invalid Android AVD name/)
  assert.deepEqual(await argvs(paths.argvFile), [])
})
