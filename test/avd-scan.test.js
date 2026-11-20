import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../lib/runtime.js'
import { listAvds, parseAvdIni, parseAvds, scanAvds } from '../lib/providers/avd.js'
import { writeFakeTool } from './helpers/fake-tool.mjs'

/**
 * Pin AVD discovery when `emulator -list-avds` cannot run: the scan reads the
 * same `ANDROID_AVD_HOME` the emulator uses, so tests seed a throwaway home and
 * filter deleted-payload records the same way — the bug was an empty default-AVD
 * dropdown on hosts whose AVD directory held several.
 */

/** A logger that says nothing; the providers only ever warn through it. */
const QUIET = { info() {}, warn() {}, error() {} }

/**
 * Build a runtime with a throwaway AVD directory; `sdkPath` holds no tools, so
 * resolution falls through to `PATH` where the optional fake `emulator` lives.
 *
 * @param {{emulator?: object[]}} [options] - the fake emulator's steps.
 * @returns {Promise<{rt: object, avdHome: string, workDir: string}>} the runtime and its directories.
 */
async function runtime({ emulator } = {}) {
  const binDir = await mkdtemp(path.join(tmpdir(), 'aemh-scan-bin-'))
  const workDir = await mkdtemp(path.join(tmpdir(), 'aemh-scan-work-'))
  const avdHome = path.join(workDir, 'avd')
  if (emulator !== undefined) await writeFakeTool(binDir, 'emulator', emulator)
  const rt = createRuntime({
    config: {
      dataDir: { get: () => path.join(workDir, 'data') },
      sdkPath: { get: () => workDir },
    },
    logger: QUIET,
    cwd: workDir,
    env: {
      ...process.env,
      PATH: [binDir, process.env.PATH].filter(Boolean).join(path.delimiter),
      // The scan must read this tree and nothing on the developer's machine.
      ANDROID_AVD_HOME: avdHome,
    },
  })
  return { rt, avdHome, workDir }
}

/**
 * Seed the AVD cases the scan distinguishes: a complete AVD, a record whose
 * payload was deleted, a payload with no record, and unrelated files.
 *
 * @param {string} home - the AVD directory.
 * @returns {Promise<void>} resolves when the tree exists.
 */
async function seedAvdHome(home) {
  const pixel = path.join(home, 'Pixel_8.avd')
  await mkdir(pixel, { recursive: true })
  await writeFile(
    path.join(home, 'Pixel_8.ini'),
    ['avd.ini.encoding=UTF-8', `path=${pixel}`, 'path.rel=avd/Pixel_8.avd', 'target=android-35', ''].join('\n'),
  )
  // A record whose payload is gone: Android Studio leaves these behind when an
  // AVD is removed by hand, and offering one as a choice would promise a boot
  // that cannot happen.
  await writeFile(path.join(home, 'Deleted_Last_Week.ini'), ['target=android-34', ''].join('\n'))
  // A payload some other tool wrote without its `.ini`; `emulator -avd` cannot
  // resolve it, so it is not a usable AVD.
  await mkdir(path.join(home, 'Hand_Written.avd'), { recursive: true })
  await writeFile(path.join(home, 'notes.txt'), 'not an AVD')
  // `#` is legal on every filesystem here and illegal in an AVD name.
  await writeFile(path.join(home, 'bad#name.ini'), 'target=android-35\n')
}

test('an AVD record is read key by key, tolerating blanks and junk', () => {
  assert.deepEqual(
    parseAvdIni(
      ['avd.ini.encoding=UTF-8', '', 'target=android-35', 'path.rel=avd/Pixel_8.avd', '=nonsense', 'path='].join('\n'),
    ),
    { target: 'android-35' },
    'only the two fields the plugin reads, and only when the value is not empty',
  )
  assert.deepEqual(parseAvdIni(''), {})
})

test('the scan reports the complete records, sorted by name', async () => {
  const { rt, avdHome } = await runtime()
  await seedAvdHome(avdHome)
  const scanned = await scanAvds(rt)
  assert.deepEqual(scanned.map((item) => item.name), ['Pixel_8'], 'a complete record, and nothing else')
  assert.equal(scanned[0]?.target, 'android-35', 'the recorded target travels with the AVD')
  assert.equal(scanned[0]?.path, path.join(avdHome, 'Pixel_8.avd'))
})

test('a missing AVD directory is an empty list, not a failure', async () => {
  const { rt } = await runtime()
  assert.deepEqual(await scanAvds(rt), [])
})

test('the command and the directory are unioned, directory first', async () => {
  // The fake still answers, so this is the ordinary case where both sources
  // work: the emulator adds an AVD this scan could not see (it reads a home the
  // directory does not name), and neither list may swallow the other.
  const { rt, avdHome } = await runtime({
    emulator: [{ ifSub: '-list-avds', then: [{ out: 'Emulator_Only' }, { exit: 0 }] }],
  })
  await seedAvdHome(avdHome)
  assert.deepEqual((await listAvds(rt)).map((item) => item.name), ['Pixel_8', 'Emulator_Only'])
})

test('the command cannot re-add a record whose payload was deleted', async () => {
  // `emulator -list-avds` names Deleted_Last_Week from the `.ini` alone. The
  // option list must agree with the scan, or the dropdown offers an AVD that
  // `emulator -avd` refuses to start.
  const { rt, avdHome } = await runtime({
    emulator: [
      { ifSub: '-list-avds', then: [{ out: 'Pixel_8' }, { out: 'Deleted_Last_Week' }, { exit: 0 }] },
    ],
  })
  await seedAvdHome(avdHome)
  assert.deepEqual((await listAvds(rt)).map((item) => item.name), ['Pixel_8'], 'deduped and filtered')
})

test('the emulator list keeps only names that could ever be started', () => {
  // `emulator -list-avds` prints names, one per line, and a name is either one
  // `emulator -avd` accepts or it is not. The list used to keep anything that
  // was not blank — including a diagnostic line or a name that can never be
  // passed to `-avd` — while the explicit argument and the AVD directory were
  // validated, so the list and the start disagreed about what exists.
  assert.deepEqual(parseAvds(['Pixel_8', 'bad#name', '   ', '  Pixel_8_Pro  ', '../escaped'].join('\n')), [
    { name: 'Pixel_8' },
    { name: 'Pixel_8_Pro' },
  ])
  assert.deepEqual(parseAvds('   \n\n'), [])
})

test('an invalid name from the emulator never joins the list', async () => {
  const { rt, avdHome } = await runtime({
    emulator: [
      {
        ifSub: '-list-avds',
        then: [
          { out: 'Pixel_8' },
          { out: 'bad#name' },
          { out: '   ' },
          { out: '../escaped' },
          { exit: 0 },
        ],
      },
    ],
  })
  await seedAvdHome(avdHome)
  assert.deepEqual((await listAvds(rt)).map((item) => item.name), ['Pixel_8'])
})

test('a failed emulator does not hide the AVDs the directory proves exist', async () => {
  // This is the reported failure: `emulator -list-avds` cannot be started at
  // all, while the AVD directory holds the machine's AVDs. The old `listAvds`
  // threw here, which is what blanked the settings page's default-AVD list.
  const { rt, avdHome } = await runtime({
    emulator: [{ ifSub: '-list-avds', then: [{ err: 'emulator cannot start' }, { exit: 1 }] }],
  })
  await seedAvdHome(avdHome)
  assert.deepEqual((await listAvds(rt)).map((item) => item.name), ['Pixel_8'])
})

test('with nothing found, the emulator failure is still the answer', async () => {
  // "There are no AVDs here" and "the tool is missing" are different answers,
  // and only the scan having found something may soften the second one.
  const { rt } = await runtime({
    emulator: [{ ifSub: '-list-avds', then: [{ err: 'emulator cannot start' }, { exit: 1 }] }],
  })
  await assert.rejects(() => listAvds(rt), /emulator cannot start/)
})

test('a working emulator with an empty directory answers an empty list', async () => {
  const { rt } = await runtime({
    emulator: [{ ifSub: '-list-avds', then: [{ exit: 0 }] }],
  })
  assert.deepEqual(await listAvds(rt), [])
})
