import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pickApk } from '../lib/providers/build.js'
import { create, discover, KOTLIN_HARD_KEYWORDS, variantsFromBuildFile } from '../lib/providers/project.js'
import { createRuntime } from '../lib/runtime.js'

/**
 * Pure and on-disk tests for project discovery and creation.
 *
 * `android_discover_project` describes a project, and `android_create_app`
 * writes one that must build as-is. Both are easy to get subtly wrong in ways
 * only a real file tree shows: a variant list that names products no build
 * type produces, or a generated package declaration Kotlin rejects.
 */

/**
 * A runtime rooted at one scratch project.
 *
 * `sdkPath` is pinned to a directory that holds no SDK, so creating a project
 * on a developer machine does not pick up that machine's real SDK for the
 * generated `local.properties`.
 *
 * @param {string} root - the session workspace.
 * @param {Record<string, {get: () => unknown}>} [config] - extra live settings.
 * @returns {import('../lib/runtime.js').Runtime} the runtime.
 */
function runtimeAt(root, config = {}) {
  return createRuntime({
    config: {
      dataDir: { get: () => path.join(root, 'data') },
      sdkPath: { get: () => path.join(root, 'no-sdk') },
      ...config,
    },
    cwd: root,
    env: { ...process.env, HOME: root, USERPROFILE: root, ANDROID_AVD_HOME: path.join(root, 'avd') },
  })
}

/**
 * Write one module's build file.
 *
 * @param {string} root - the project root.
 * @param {string} module - the module directory, using `/` separators.
 * @param {string} build - the module's build file body.
 * @returns {Promise<void>} resolves when the module is on disk.
 */
async function writeModule(root, module, build) {
  const dir = path.join(root, ...module.split('/'))
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'build.gradle.kts'), build, 'utf8')
}

test('APK selection matches only the build/outputs part of a path', () => {
  // The workspace itself is named `release`; the stale debug product's
  // absolute path therefore also contains `\release\`, which the old
  // `includes('/release/')` predicate treated as a match.
  const hits = [
    'E:\\release\\app\\build\\outputs\\apk\\debug\\app-debug.apk',
    'E:\\release\\app\\build\\outputs\\apk\\release\\app-release.apk',
  ]
  assert.equal(
    pickApk(hits, 'release'),
    'E:\\release\\app\\build\\outputs\\apk\\release\\app-release.apk',
    'the variant directory decides, not the workspace name',
  )
})

test('APK selection understands both flavored output layouts', () => {
  // AGP 8 writes a flavored product to `apk/<flavor>/<buildType>/`, while
  // older releases (and the fixtures this suite used before) write
  // `apk/<flavor><BuildType>/`. Both name the same variant.
  const nested = '/p/app/build/outputs/apk/free/debug/app-free-debug.apk'
  const single = '/p/app/build/outputs/apk/freeDebug/app-free-debug.apk'
  const plain = '/p/app/build/outputs/apk/debug/app-debug.apk'
  assert.equal(pickApk([nested], 'freeDebug'), nested)
  assert.equal(pickApk([single], 'freeDebug'), single)
  assert.equal(pickApk([plain], 'debug'), plain)
  // Gradle's variant name and its product file name do not agree on
  // separators; neither does the caller's spelling have to.
  assert.equal(pickApk([single], 'free-debug'), single)
  assert.equal(pickApk([nested], 'free_debug'), nested)
  // The file-name fallback covers a product placed directly under `apk/`.
  const flat = '/p/app/build/outputs/apk/app-free-debug.apk'
  assert.equal(pickApk([flat], 'freeDebug'), flat)
})

test('APK selection refuses to guess between two flavors', () => {
  const hits = [
    '/p/app/build/outputs/apk/free/debug/app-free-debug.apk',
    '/p/app/build/outputs/apk/paid/debug/app-paid-debug.apk',
  ]
  // `debug` matches both products' `-debug.apk` suffix, so neither is "the"
  // debug APK; the caller gets the candidate list and can ask for a flavor
  // variant instead. A full flavor variant resolves its own directory.
  assert.equal(pickApk(hits, 'debug'), undefined)
  assert.equal(pickApk(hits, 'freeDebug'), hits[0])
  assert.equal(pickApk(hits, 'paidDebug'), hits[1])
  assert.equal(pickApk(hits, 'freeRelease'), undefined)
})

test('APK selection refuses split APKs in one variant directory', () => {
  const hits = [
    '/p/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk',
    '/p/app/build/outputs/apk/debug/app-x86_64-debug.apk',
  ]
  assert.equal(pickApk(hits, 'debug'), undefined)
})

test('APK selection refuses a variant no product matches', () => {
  // Falling back to the first product installed a debug APK when `release`
  // was asked for, and reported it as the release product.
  assert.equal(pickApk(['/p/app/build/outputs/apk/debug/app-debug.apk'], 'release'), undefined)
  assert.equal(pickApk([], 'debug'), undefined)
  assert.equal(pickApk(['/elsewhere/app-debug.apk'], 'debug'), undefined, 'a path outside build/outputs is not a product')
})

test('variants combine product flavors with build types', () => {
  const kotlin = [
    'android {',
    '    buildTypes {',
    '        release { isMinifyEnabled = false }',
    '        create("staging") { signingConfig = signingConfigs.getByName("debug") }',
    '    }',
    '    productFlavors {',
    '        free { dimension = "tier" }',
    '        paid { dimension = "tier" }',
    '    }',
    '}',
  ].join('\n')
  // Gradle names a flavored variant `flavor` + capitalized build type, and
  // `debug` stays first because it is the default `buildApp` assembles.
  assert.deepEqual(variantsFromBuildFile(kotlin), [
    'freeDebug',
    'freeRelease',
    'freeStaging',
    'paidDebug',
    'paidRelease',
    'paidStaging',
  ])
})

test('variants understand the Groovy DSL and Kotlin factory forms', () => {
  const groovy = [
    'android {',
    '    buildTypes {',
    '        release { minifyEnabled false }',
    '    }',
    '    productFlavors {',
    '        demo { }',
    '    }',
    '}',
  ].join('\n')
  assert.deepEqual(variantsFromBuildFile(groovy), ['demoDebug', 'demoRelease'])

  const factories = [
    'android {',
    '    buildTypes {',
    '        getByName("release") { }',
    '        maybeCreate("benchmark") { }',
    '    }',
    '}',
  ].join('\n')
  assert.deepEqual(variantsFromBuildFile(factories), ['debug', 'release', 'benchmark'])
})

test('a commented-out block declares no variant and unreadable text falls back to debug', () => {
  const commented = [
    'android {',
    '    // buildTypes { create("staging") { } }',
    '    /* productFlavors { paid { } } */',
    '}',
  ].join('\n')
  assert.deepEqual(variantsFromBuildFile(commented), ['debug', 'release'])
  assert.deepEqual(variantsFromBuildFile(''), ['debug'])
})

test('discover reports the variants the application module declares', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-variants-'))
  await writeFile(path.join(root, 'settings.gradle.kts'), 'include(":app")\n', 'utf8')
  await writeModule(
    root,
    'app',
    [
      'plugins { id("com.android.application") }',
      'android {',
      '    defaultConfig { applicationId = "com.example.app" }',
      '    buildTypes { create("staging") { } }',
      '    productFlavors {',
      '        free { }',
      '        paid { }',
      '    }',
      '}',
    ].join('\n'),
  )

  const found = await discover(runtimeAt(root), root)
  assert.equal(found.applicationModule, ':app')
  assert.deepEqual(found.variants, ['freeDebug', 'freeRelease', 'freeStaging', 'paidDebug', 'paidRelease', 'paidStaging'])
})

test('discover falls back to debug when a project declares no build types', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-novariants-'))
  await writeFile(path.join(root, 'settings.gradle.kts'), 'include(":app")\n', 'utf8')
  await writeModule(
    root,
    'app',
    'plugins { id("com.android.application") }\nandroid { defaultConfig { applicationId = "com.example.app" } }\n',
  )

  const found = await discover(runtimeAt(root), root)
  // `debug` and `release` exist for every application module even when the
  // build file names neither.
  assert.deepEqual(found.variants, ['debug', 'release'])
})

test('create refuses a compileSdk below the template AndroidX floor', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-compilesdk-'))
  const rt = runtimeAt(root)
  await assert.rejects(
    () => create(rt, { name: 'FloorApp', dir: 'FloorApp', compileSdk: 34 }),
    /minCompileSdk is 35/,
    'the error names the dependency that imposes the floor',
  )
  // The setting is a second door into the same value.
  const lowSetting = runtimeAt(root, { apiLevel: { get: () => '34' } })
  await assert.rejects(() => create(lowSetting, { name: 'FloorApp3', dir: 'FloorApp3' }), /minCompileSdk is 35/)

  const report = await create(rt, { name: 'FloorApp', dir: 'FloorApp', compileSdk: 36 })
  assert.equal(report.applicationId, 'com.example.floorapp')
  const build = await readFile(path.join(root, 'FloorApp', 'app', 'build.gradle.kts'), 'utf8')
  assert.match(build, /compileSdk = 36\n/)
})

test('an explicit package name that is a Kotlin hard keyword is refused', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-keyword-'))
  const rt = runtimeAt(root)
  await assert.rejects(
    () => create(rt, { name: 'Keyword', dir: 'Keyword', packageName: 'com.example.when' }),
    /Kotlin hard keyword/,
  )
  await assert.rejects(
    () => create(rt, { name: 'Keyword', dir: 'Keyword', packageName: 'com.example.object.is' }),
    /Kotlin hard keyword/,
  )
  // Soft keywords are legal identifiers, so they must stay accepted.
  const report = await create(rt, { name: 'SoftApp', dir: 'SoftApp', packageName: 'com.example.value.get' })
  assert.equal(report.applicationId, 'com.example.value.get')
})

test('a generated package name avoids a Kotlin hard keyword', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-slug-'))
  const rt = runtimeAt(root)
  const report = await create(rt, { name: 'when', dir: 'KeywordApp' })
  // `com.example.when` does not parse as a Kotlin package declaration; the
  // generated segment gets a safe suffix instead of failing the build later.
  assert.equal(report.applicationId, 'com.example.when_')
  const activity = report.files.find((file) => file.endsWith('MainActivity.kt'))
  assert.ok(activity !== undefined)
  assert.ok(activity.includes(`${path.sep}when_${path.sep}`), `the package directory is escaped too: ${activity}`)
  const source = await readFile(path.join(root, activity), 'utf8')
  assert.match(source, /^package com\.example\.when_$/m)
})

test('the Kotlin hard-keyword set covers the words that break a package declaration', () => {
  for (const word of [
    'as',
    'break',
    'class',
    'continue',
    'do',
    'else',
    'false',
    'for',
    'fun',
    'if',
    'import',
    'in',
    'interface',
    'is',
    'null',
    'object',
    'package',
    'return',
    'super',
    'this',
    'throw',
    'true',
    'try',
    'typealias',
    'typeof',
    'val',
    'var',
    'when',
    'while',
  ]) {
    assert.equal(KOTLIN_HARD_KEYWORDS.has(word), true, `${word} is a Kotlin hard keyword`)
  }
  for (const soft of ['value', 'get', 'set', 'field', 'where', 'by']) {
    assert.equal(KOTLIN_HARD_KEYWORDS.has(soft), false, `${soft} is a soft keyword and a legal identifier`)
  }
})
