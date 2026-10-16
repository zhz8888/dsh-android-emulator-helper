import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Contract tests for the package manifest and the Cordis patch.
 *
 * These are the fields DSH reads before it ever loads the plugin, so a wrong
 * value fails the whole profile boot rather than one tool call.
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

test('package name is the client module id', () => {
  // The web shell keys its module graph by the package name and the bundle id
  // must match it, so this name is load-bearing in three places.
  assert.equal(manifest.name, 'dsh-android-emulator-helper')
  const source = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.match(source, /id: "dsh-android-emulator-helper"/)
})

test('exports the host half and the client bundle', () => {
  assert.equal(manifest.exports['.'].default, './lib/index.js')
  assert.equal(manifest.exports['./client'].default, './lib/client.js')
  assert.equal(manifest.type, 'module')
})

test('declares the bundle patch and a web client half', () => {
  assert.equal(manifest.dsh.manifestVersion, 1)
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(Array.isArray(manifest.dsh.client.inject))
})

test('the shipped files list covers every path the host reads at runtime', () => {
  for (const required of ['lib', 'skills', 'cordis.patch.yml']) {
    assert.ok(manifest.files.includes(required), `files must include ${required}`)
  }
})

test('the patch mounts exactly one row whose id is the settings namespace', () => {
  const patch = readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8')
  const inserts = [...patch.matchAll(/^\s*-\s+id:\s*(\S+)\s*$/gm)].map((match) => match[1])
  assert.deepEqual(inserts, ['android-emulator-helper'])
  assert.match(patch, /name:\s*'dsh-android-emulator-helper'/)
  const source = readFileSync(path.join(ROOT, 'lib', 'settings.js'), 'utf8')
  assert.match(source, /SETTINGS_NAMESPACE = 'android-emulator-helper'/)
})
