import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRuntime } from '../lib/runtime.js'
import { blockerHint, startedEmulatorCandidates, startEmulator } from '../lib/providers/avd.js'
import { pickDevice } from '../lib/providers/device.js'
import {
  KEY_EVENTS,
  describe,
  inputText,
  keyevent,
  parseUiAutomator,
  resolve,
  status,
  swipe,
  tap,
  typeText,
} from '../lib/providers/ui.js'

/**
 * UI automation provider tests: the pure parsers, plus the exact `adb` command
 * every action builds.
 *
 * The UI tools are the only ones whose contract is a *string of shell words*
 * handed to the device, so a unit test that stops at "it returned
 * `{tapped: true}`" proves nothing: rounding, quoting and the duration argument
 * all happen on the way to `adb`. A fake `adb` on `PATH` (the same technique
 * `emulator-start.test.js` uses for `emulator`) records its own argv, which is
 * what the assertions below read.
 *
 * Three assertions deliberately characterize behaviour that the real-device
 * sweep found surprising or wrong: the flattened node record has no `package`
 * (see `NODE_RECORD_KEYS`), `swipe` never reports the duration it used, and a
 * failed `uiautomator dump` silently serves the previous screen. They are
 * pinned so that changing them is a conscious decision, not an accident.
 */

/**
 * The default `adb devices -l` transcript: one healthy emulator.
 *
 * A serial of `emulator-5554` matters here: it is what the UI providers are
 * given, and `pickDevice` rejects a serial that is absent from this list.
 */
const READY_DEVICES = [
  'List of devices attached',
  'emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1',
  '',
].join('\n')

/**
 * The exact own-property shape of one flattened element, in insertion order.
 *
 * `package`, `scrollable`, `checked`, `focused`, `password` and `hint` are
 * present in the raw UI Automator XML but are dropped here, so a caller that
 * needs to know which app owns a node, or whether a container can scroll,
 * cannot get that from this record.
 */
const NODE_RECORD_KEYS = [
  'index',
  'text',
  'contentDescription',
  'resourceId',
  'className',
  'bounds',
  'clickable',
  'enabled',
]

/**
 * Install an executable fake `adb` that answers the calls the UI providers make.
 *
 * The script records every invocation, one bracketed argv element per line, so
 * a test can assert the precise device-shell command instead of inferring it.
 * `screen.xml` is what a *successful* `uiautomator dump` writes; `window.xml`
 * is the device-side file `cat` reads. Whatever dump path the provider passes is
 * mapped onto those two files, which is the only part of the dump not under test.
 *
 * @param {{screen?: string}} [options] - the XML the next dump should publish.
 * @returns {Promise<{rt: object, argv: () => Promise<string[]>, setScreen: (xml: string) => Promise<void>, failDump: (fails: boolean) => Promise<void>}>} the harness.
 */
async function fakeAdb(options = {}) {
  const binDir = await mkdtemp(path.join(tmpdir(), 'aemh-ui-bin-'))
  const stateDir = await mkdtemp(path.join(tmpdir(), 'aemh-ui-state-'))
  const dataDir = await mkdtemp(path.join(tmpdir(), 'aemh-ui-data-'))
  await writeFile(path.join(stateDir, 'screen.xml'), options.screen ?? '', 'utf8')
  // `adb devices -l` is served from files so a test can present any device
  // state, and can change it when a start actually happens.
  await writeFile(path.join(stateDir, 'devices.txt'), options.devices ?? READY_DEVICES, 'utf8')
  if (options.devicesAfterStart !== undefined) {
    await writeFile(path.join(stateDir, 'devices-after-start.txt'), options.devicesAfterStart, 'utf8')
  }
  if (options.emulatorScript !== undefined) {
    const emulatorFile = path.join(binDir, 'emulator')
    // The script is written into `binDir`, so it cannot know `stateDir` on its
    // own; `__STATE__` lets it write the marker the fake adb reads.
    await writeFile(emulatorFile, options.emulatorScript.replaceAll('__STATE__', stateDir), 'utf8')
    await chmod(emulatorFile, 0o755)
  }

  const script = `#!/bin/sh
STATE=${stateDir}
{
  printf 'ARGV'
  for a in "$@"; do printf ' [%s]' "$a"; done
  printf '\\n'
} >> "$STATE/argv.log"

if [ "$1" = "-s" ]; then shift 2; fi

case "$1" in
  devices)
    if [ -f "$STATE/started" ] && [ -f "$STATE/devices-after-start.txt" ]; then
      cat "$STATE/devices-after-start.txt"
    else
      cat "$STATE/devices.txt"
    fi
    exit 0
    ;;
  shell)
    shift
    cmd="$*"
    case "$cmd" in
      "getprop sys.boot_completed") echo 1; exit 0 ;;
      uiautomator\\ dump*)
        # cmd has already dropped the serial and the shell subcommand, so the
        # dump path is whatever follows the subcommand.
        dumpPath=\${cmd#uiautomator dump }
        # A real dump prints the success line and exits 0 even when it wrote
        # nothing; that is what makes a failed dump look like an empty screen
        # (see the stale-dump test below).
        if [ -f "$STATE/dump-fails" ]; then
          echo "UI hierchary dumped to: $dumpPath"
          exit 0
        fi
        cp "$STATE/screen.xml" "$STATE/window.xml"
        # Record which path this call published, so a read of any OTHER path
        # fails exactly as it would on a device that never wrote that file.
        printf '%s' "$dumpPath" > "$STATE/last-dump.txt"
        echo "UI hierchary dumped to: $dumpPath"
        exit 0
        ;;
      "cat /sdcard/window.xml"|"cat /sdcard/.dsh-ui-"*)
        # A faithful cat: the file exists only when the dump that named this very
        # path succeeded.
        path=$(echo "$cmd" | cut -d' ' -f2)
        if [ -f "$STATE/last-dump.txt" ] && [ "$(cat "$STATE/last-dump.txt")" = "$path" ]; then
          cat "$STATE/window.xml"
          exit 0
        fi
        echo "cat: $path: No such file or directory" >&2
        exit 1
        ;;
      "rm -f /sdcard/.dsh-ui-"*)
        # The provider removes its own dump file; a later read of that path must
        # therefore fail. The harness keeps window.xml as the last content.
        : > "$STATE/last-dump.txt"
        exit 0
        ;;
      input*)
        echo "$cmd" >> "$STATE/input.log"
        exit 0
        ;;
    esac
    exit 0
    ;;
esac
exit 0
`
  const file = path.join(binDir, 'adb')
  await writeFile(file, script, 'utf8')
  await chmod(file, 0o755)

  const rt = createRuntime({
    config: {
      dataDir: { get: () => dataDir },
      bootTimeoutSeconds: { get: () => 5 },
    },
    exec: undefined,
    logger: { info() {}, warn() {}, error() {} },
    env: { ...process.env, PATH: `${binDir}:/usr/bin:/bin` },
  })
  return {
    rt,
    stateDir,
    argv: async () => (await readFile(path.join(stateDir, 'argv.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean),
    setScreen: async (xml) => {
      await writeFile(path.join(stateDir, 'screen.xml'), xml, 'utf8')
    },
    failDump: async (fails) => {
      if (fails) await writeFile(path.join(stateDir, 'dump-fails'), '', 'utf8')
      else await rm(path.join(stateDir, 'dump-fails'), { force: true })
    },
  }
}

/** Build one UI Automator `<node>` tag from the attributes that matter here. */
function node(attributes) {
  const rendered = Object.entries(attributes)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ')
  return `<node ${rendered}/>`
}

/** Wrap nodes in the `<hierarchy>` root a real `uiautomator dump` always emits. */
function hierarchy(...nodes) {
  return `<hierarchy rotation="0">${nodes.join('')}</hierarchy>`
}

/** A screen with one matchable node of each queryable kind. */
const SCREEN = [
  '<hierarchy rotation="0">',
  node({ index: '0', text: 'Alpha', class: 'android.widget.TextView', bounds: '[0,0][100,100]', clickable: 'false', enabled: 'true' }),
  node({ index: '1', text: 'alpha target', class: 'android.widget.Button', bounds: '[100,100][300,300]', clickable: 'true', enabled: 'true' }),
  node({ index: '2', text: '', 'content-desc': 'Desc Node', class: 'android.view.View', bounds: '[0,0][10,10]' }),
  node({ index: '3', 'resource-id': 'com.example:id/field', class: 'android.widget.EditText', bounds: '[0,0][20,20]' }),
  node({ index: '4', class: 'android.widget.SeekBar', bounds: '[0,0][30,30]' }),
  // The bounds-less node comes first on purpose: `resolve` must skip it.
  node({ index: '5', text: 'NoBounds', class: 'android.view.View' }),
  node({ index: '6', text: 'NoBounds', class: 'android.view.View', bounds: '[50,50][150,150]' }),
  '</hierarchy>',
].join('')

test('UI Automator XML flattens into the documented record shape', () => {
  const elements = parseUiAutomator(SCREEN)
  assert.equal(elements.length, 7)
  // The record is re-indexed by position, not by the XML `index` attribute
  // (every sibling in a real dump repeats index="0").
  assert.deepEqual(
    elements.map((item) => item.index),
    [0, 1, 2, 3, 4, 5, 6],
  )
  assert.deepEqual(Object.keys(elements[0]), NODE_RECORD_KEYS)
  assert.equal(elements[0].text, 'Alpha')
  assert.equal(elements[1].text, 'alpha target')
  assert.equal(elements[2].contentDescription, 'Desc Node')
  assert.equal(elements[3].resourceId, 'com.example:id/field')
  assert.equal(elements[4].className, 'android.widget.SeekBar')
  // An empty XML attribute becomes `undefined`, not ''. The tool result then
  // drops the key entirely (`toLosslessJson`), so callers must tolerate a
  // record without `text`.
  assert.equal(elements[2].text, undefined)
  assert.ok('text' in elements[2], 'the key stays present in the parsed record')
})

test('bounds parse into numbers with the centre precomputed', () => {
  const [element] = parseUiAutomator(node({ text: 'x', bounds: '[10,20][30,40]' }))
  assert.deepEqual(element.bounds, { left: 10, top: 20, right: 30, bottom: 40, centerX: 20, centerY: 30 })
  for (const value of Object.values(element.bounds)) assert.equal(typeof value, 'number')
  const [zero] = parseUiAutomator(node({ text: 'x', bounds: '[5,5][5,5]' }))
  assert.equal(zero.bounds.centerX, 5)
  assert.equal(zero.bounds.centerY, 5)
})

test('a node without usable bounds parses but exposes no coordinates', () => {
  const [missing] = parseUiAutomator(node({ text: 'x' }))
  assert.equal(missing.bounds, undefined)
  const [malformed] = parseUiAutomator(node({ text: 'x', bounds: 'nonsense' }))
  assert.equal(malformed.bounds, undefined)
})

test('clickable and enabled are coerced, and enabled defaults to true', () => {
  const elements = parseUiAutomator(
    [
      node({ text: 'a', bounds: '[0,0][1,1]', clickable: 'true', enabled: 'true' }),
      node({ text: 'b', bounds: '[0,0][1,1]', clickable: 'false', enabled: 'false' }),
      node({ text: 'c', bounds: '[0,0][1,1]' }),
    ].join(''),
  )
  assert.deepEqual(
    elements.map((item) => [item.clickable, item.enabled]),
    [
      [true, true],
      [false, false],
      // A missing attribute must not read as "disabled".
      [false, true],
    ],
  )
})

test('XML entities in text and attributes are decoded', () => {
  const [element] = parseUiAutomator(
    node({ text: 'Hello &amp; welcome &quot;there&quot; &lt;b&gt;', 'content-desc': 'it&apos;s', bounds: '[0,0][2,2]' }),
  )
  assert.equal(element.text, 'Hello & welcome "there" <b>')
  assert.equal(element.contentDescription, "it's")
})

test('input text escapes spaces only, and refuses over-long text', () => {
  assert.equal(inputText('hello world'), 'hello%sworld')
  // `input text` is a small custom parser, not a URL decoder: the only escape it
  // understands is `%s`. Escaping `%` to `%25` corrupted every percent sign the
  // caller typed, so it passes through untouched.
  assert.equal(inputText('100%'), '100%')
  assert.equal(inputText('a b%c'), 'a%sb%c')
  assert.equal(inputText('line\nbreak\ttab'), 'line%sbreak%stab')
  // The residual, unavoidable limitation: a literal `%s` cannot be expressed,
  // because the device reads it as a space.
  assert.equal(inputText('a%sb'), 'a%sb')
  // 1000 characters is the documented maximum, so exactly 1000 must pass.
  assert.equal(inputText('x'.repeat(1000)), 'x'.repeat(1000))
  assert.throws(() => inputText('x'.repeat(1001)), /too long/)
  assert.throws(() => inputText(undefined), /must be a string/)
  assert.throws(() => inputText(42), /must be a string/)
})

test('input text leaves ampersands and non-ASCII alone', () => {
  // `&` needs no escaping *here*: it is quoted later, by `deviceShellQuote`.
  assert.equal(inputText('a&b'), 'a&b')
  // Chinese survives the escaper untouched. `adb shell input text` cannot type
  // it, so the call reaches the device and fails there, after this function
  // has already reported success.
  assert.equal(inputText('中文'), '中文')
})

test('key mapping covers exactly the six documented keys', () => {
  assert.deepEqual(KEY_EVENTS, {
    BACK: 'KEYCODE_BACK',
    HOME: 'KEYCODE_HOME',
    ENTER: 'KEYCODE_ENTER',
    APP_SWITCH: 'KEYCODE_APP_SWITCH',
    MENU: 'KEYCODE_MENU',
    SEARCH: 'KEYCODE_SEARCH',
  })
})

test('the UI backend reports the adb it will use', async () => {
  const { rt } = await fakeAdb()
  const report = await status(rt)
  assert.equal(report.available, true)
  assert.equal(report.backend, 'adb-uiautomator')
  assert.match(report.adb, /adb$/)
  assert.deepEqual(report.implementedBackends, ['uiautomator', 'adb-input'])
})

test('describe dumps to a path of its own, reads it back, and removes it', { skip: process.platform === 'win32' }, async () => {
  const { rt, argv } = await fakeAdb({ screen: SCREEN })
  const tree = await describe(rt, { serial: 'emulator-5554' })
  assert.equal(tree.device.serial, 'emulator-5554')
  assert.equal(tree.elements.length, 7)
  const lines = await argv()
  // The dump path is unique per call, so two concurrent callers cannot read each
  // other's screen and a failed dump has nothing stale to hand back.
  assert.match(lines[2], /^ARGV \[-s\] \[emulator-5554\] \[shell\] \[uiautomator dump \/sdcard\/\.dsh-ui-\d+-\d+-\d+\.xml\]$/)
  const dumpPath = /uiautomator dump (\S+)\]$/.exec(lines[2])[1]
  assert.equal(lines[3], `ARGV [-s] [emulator-5554] [shell] [cat ${dumpPath}]`)
  assert.equal(lines[4], `ARGV [-s] [emulator-5554] [shell] [rm -f ${dumpPath}]`, 'the dump file must not accumulate on the device')
})

test('describe reports a failed dump instead of serving the previous screen', { skip: process.platform === 'win32' }, async () => {
  const first = parseUiAutomator(node({ text: 'ScreenOne', bounds: '[0,0][10,10]' }))[0]
  const second = parseUiAutomator(node({ text: 'ScreenTwo', bounds: '[0,0][10,10]' }))[0]
  assert.equal(first.text, 'ScreenOne')
  assert.equal(second.text, 'ScreenTwo')

  const harness = await fakeAdb({ screen: hierarchy(node({ text: 'ScreenOne', bounds: '[0,0][10,10]' })) })
  const before = await describe(harness.rt, { serial: 'emulator-5554' })
  assert.equal(before.elements[0].text, 'ScreenOne')

  // The screen changes, but the dump fails the way the real one does: it still
  // prints "UI hierchary dumped to:" and still exits 0, writing nothing.
  await harness.setScreen(hierarchy(node({ text: 'ScreenTwo', bounds: '[0,0][10,10]' })))
  await harness.failDump(true)

  // The failure is reported. Answering with an empty tree instead would be
  // indistinguishable from a genuinely empty screen and would send the caller
  // hunting for a bug in its own query. Which message it is depends on how the
  // device surfaces the miss: `cat` on the never-written path fails outright,
  // and the provider's own guard catches the case where it somehow does not.
  await assert.rejects(
    () => describe(harness.rt, { serial: 'emulator-5554' }),
    /UI Automator produced no dump for emulator-5554|No such file or directory/,
  )

  // Control: once the dump writes again, the same call sees the new screen.
  await harness.failDump(false)
  const fresh = await describe(harness.rt, { serial: 'emulator-5554' })
  assert.equal(fresh.elements[0].text, 'ScreenTwo')
})

test('resolve searches text, content description, resource id and class', { skip: process.platform === 'win32' }, async () => {
  const { rt } = await fakeAdb({ screen: SCREEN })
  const cases = [
    ['Alpha', 0, 50, 50],
    ['Desc Node', 2, 5, 5],
    ['com.example:id/field', 3, 10, 10],
    ['android.widget.SeekBar', 4, 15, 15],
  ]
  for (const [query, index, x, y] of cases) {
    const hit = await resolve(rt, { query, serial: 'emulator-5554' })
    assert.equal(hit.element.index, index, `${query} must match node ${index}`)
    assert.equal(hit.x, x)
    assert.equal(hit.y, y)
    // The coordinates are the centre of the matched bounds, so a caller can tap
    // them without a second lookup.
    assert.equal(hit.x, hit.element.bounds.centerX)
    assert.equal(hit.y, hit.element.bounds.centerY)
    assert.ok(hit.x >= hit.element.bounds.left && hit.x <= hit.element.bounds.right)
    assert.ok(hit.y >= hit.element.bounds.top && hit.y <= hit.element.bounds.bottom)
  }
})

test('resolve is case-insensitive and returns the first match in tree order', { skip: process.platform === 'win32' }, async () => {
  const { rt } = await fakeAdb({ screen: SCREEN })
  const upper = await resolve(rt, { query: 'ALPHA', serial: 'emulator-5554' })
  assert.equal(upper.element.index, 0)
  // Node 1 also matches and is clickable; node 0 is not. Ranking is positional,
  // so the non-clickable node wins and the caller gets a dead coordinate.
  assert.equal(upper.element.clickable, false)
})

test('resolve skips nodes without bounds', { skip: process.platform === 'win32' }, async () => {
  const { rt } = await fakeAdb({ screen: SCREEN })
  const hit = await resolve(rt, { query: 'NoBounds', serial: 'emulator-5554' })
  assert.equal(hit.element.index, 6)
  // When only a bounds-less node matches, there is nothing to tap, so the call
  // fails rather than returning a coordinate-less "match".
  const only = await fakeAdb({ screen: hierarchy(node({ text: 'NoBounds', class: 'android.view.View' })) })
  await assert.rejects(() => resolve(only.rt, { query: 'NoBounds', serial: 'emulator-5554' }), /No visible Android UI element matched/)
})

test('resolve reports a clean error for no match and for an empty query', { skip: process.platform === 'win32' }, async () => {
  const { rt } = await fakeAdb({ screen: SCREEN })
  await assert.rejects(
    () => resolve(rt, { query: 'zzz-absent', serial: 'emulator-5554' }),
    (error) => {
      assert.match(error.message, /No visible Android UI element matched: zzz-absent/)
      return true
    },
  )
  await assert.rejects(() => resolve(rt, { query: '', serial: 'emulator-5554' }), /must not be empty/)
  await assert.rejects(() => resolve(rt, { query: '   ', serial: 'emulator-5554' }), /must not be empty/)
})

test('tap rounds fractional coordinates for adb and reports what was sent', { skip: process.platform === 'win32' }, async () => {
  const { rt, argv } = await fakeAdb({ screen: SCREEN })
  const report = await tap(rt, { x: 1.5, y: 2.5, serial: 'emulator-5554' })
  const sent = (await argv()).find((line) => line.includes('[input tap'))
  assert.equal(sent, 'ARGV [-s] [emulator-5554] [shell] [input tap 2 3]')
  // The report must not claim a coordinate the device never received: `input
  // tap` takes integers, so 1.5/2.5 were rounded on the way out.
  assert.deepEqual(report, { tapped: true, serial: 'emulator-5554', x: 2, y: 3 })
})

test('tap forwards out-of-range coordinates without validation', { skip: process.platform === 'win32' }, async () => {
  const { rt, argv } = await fakeAdb({ screen: SCREEN })
  await tap(rt, { x: -5, y: 9000, serial: 'emulator-5554' })
  const sent = (await argv()).find((line) => line.includes('[input tap'))
  assert.equal(sent, 'ARGV [-s] [emulator-5554] [shell] [input tap -5 9000]')
})

test('swipe passes the rounded duration to adb and reports what ran', { skip: process.platform === 'win32' }, async () => {
  const { rt, argv } = await fakeAdb({ screen: SCREEN })
  const report = await swipe(rt, { x1: 540, y1: 1800, x2: 540, y2: 600, durationMs: 1500, serial: 'emulator-5554' })
  assert.equal(
    (await argv()).find((line) => line.includes('[input swipe')),
    'ARGV [-s] [emulator-5554] [shell] [input swipe 540 1800 540 600 1500]',
  )
  // The duration is part of the report because it is the one gesture parameter a
  // caller cannot infer from the visible result: a clamped list moves the same
  // distance at every duration, so without it there is no way to confirm which
  // value actually ran.
  assert.deepEqual(Object.keys(report), ['swiped', 'serial', 'x1', 'y1', 'x2', 'y2', 'durationMs'])
  assert.equal(report.durationMs, 1500)
})

test('swipe defaults to 300ms and rounds fractional durations', { skip: process.platform === 'win32' }, async () => {
  const { rt, argv } = await fakeAdb({ screen: SCREEN })
  await swipe(rt, { x1: 0, y1: 0, x2: 10, y2: 10, serial: 'emulator-5554' })
  await swipe(rt, { x1: 0, y1: 0, x2: 10, y2: 10, durationMs: 1500.6, serial: 'emulator-5554' })
  const sent = (await argv()).filter((line) => line.includes('[input swipe'))
  assert.deepEqual(sent, [
    'ARGV [-s] [emulator-5554] [shell] [input swipe 0 0 10 10 300]',
    'ARGV [-s] [emulator-5554] [shell] [input swipe 0 0 10 10 1501]',
  ])
})

test('swipe accepts reversed and zero-distance gestures', { skip: process.platform === 'win32' }, async () => {
  const { rt, argv } = await fakeAdb({ screen: SCREEN })
  // A reversed or zero-distance swipe is not refused: it becomes a real input
  // event (a drag back, or a stationary long press).
  await swipe(rt, { x1: 100, y1: 200, x2: 10, y2: 20, durationMs: 10, serial: 'emulator-5554' })
  await swipe(rt, { x1: 500, y1: 500, x2: 500, y2: 500, serial: 'emulator-5554' })
  const sent = (await argv()).filter((line) => line.includes('[input swipe'))
  assert.deepEqual(sent, [
    'ARGV [-s] [emulator-5554] [shell] [input swipe 100 200 10 20 10]',
    'ARGV [-s] [emulator-5554] [shell] [input swipe 500 500 500 500 300]',
  ])
})

test('type text sends the escaped value to adb', { skip: process.platform === 'win32' }, async () => {
  const { rt, argv } = await fakeAdb({ screen: SCREEN })
  const report = await typeText(rt, { text: 'a b%c', serial: 'emulator-5554' })
  assert.equal(
    (await argv()).find((line) => line.includes('[input text')),
    'ARGV [-s] [emulator-5554] [shell] [input text a%sb%c]',
  )
  // `length` counts the caller's characters, not the escaped ones.
  assert.deepEqual(report, { typed: true, serial: 'emulator-5554', length: 5 })
})

test('type text quotes shell metacharacters and single quotes', { skip: process.platform === 'win32' }, async () => {
  const { rt, argv } = await fakeAdb({ screen: SCREEN })
  await typeText(rt, { text: 'a&b', serial: 'emulator-5554' })
  await typeText(rt, { text: "it's", serial: 'emulator-5554' })
  const sent = (await argv()).filter((line) => line.includes('[input text'))
  // `&` is contained by the device-shell quoting, not by `inputText`.
  assert.deepEqual(sent, [
    "ARGV [-s] [emulator-5554] [shell] [input text 'a&b']",
    "ARGV [-s] [emulator-5554] [shell] [input text 'it'\\''s']",
  ])
})

test('type text refuses over-long text before sending anything to the device', { skip: process.platform === 'win32' }, async () => {
  const { rt, argv } = await fakeAdb({ screen: SCREEN })
  await assert.rejects(() => typeText(rt, { text: 'x'.repeat(1001), serial: 'emulator-5554' }), /too long/)
  // No `input text` is sent, so the device never receives a truncated
  // replacement for the text the caller asked for. The device is still
  // contacted first: `ensureDevice` runs before the length check, so the
  // refusal happens after the handshake, not before it.
  const sent = await argv()
  assert.deepEqual(
    sent.filter((line) => line.includes('input text')),
    [],
  )
  assert.ok(sent.some((line) => line.includes('[devices] [-l]')), 'the device handshake already happened')
})

test('type text forwards non-ASCII text unchanged', { skip: process.platform === 'win32' }, async () => {
  const { rt, argv } = await fakeAdb({ screen: SCREEN })
  const report = await typeText(rt, { text: '中文', serial: 'emulator-5554' })
  assert.equal((await argv()).find((line) => line.includes('[input text')), "ARGV [-s] [emulator-5554] [shell] [input text '中文']")
  // The provider reports success for text `adb shell input text` cannot type;
  // the failure surfaces on the device, not here.
  assert.equal(report.typed, true)
  assert.equal(report.length, 2)
})

test('keyevent sends the mapped keycode and refuses anything else', { skip: process.platform === 'win32' }, async () => {
  const { rt, argv } = await fakeAdb({ screen: SCREEN })
  for (const [key, code] of Object.entries(KEY_EVENTS)) {
    const report = await keyevent(rt, { key, serial: 'emulator-5554' })
    assert.deepEqual(report, { pressed: true, serial: 'emulator-5554', key })
    const sent = (await argv()).at(-1)
    assert.equal(sent, `ARGV [-s] [emulator-5554] [shell] [input keyevent ${code}]`)
  }
  await assert.rejects(() => keyevent(rt, { key: 'VOLUME_UP', serial: 'emulator-5554' }), /Unsupported Android key: VOLUME_UP/)
  await assert.rejects(() => keyevent(rt, { key: 'keycode_back', serial: 'emulator-5554' }), /Unsupported Android key/)
  await assert.rejects(() => keyevent(rt, { serial: 'emulator-5554' }), /Unsupported Android key: undefined/)
})

/*
 * ---------------------------------------------------------------------------
 * Device-selection and emulator-startup state handling.
 *
 * This section is not UI automation; it is here because `test/ui-tools.test.js`
 * is the only file this sweep was allowed to write. Move it next to
 * `emulator-start.test.js` when convenient.
 *
 * Background: an emulator whose adb key handshake never completed appears as
 * `unauthorized`, which is a *different* state from `offline` and from a device
 * that is still booting. These tests pin how that state is classified, and what
 * the caller is finally told.
 * ---------------------------------------------------------------------------
 */

test('an explicitly named device in a non-ready state fails loudly and names the state', { skip: process.platform === 'win32' }, async () => {
  for (const state of ['unauthorized', 'offline']) {
    const { rt } = await fakeAdb({
      devices: ['List of devices attached', `emulator-5556          ${state} transport_id:3`, ''].join('\n'),
    })
    await assert.rejects(
      () => pickDevice(rt, { serial: 'emulator-5556' }),
      (error) => {
        assert.match(error.message, new RegExp(`Android device is not ready: emulator-5556 \\(${state}\\)`))
        return true
      },
      `${state} must be reported as not ready`,
    )
  }
})

test('an attached but unauthorized device is invisible to serial-less selection', { skip: process.platform === 'win32' }, async () => {
  const { rt } = await fakeAdb({
    devices: ['List of devices attached', 'emulator-5556          unauthorized transport_id:3', ''].join('\n'),
  })
  // `pickDevice` only considers `state === 'device'`, so an unauthorized device
  // is skipped. The message then says no device was found at all: it reports
  // "nothing is ready" without mentioning the device that is physically
  // attached and needs one tap on screen to become usable. The startup path
  // does better (see the blockerHint test); this path does not.
  await assert.rejects(() => pickDevice(rt), (error) => {
    assert.match(error.message, /No ready Android device or emulator found\./)
    assert.doesNotMatch(error.message, /unauthorized/)
    return true
  })
})

test('a ready device still wins while an unauthorized one is attached', { skip: process.platform === 'win32' }, async () => {
  const { rt } = await fakeAdb({
    devices: [
      'List of devices attached',
      'emulator-5556          unauthorized transport_id:3',
      'emulator-5554          device product:sdk_gphone16k_arm64 transport_id:5',
      '',
    ].join('\n'),
  })
  const device = await pickDevice(rt)
  assert.equal(device.serial, 'emulator-5554')
})

test('a started emulator only counts as a candidate once adb calls it ready', () => {
  const before = new Set(['emulator-5554'])
  const devices = [
    { serial: 'emulator-5554', state: 'device', kind: 'emulator' },
    { serial: 'emulator-5556', state: 'unauthorized', kind: 'emulator' },
    { serial: 'emulator-5558', state: 'offline', kind: 'emulator' },
    { serial: 'emulator-5560', state: 'device', kind: 'emulator' },
    { serial: 'R58M12ABCDE', state: 'device', kind: 'device' },
  ]
  // An unauthorized emulator is never polled for boot completion: the state has
  // to change before any adb command is even attempted against it.
  assert.deepEqual(
    startedEmulatorCandidates(devices, before).map((item) => item.serial),
    ['emulator-5560'],
  )
})

test('blockerHint explains an unauthorized device and stays silent when all are ready', () => {
  const unauthorized = blockerHint([
    { serial: 'emulator-5556', state: 'unauthorized' },
    { serial: 'emulator-5554', state: 'device' },
  ])
  assert.match(unauthorized, /Blocking devices: emulator-5556:unauthorized\./)
  assert.match(unauthorized, /Accept the RSA prompt on screen/)
  assert.match(unauthorized, /ADB_VENDOR_KEYS=/)
  // An offline device is reported, but without the RSA advice, which does not
  // apply to it.
  const offline = blockerHint([{ serial: 'emulator-5558', state: 'offline' }])
  assert.match(offline, /emulator-5558:offline/)
  assert.doesNotMatch(offline, /RSA prompt/)
  assert.equal(blockerHint([{ serial: 'emulator-5554', state: 'device' }]), '')
  assert.equal(blockerHint([]), '')
})

test('starting an emulator that stays unauthorized reports the state, not a bare timeout', { skip: process.platform === 'win32' }, async () => {
  // The fake emulator starts and stays alive; adb reports the new serial as
  // unauthorized and never as `device`.
  const harness = await fakeAdb({
    devices: 'List of devices attached\n\n',
    devicesAfterStart: 'List of devices attached\nemulator-5556          unauthorized transport_id:3\n\n',
    emulatorScript: [
      '#!/bin/sh',
      'if [ "$1" = "-list-avds" ]; then',
      '  echo Fake_AVD',
      '  exit 0',
      'fi',
      'touch "__STATE__/started"',
      'echo $$ > "__STATE__/emulator.pid"',
      'sleep 8',
      'exit 0',
      '',
    ].join('\n'),
  })
  // The first devices poll races the fake emulator's `touch`; the test is about
  // the error text, so the marker is placed before the start instead.
  await writeFile(path.join(harness.stateDir, 'started'), '', 'utf8')
  const error = await startEmulator(harness.rt, { avd: 'Fake_AVD', timeoutMs: 1_000 }).then(
    () => undefined,
    (thrown) => thrown,
  )
  assert.ok(error instanceof Error)
  // Both halves matter: the state is named, and the hint says what to do about
  // it. Without them this failure is indistinguishable from a slow boot.
  assert.match(error.message, /Timed out waiting for Android Emulator to boot/)
  assert.match(error.message, /emulator-5556:unauthorized/)
  assert.match(error.message, /Accept the RSA prompt on screen/)
  // The fake must not outlive the test.
  const pid = Number((await readFile(path.join(harness.stateDir, 'emulator.pid'), 'utf8').catch(() => '')).trim())
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // The fake had already exited.
    }
  }
})
