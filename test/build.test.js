import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { applicationIdFor, discover, findApks } from '../lib/providers/project.js'
import { buildApp, parseAaptBadging, wrapperGradleVersion } from '../lib/providers/build.js'
import { createRuntime } from '../lib/runtime.js'
import { writeFakeTool } from './helpers/fake-tool.mjs'

/**
 * Multi-module target resolution and build-result durability.
 *
 * `settings.gradle` lists modules but never says which one is the application,
 * and Gradle's `:feature:login` is the directory `feature/login`. The default
 * build target and the application id both depend on getting that right, so
 * these tests build a real (fake-Gradle) project on disk instead of asserting
 * the helpers in isolation.
 */

/**
 * Write one module: its build file and, for an app module, an APK product.
 *
 * @param {string} root - the project root.
 * @param {string} dir - the module directory, using filesystem separators.
 * @param {string} build - the module's build file body.
 * @param {boolean} [apk] - whether to write a debug APK product.
 * @returns {Promise<void>} resolves when the module is on disk.
 */
async function moduleDir(root, dir, build, apk = false) {
  const moduleRoot = path.join(root, ...dir.split('/'))
  await mkdir(moduleRoot, { recursive: true })
  await writeFile(path.join(moduleRoot, 'build.gradle.kts'), build, 'utf8')
  if (apk) {
    const out = path.join(moduleRoot, 'build', 'outputs', 'apk', 'debug')
    await mkdir(out, { recursive: true })
    await writeFile(path.join(out, `${dir.split('/').at(-1)}-debug.apk`), 'apk', 'utf8')
  }
}

/**
 * A runtime rooted at one scratch project.
 *
 * @param {string} project - the project root.
 * @param {string} dataDir - the plugin data directory, also the pinned SDK root.
 * @param {NodeJS.ProcessEnv} [env] - environment override; defaults to the host's.
 * @returns {import('../lib/runtime.js').Runtime} the runtime.
 */
function runtimeAt(project, dataDir, env = { ...process.env }) {
  return createRuntime({
    config: {
      dataDir: { get: () => dataDir },
      buildTimeoutSeconds: { get: () => 30 },
      // The plugin discovers the Android SDK on its own, including by scanning
      // the drive roots, so a machine that has one installed would otherwise
      // resolve the real tools instead of the ones this test provides. A
      // configured root is authoritative: pointing it at a directory that holds
      // no tools keeps the real SDK out of the way.
      sdkPath: { get: () => dataDir },
    },
    cwd: project,
    // The wrapper is found at the project root, but a child still needs the
    // host's own PATH: on Windows `cmd.exe` — which every `.bat` launcher needs
    // — lives in one of its directories.
    env,
    logger: { info() {}, warn() {}, error() {} },
  })
}

/**
 * A fake aapt2 under one SDK root's `build-tools`, as the plugin finds it.
 *
 * @param {string} sdkDir - the directory the runtime pins as the SDK root.
 * @param {string[]} steps - the fake's steps.
 * @param {string} [version] - the build-tools release directory.
 * @returns {Promise<void>} resolves when the fake is on disk.
 */
async function fakeAapt2(sdkDir, steps, version = '35.0.0') {
  const dir = path.join(sdkDir, 'build-tools', version)
  await mkdir(dir, { recursive: true })
  await writeFakeTool(dir, 'aapt2', steps)
}

/**
 * A fake Gradle wrapper that records its argv and exits 0.
 *
 * The plugin runs `gradlew.bat` on Windows and `gradlew` elsewhere, so the fake
 * carries the name and launcher each platform expects.
 */
async function fakeGradle(project) {
  await writeFakeTool(
    project,
    'gradlew',
    [{ recordLines: path.join(project, 'gradle-argv.txt') }, { exit: 0 }],
    { launcher: 'bat' },
  )
}

test('the application module is identified, not assumed to be the first include', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-modules-'))
  await writeFile(path.join(root, 'settings.gradle.kts'), 'include(":core")\ninclude(":app")\ninclude(":feature:login")\n', 'utf8')
  await moduleDir(root, 'core', 'android { namespace = "com.example.core" }\n')
  await moduleDir(root, 'app', 'android { namespace = "com.example.app"\n defaultConfig { applicationId = "com.example.app" } }\n', true)
  await moduleDir(root, 'feature/login', 'android { namespace = "com.example.feature.login" }\n', true)

  const rt = runtimeAt(root, path.join(root, 'data'))
  const found = await discover(rt, root)
  assert.equal(found.applicationModule, ':app')
  assert.equal(found.applicationIds[0], 'com.example.app')
  assert.equal(await applicationIdFor(root, ':app'), 'com.example.app')
  // A nested module's output lives under `feature/login`, not `feature:login`.
  assert.ok((await findApks(root, [':feature:login'])).some((file) => file.endsWith('login-debug.apk')))
})

test('buildApp defaults to the application module and its application id', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-build-'))
  await writeFile(path.join(root, 'settings.gradle.kts'), 'include(":core")\ninclude(":app")\n', 'utf8')
  await moduleDir(root, 'core', 'android { namespace = "com.example.core" }\n')
  await moduleDir(root, 'app', 'android { namespace = "com.example.app"\n defaultConfig { applicationId = "com.example.app" } }\n', true)
  await fakeGradle(root)

  const report = await buildApp(runtimeAt(root, path.join(root, 'data')), {})
  assert.equal(report.module, 'app')
  assert.equal(report.task, ':app:assembleDebug')
  assert.equal(report.applicationId, 'com.example.app')
  assert.ok(report.apkPath?.endsWith('app-debug.apk'))
})

test('buildApp refuses a non-positive timeoutMs instead of killing Gradle at once', async () => {
  // The device tools reject a non-positive override, but the build path used to
  // pass it straight to setTimeout: `timeoutMs: 0` killed Gradle in milliseconds
  // and reported `timedOut: true` with an empty output and no diagnostics.
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-timeout-'))
  await writeFile(path.join(root, 'settings.gradle.kts'), 'include(":app")\n', 'utf8')
  await moduleDir(root, 'app', 'android { defaultConfig { applicationId = "com.example.app" } }\n', true)
  await fakeGradle(root)

  const rt = runtimeAt(root, path.join(root, 'data'))
  await assert.rejects(() => buildApp(rt, { timeoutMs: 0 }), /Invalid timeoutMs: 0/)
  await assert.rejects(() => buildApp(rt, { timeoutMs: -5 }), /Invalid timeoutMs: -5/)
})

test('a failed build-log write does not replace a successful build result', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-log-'))
  await writeFile(path.join(root, 'settings.gradle.kts'), 'include(":app")\n', 'utf8')
  await moduleDir(root, 'app', 'android { defaultConfig { applicationId = "com.example.app" } }\n', true)
  await fakeGradle(root)

  // A regular file where the data directory belongs: mkdir('logs') fails.
  const blocked = path.join(root, 'not-a-directory')
  await writeFile(blocked, 'x', 'utf8')
  const warnings = []
  const rt = createRuntime({
    config: {
      dataDir: { get: () => blocked },
      buildTimeoutSeconds: { get: () => 30 },
      // Keep the plugin's own SDK discovery out of the way, exactly as
      // `runtimeAt` does: the wrapper this test runs is the fake at the root.
      sdkPath: { get: () => root },
    },
    cwd: root,
    env: { ...process.env },
    logger: { info() {}, warn: (message) => warnings.push(message), error() {} },
  })

  const report = await buildApp(rt, {})
  assert.equal(report.ok, true)
  assert.equal(report.logPath, undefined)
  assert.ok(warnings.some((message) => /build log/.test(message)))
})

test('aapt2 badging parsing reads the package the APK was built with', () => {
  // The header line aapt2 prints. This is the only record of the *built*
  // package: the base id lives in the build script, while an
  // applicationIdSuffix or a flavor is applied by AGP at build time.
  const badging = [
    "package: name='com.example.base.debug' versionCode='1' versionName='1.0' platformBuildVersionName='15'",
    "sdkVersion:'23'",
    "targetSdkVersion:'35'",
    "application-label:'Demo'",
  ].join('\n')
  assert.equal(parseAaptBadging(badging), 'com.example.base.debug')
  // aapt (1) and some wrappers quote with double quotes.
  assert.equal(parseAaptBadging('package: name="com.example.quoted" versionCode="1"'), 'com.example.quoted')
  assert.equal(parseAaptBadging('W/ziparchive: unable to open'), undefined)
  assert.equal(parseAaptBadging(''), undefined)
})

test('buildApp reads the real package name from the built APK', async () => {
  // A project whose build script names the base id but whose debug build gets
  // an `applicationIdSuffix`; the installed package is `...base.debug`, while
  // the build script only says `...base`. Launching the script's value starts
  // nothing (or a stale build of the base package).
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-apkid-'))
  await writeFile(path.join(root, 'settings.gradle.kts'), 'include(":app")\n', 'utf8')
  await moduleDir(
    root,
    'app',
    [
      'android {',
      '  defaultConfig { applicationId = "com.example.base" }',
      '  buildTypes { debug { applicationIdSuffix = ".debug" } }',
      '}',
      '',
    ].join('\n'),
    true,
  )
  await fakeGradle(root)
  const data = path.join(root, 'data')
  await fakeAapt2(data, [
    { out: "package: name='com.example.base.debug' versionCode='1' versionName='1.0'" },
    { exit: 0 },
  ])

  const report = await buildApp(runtimeAt(root, data), {})
  assert.equal(report.ok, true)
  assert.equal(report.applicationId, 'com.example.base.debug')
  assert.equal(report.applicationIdSource, 'apk')
  assert.equal(report.apkApplicationId, 'com.example.base.debug')
  assert.equal(report.applicationIdNote, undefined)
})

test('buildApp says when aapt2 is missing and the id comes from the build script', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-noaapt-'))
  await writeFile(path.join(root, 'settings.gradle.kts'), 'include(":app")\n', 'utf8')
  await moduleDir(root, 'app', 'android { defaultConfig { applicationId = "com.example.app" } }\n', true)
  await fakeGradle(root)

  // The pinned SDK root holds no `build-tools`, so no aapt2 can be resolved.
  const report = await buildApp(runtimeAt(root, path.join(root, 'data')), {})
  assert.equal(report.ok, true)
  assert.equal(report.applicationId, 'com.example.app')
  assert.equal(report.applicationIdSource, 'build-script')
  assert.equal(report.apkApplicationId, undefined)
  assert.match(report.applicationIdNote ?? '', /aapt2 was not found under the SDK build-tools/)
})

test('buildApp says when aapt2 could not read the APK', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-badaapt-'))
  await writeFile(path.join(root, 'settings.gradle.kts'), 'include(":app")\n', 'utf8')
  await moduleDir(root, 'app', 'android { defaultConfig { applicationId = "com.example.app" } }\n', true)
  await fakeGradle(root)
  const data = path.join(root, 'data')
  await fakeAapt2(data, [{ err: 'ERROR: dump failed', exit: 1 }])

  const report = await buildApp(runtimeAt(root, data), {})
  assert.equal(report.applicationIdSource, 'build-script')
  assert.match(report.applicationIdNote ?? '', /aapt2 could not read the APK application id/)
})

test('buildApp reports candidates instead of guessing an ambiguous flavor APK', async () => {
  // Two flavors produce two products in the same variant: without a flavor in
  // the variant name no product can be called "the" debug APK. Reporting the
  // candidates lets build_and_run fail with a message that names them instead
  // of installing whichever readdir returned first. The products use the
  // layout AGP 8 actually writes: `apk/<flavor>/<buildType>/`.
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-flavor-'))
  await writeFile(path.join(root, 'settings.gradle.kts'), 'include(":app")\n', 'utf8')
  const app = path.join(root, 'app')
  await mkdir(app, { recursive: true })
  await writeFile(
    path.join(app, 'build.gradle.kts'),
    [
      'android {',
      '  defaultConfig { applicationId = "com.example.app" }',
      '  productFlavors {',
      '    free { }',
      '    paid { }',
      '  }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  )
  const expected = []
  for (const [flavor, file] of [
    ['free', 'app-free-debug.apk'],
    ['paid', 'app-paid-debug.apk'],
  ]) {
    const out = path.join(app, 'build', 'outputs', 'apk', flavor, 'debug')
    await mkdir(out, { recursive: true })
    await writeFile(path.join(out, file), 'apk', 'utf8')
    expected.push(path.join('app', 'build', 'outputs', 'apk', flavor, 'debug', file))
  }
  await fakeGradle(root)

  // `debug` does not name a flavored product, and both file names end in
  // `-debug.apk`, so the result has candidates but no single product.
  const report = await buildApp(runtimeAt(root, path.join(root, 'data')), { variant: 'debug' })
  assert.equal(report.ok, true)
  assert.equal(report.apkPath, undefined)
  assert.deepEqual([...(report.apkCandidates ?? [])].sort(), expected.sort())
})

test('buildApp picks the flavored APK the discovered variant names', async () => {
  // The default variant of a flavored project is `freeDebug`, and AGP puts
  // that product at `apk/free/debug/`. Selection has to join the flavor and
  // build-type directory segments to see the variant name.
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-flavor-default-'))
  await writeFile(path.join(root, 'settings.gradle.kts'), 'include(":app")\n', 'utf8')
  const app = path.join(root, 'app')
  await mkdir(app, { recursive: true })
  await writeFile(
    path.join(app, 'build.gradle.kts'),
    [
      'android {',
      '  defaultConfig { applicationId = "com.example.app" }',
      '  productFlavors {',
      '    free { }',
      '    paid { }',
      '  }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  )
  for (const [flavor, file] of [
    ['free', 'app-free-debug.apk'],
    ['paid', 'app-paid-debug.apk'],
  ]) {
    const out = path.join(app, 'build', 'outputs', 'apk', flavor, 'debug')
    await mkdir(out, { recursive: true })
    await writeFile(path.join(out, file), 'apk', 'utf8')
  }
  await fakeGradle(root)

  const report = await buildApp(runtimeAt(root, path.join(root, 'data')), {})
  assert.equal(report.ok, true)
  assert.equal(report.variant, 'freeDebug')
  assert.equal(report.task, ':app:assembleFreeDebug')
  assert.equal(report.apkPath, path.join('app', 'build', 'outputs', 'apk', 'free', 'debug', 'app-free-debug.apk'))
  assert.equal(report.apkCandidates, undefined)
})

test('a generated wrapper is clamped to the Android Gradle Plugin floor', async () => {
  // AGP 8.7.3 requires Gradle >= 8.9. Pinning the wrapper to the installed 8.5
  // would emit a wrapper the generated project cannot configure, so the wrapper
  // task is asked for 8.9 instead.
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-wrapper-'))
  await writeFile(path.join(root, 'settings.gradle.kts'), 'include(":app")\n', 'utf8')
  await moduleDir(root, 'app', 'android { defaultConfig { applicationId = "com.example.app" } }\n', true)
  const bin = path.join(root, 'bin')
  await mkdir(bin, { recursive: true })
  const argv = path.join(root, 'gradle-argv.txt')
  await writeFakeTool(bin, 'gradle', [
    { appendLines: argv },
    { ifArg: [1, '--version'], then: [{ out: 'Gradle 8.5' }, { exit: 0 }] },
    { exit: 0 },
  ])

  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` }
  const report = await buildApp(runtimeAt(root, path.join(root, 'data'), env), {})
  assert.equal(report.ok, true)
  const calls = (await readFile(argv, 'utf8')).split(/\r?\n/).filter((line) => line.length > 0)
  const at = calls.indexOf('--gradle-version')
  assert.notEqual(at, -1, 'the wrapper task is asked for an explicit Gradle version')
  assert.equal(calls[at + 1], '8.9', 'an installed Gradle below the AGP floor is clamped up')
})

test('wrapper pinning keeps an installed Gradle at or above the floor', () => {
  assert.equal(wrapperGradleVersion('8.5'), '8.9')
  assert.equal(wrapperGradleVersion('8.0.2'), '8.9')
  assert.equal(wrapperGradleVersion('8.9'), '8.9')
  assert.equal(wrapperGradleVersion('8.12.1'), '8.12.1')
  assert.equal(wrapperGradleVersion('9.0'), '9.0')
  assert.equal(wrapperGradleVersion(undefined), '8.9')
  assert.equal(wrapperGradleVersion('not-a-version'), '8.9')
})
