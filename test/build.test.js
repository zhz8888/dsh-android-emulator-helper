import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { applicationIdFor, discover, findApks } from '../lib/providers/project.js'
import { buildApp } from '../lib/providers/build.js'
import { createRuntime } from '../lib/runtime.js'

/**
 * Multi-module target resolution and build-result durability.
 *
 * `settings.gradle` lists modules but never says which one is the application,
 * and Gradle's `:feature:login` is the directory `feature/login`. The default
 * build target and the application id both depend on getting that right, so
 * these tests build a real (fake-Gradle) project on disk instead of asserting
 * the helpers in isolation.
 */

const POSIX = process.platform !== 'win32'

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

/** A runtime rooted at one scratch project. */
function runtimeAt(project, dataDir) {
  return createRuntime({
    config: {
      dataDir: { get: () => dataDir },
      buildTimeoutSeconds: { get: () => 30 },
    },
    cwd: project,
    env: { ...process.env, PATH: '/usr/bin:/bin' },
    logger: { info() {}, warn() {}, error() {} },
  })
}

/** A fake Gradle launcher that records its argv and exits 0. */
async function fakeGradle(project) {
  const file = path.join(project, 'gradlew')
  await writeFile(file, '#!/bin/sh\nprintf "%s\\n" "$@" > "$(dirname "$0")/gradle-argv.txt"\nexit 0\n', 'utf8')
  await chmod(file, 0o755)
}

test('the application module is identified, not assumed to be the first include', { skip: !POSIX }, async () => {
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

test('buildApp defaults to the application module and its application id', { skip: !POSIX }, async () => {
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

test('a failed build-log write does not replace a successful build result', { skip: !POSIX }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aemh-log-'))
  await writeFile(path.join(root, 'settings.gradle.kts'), 'include(":app")\n', 'utf8')
  await moduleDir(root, 'app', 'android { defaultConfig { applicationId = "com.example.app" } }\n', true)
  await fakeGradle(root)

  // A regular file where the data directory belongs: mkdir('logs') fails.
  const blocked = path.join(root, 'not-a-directory')
  await writeFile(blocked, 'x', 'utf8')
  const warnings = []
  const rt = createRuntime({
    config: { dataDir: { get: () => blocked }, buildTimeoutSeconds: { get: () => 30 } },
    cwd: root,
    env: { ...process.env, PATH: '/usr/bin:/bin' },
    logger: { info() {}, warn: (message) => warnings.push(message), error() {} },
  })

  const report = await buildApp(rt, {})
  assert.equal(report.ok, true)
  assert.equal(report.logPath, undefined)
  assert.ok(warnings.some((message) => /build log/.test(message)))
})
