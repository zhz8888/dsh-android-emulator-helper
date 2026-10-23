import assert from 'node:assert/strict'
import { test } from 'node:test'
import { splitArgumentLines } from '../lib/util/run.js'
import { parseAdbDevices, validSerial } from '../lib/providers/device.js'
import { parseAvds, startedEmulatorCandidates } from '../lib/providers/avd.js'
import { inputText, parseUiAutomator } from '../lib/providers/ui.js'
import { pickApk } from '../lib/providers/build.js'
import { projectWarnings } from '../lib/providers/project.js'
import { PAGE_LOCATION } from '../lib/providers/preflight.js'
import { readFileSync } from 'node:fs'

/**
 * Pure-function tests for the ported providers.
 *
 * Everything asserted here is a parser or a policy decision copied from the
 * ZCode plugin; keeping them covered is what makes the port verifiable without
 * an Android SDK on the test machine.
 */

test('adb device parsing keeps state, kind and label attributes', () => {
  const devices = parseAdbDevices(
    [
      'List of devices attached',
      'emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1',
      'R58M12ABCDE            unauthorized usb:336592896X transport_id:2',
      '',
    ].join('\n'),
  )
  assert.equal(devices.length, 2)
  assert.deepEqual(
    devices.map((item) => [item.serial, item.state, item.kind]),
    [
      ['emulator-5554', 'device', 'emulator'],
      ['R58M12ABCDE', 'unauthorized', 'device'],
    ],
  )
  assert.equal(devices[0].model, 'sdk_gphone64_arm64')
  assert.equal(devices[1].transportId, '2')
})

test('adb device parsing tolerates empty output', () => {
  assert.deepEqual(parseAdbDevices('List of devices attached\n\n'), [])
})

test('serial validation rejects shell metacharacters', () => {
  assert.equal(validSerial('emulator-5554'), true)
  assert.equal(validSerial('192.168.1.5:5555'), true)
  assert.equal(validSerial('emulator-5554; rm -rf /'), false)
  assert.equal(validSerial(''), false)
  assert.equal(validSerial(undefined), false)
})

test('AVD listing ignores blank lines', () => {
  assert.deepEqual(parseAvds('Pixel_10\n\nPixel_10_Pro_Fold\n'), [{ name: 'Pixel_10' }, { name: 'Pixel_10_Pro_Fold' }])
})

test('only emulators that appeared after the start are candidates', () => {
  const before = new Set(['emulator-5554'])
  const devices = [
    { serial: 'emulator-5554', state: 'device', kind: 'emulator' },
    { serial: 'emulator-5556', state: 'device', kind: 'emulator' },
    { serial: 'emulator-5558', state: 'offline', kind: 'emulator' },
    { serial: 'R58M12ABCDE', state: 'device', kind: 'device' },
  ]
  assert.deepEqual(
    startedEmulatorCandidates(devices, before).map((item) => item.serial),
    ['emulator-5556'],
  )
})

test('UI Automator XML flattens into actionable elements', () => {
  const xml =
    '<hierarchy><node index="0" text="Hello &amp; welcome" resource-id="com.example:id/title" class="android.widget.TextView" bounds="[0,0][1080,120]" clickable="false" enabled="true"/>' +
    '<node index="1" text="" content-desc="incrementButton" class="android.widget.Button" bounds="[100,200][300,400]" clickable="true" enabled="true"/></hierarchy>'
  const elements = parseUiAutomator(xml)
  assert.equal(elements.length, 2)
  assert.equal(elements[0].text, 'Hello & welcome')
  assert.equal(elements[0].bounds.centerX, 540)
  assert.equal(elements[0].bounds.centerY, 60)
  assert.equal(elements[0].clickable, false)
  assert.equal(elements[1].text, undefined)
  assert.equal(elements[1].contentDescription, 'incrementButton')
  assert.equal(elements[1].bounds.centerX, 200)
  assert.equal(elements[1].clickable, true)
})

test('a node without bounds still parses', () => {
  const [element] = parseUiAutomator('<node text="x" class="y"/>')
  assert.equal(element.bounds, undefined)
  assert.equal(element.text, 'x')
})

test('typed text escapes spaces exactly as adb input expects, and leaves percent alone', () => {
  assert.equal(inputText('hello world'), 'hello%sworld')
  // `input text` understands `%s` for a space and nothing else — it is not a URL
  // decoder. Escaping `%` to `%25` made the device type those four characters
  // literally, so a caller typing "100%" read back "100%25".
  assert.equal(inputText('100%'), '100%')
  assert.equal(inputText('a b%c'), 'a%sb%c')
  assert.throws(() => inputText('x'.repeat(1001)), /too long/)
})

test('APK selection prefers the requested variant directory', () => {
  const hits = [
    '/p/app/build/outputs/apk/release/app-release.apk',
    '/p/app/build/outputs/apk/debug/app-debug.apk',
  ]
  assert.equal(pickApk(hits, 'debug'), '/p/app/build/outputs/apk/debug/app-debug.apk')
  assert.equal(pickApk(hits, 'release'), '/p/app/build/outputs/apk/release/app-release.apk')
  assert.equal(pickApk(hits, 'staging'), hits[0], 'an unknown variant falls back to the first product')
})

test('missing project files produce the documented warnings', () => {
  assert.deepEqual(projectWarnings({ hasWrapper: true, hasGradleProperties: true, hasLocalProperties: true }), [])
  const warnings = projectWarnings({ hasWrapper: false, hasGradleProperties: false, hasLocalProperties: false })
  assert.equal(warnings.length, 3)
  assert.match(warnings[0], /gradle\.properties/)
  assert.match(warnings[1], /local\.properties/)
  assert.match(warnings[2], /Gradle wrapper/)
})

test('argument lines ignore blanks and comments and keep inner spaces', () => {
  const value = ['# emulator tweaks', '', '-no-snapshot-load', '  -gpu swiftshader_indirect  ', '# done'].join('\n')
  assert.deepEqual(splitArgumentLines(value), ['-no-snapshot-load', '-gpu swiftshader_indirect'])
  assert.deepEqual(splitArgumentLines(''), [])
  assert.deepEqual(splitArgumentLines(undefined), [])
})

test('JDK majors normalize full versions and the legacy 1.x scheme', async () => {
  const { majorOf } = await import('../lib/providers/sdk.js')
  assert.equal(majorOf('24.0.2'), '24')
  assert.equal(majorOf('21.0.6'), '21')
  assert.equal(majorOf('1.8.0_451'), '8')
  assert.equal(majorOf('1.8.503.01'), '8')
  assert.equal(majorOf('17'), '17')
  assert.equal(majorOf(''), '')
})

test('provider results are projected into the harness lossless-JSON domain', async () => {
  const { toLosslessJson } = await import('../lib/util/content.js')
  // The registry rejects `undefined`; optional provider attributes must vanish.
  assert.deepEqual(toLosslessJson({ serial: 'emulator-5554', model: undefined }), { serial: 'emulator-5554' })
  assert.deepEqual(toLosslessJson({ root: undefined }), {})
  assert.equal(toLosslessJson(undefined), null)
  // Nested records and arrays are normalized all the way down.
  assert.deepEqual(
    toLosslessJson({ devices: [{ serial: 'a', product: undefined }], bounds: { left: 0, top: undefined } }),
    { devices: [{ serial: 'a' }], bounds: { left: 0 } },
  )
  assert.deepEqual(toLosslessJson([undefined, 1]), [null, 1])
  // Non-finite numbers have no JSON representation either.
  assert.equal(toLosslessJson(Number.NaN), null)
  assert.equal(toLosslessJson(Number.POSITIVE_INFINITY), null)
  // Values that survive are untouched.
  assert.deepEqual(toLosslessJson({ ok: true, n: 0, s: '', list: [1, 2] }), { ok: true, n: 0, s: '', list: [1, 2] })
})

test('the diagnostic fix hints name the plugin page in the Plugins panel', () => {
  // Both hints used to send the user to "the plugin settings" — a location that
  // no longer exists after the page moved to the plugin detail view. The phrase
  // is one exported constant so a stale instruction is a test failure, and each
  // interpolation is counted so a hand-written replacement is caught too.
  assert.match(PAGE_LOCATION, /Plugins panel/)
  assert.match(PAGE_LOCATION, /Android Emulator Helper/)
  const source = readFileSync(new URL('../lib/providers/preflight.js', import.meta.url), 'utf8')
  assert.equal((source.match(/\$\{PAGE_LOCATION\}/g) ?? []).length, 2, 'both fix hints must interpolate PAGE_LOCATION')
})

test('a failed acceleration check blocks the automatic-start fallback', async () => {
  const { preflightOk } = await import('../lib/providers/preflight.js')
  const checks = [
    { name: 'emulator', ok: true },
    { name: 'Android Virtual Devices', ok: true },
    { name: 'Emulator acceleration', ok: false },
    { name: 'ADB devices', ok: false },
  ]
  assert.equal(preflightOk(checks, { hasReadyTarget: false, autoStartEmulator: true }), false)
})

test('APK selection understands a flavor directory', () => {
  const hits = [
    '/p/app/build/outputs/apk/freeDebug/app-free-debug.apk',
    '/p/app/build/outputs/apk/paidDebug/app-paid-debug.apk',
  ]
  assert.equal(pickApk(hits, 'debug'), '/p/app/build/outputs/apk/freeDebug/app-free-debug.apk')
})

test('create pins the configured build-tools release into the generated project', async () => {
  // The setting used to be display-only: preflight reported it while the
  // generated project let AGP pick its own default (34.0.0 for the pinned AGP),
  // so a machine with only newer build-tools still triggered an SDK download.
  const { mkdtemp, readFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const { create } = await import('../lib/providers/project.js')
  const { createRuntime } = await import('../lib/runtime.js')

  const root = await mkdtemp(path.join(tmpdir(), 'aemh-create-'))
  const rt = createRuntime({
    config: {
      dataDir: { get: () => path.join(root, 'data') },
      buildToolsVersion: { get: () => '35.0.0' },
    },
    cwd: root,
    env: { ...process.env, HOME: root },
  })
  await create(rt, { name: 'PinApp', dir: 'PinApp' })
  const build = await readFile(path.join(root, 'PinApp', 'app', 'build.gradle.kts'), 'utf8')
  assert.match(build, /buildToolsVersion = "35\.0\.0"/)
})

test('create refuses a build-tools value that would break the generated Kotlin', async () => {
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const { create } = await import('../lib/providers/project.js')
  const { createRuntime } = await import('../lib/runtime.js')

  const root = await mkdtemp(path.join(tmpdir(), 'aemh-create-bad-'))
  const rt = createRuntime({
    config: {
      dataDir: { get: () => path.join(root, 'data') },
      // A quote would close the Kotlin string literal in the generated file.
      buildToolsVersion: { get: () => '35.0.0"\ncompileSdk = 1' },
    },
    cwd: root,
    env: { ...process.env, HOME: root },
  })
  await assert.rejects(() => create(rt, { name: 'BadApp', dir: 'BadApp' }), /Invalid buildToolsVersion/)
})

test('a multi-display warning before the PNG is stripped to the image', async () => {
  const { pngPayload } = await import('../lib/providers/screenshot.js')
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
  const chatter = Buffer.from('[Warning] Multiple displays were found, but no display id was specified!\n')
  const payload = pngPayload(Buffer.concat([chatter, png]))
  assert.deepEqual(payload, png)
  assert.deepEqual(pngPayload(png), png, 'a clean stream is unchanged')
  assert.throws(() => pngPayload(chatter), /screencap produced no PNG image data/)
})

test('a device serial is reduced to a filesystem-safe filename fragment', async () => {
  const { fileSafe } = await import('../lib/providers/screenshot.js')
  assert.equal(fileSafe('emulator-5554'), 'emulator-5554')
  assert.equal(fileSafe('192.168.1.5:5555'), '192.168.1.5_5555')
})
