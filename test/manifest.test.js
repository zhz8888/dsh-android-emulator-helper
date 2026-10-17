import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Contract tests for the package manifest and the Cordis patch.
 *
 * These are the fields DSH reads before it ever loads the plugin, so a wrong
 * value fails the whole profile boot rather than one tool call. The last group
 * also holds the package to what a plugin-market listing checks: a declared
 * bundle patch that exists, official packages as peers, and publishing metadata
 * that names one repository.
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

/** The repository the publishing metadata has to agree on. */
const REPOSITORY = 'https://github.com/zhz8888/dsh-android-emulator-helper'

/**
 * Collect every `@deepseek-ai/*` module specifier a source tree imports.
 *
 * Only ESM `from '…'` clauses count. The browser bundle reaches shell modules
 * through `require` inside `__ModuleLoader__`, and those are provided by the web
 * shell rather than installed, so they are not dependencies of this package.
 */
function officialImports(...dirs) {
  const found = new Set()
  for (const dir of dirs) {
    for (const relative of readdirSync(path.join(ROOT, dir), { recursive: true })) {
      if (!/\.m?js$/.test(relative)) continue
      const source = readFileSync(path.join(ROOT, dir, relative), 'utf8')
      for (const match of source.matchAll(/\bfrom\s+['"](@deepseek-ai\/[^'"]+)['"]/g)) found.add(match[1])
    }
  }
  return found
}

test('package name is the client module id', () => {
  // The web shell keys its module graph by the package name and the bundle id
  // must match it, so this name is load-bearing in three places: the manifest,
  // the client bundle id, and the row the bundle patch mounts.
  assert.equal(manifest.name, '@zhz8888/dsh-android-emulator-helper')
  const source = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.match(source, /id: "@zhz8888\/dsh-android-emulator-helper"/)
})

test('a plugin list can read a localized display name and description', () => {
  // The harness resolves `<package>/locale/en.json` through the package exports
  // and falls back to the raw package name when it cannot — a fallback with no
  // error anywhere, which is why the export, the shipped directory and the two
  // dictionaries are all pinned here. A missing en.json also drops every other
  // language file, so `en.json` is not optional.
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
  assert.ok(manifest.files.includes('locale'), 'the published package must ship locale/')
  const dictionaries = Object.fromEntries(
    ['en', 'zh'].map((language) => [
      language,
      JSON.parse(readFileSync(path.join(ROOT, 'locale', `${language}.json`), 'utf8')),
    ]),
  )
  assert.equal(dictionaries.en.meta.title, 'Android Emulator')
  assert.equal(dictionaries.zh.meta.title, 'Android 模拟器')
  for (const [language, dictionary] of Object.entries(dictionaries)) {
    assert.ok(dictionary.meta.description.length > 0, `${language} needs a description`)
    assert.ok(!dictionary.meta.title.includes('dsh-'), `${language} must not show the package name`)
  }
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
  assert.match(patch, /name:\s*'@zhz8888\/dsh-android-emulator-helper'/)
  const source = readFileSync(path.join(ROOT, 'lib', 'settings.js'), 'utf8')
  assert.match(source, /SETTINGS_NAMESPACE = 'android-emulator-helper'/)
})

test('the declared bundle patch exists, so the package is installable', () => {
  // `dsh.bundle.patch` is what makes `dsh plugin add` mount the package at all;
  // a path that does not resolve installs the package and then fails the boot.
  assert.ok(existsSync(path.join(ROOT, manifest.dsh.bundle.patch)), `${manifest.dsh.bundle.patch} is missing`)
})

test('every official package the source imports is a peer dependency', () => {
  // Official @deepseek-ai/* packages are provided by the host: the profile
  // already carries them, and resolving to that copy keeps one schemastery
  // instance behind the settings form. Bundling a second copy is the failure
  // this guards against — hence no `dependencies` block at all.
  assert.equal(manifest.dependencies, undefined)
  const imported = officialImports('lib', 'scripts')
  assert.ok(imported.size > 0, 'expected to find official imports')
  for (const specifier of imported) {
    const name = specifier.split('/').slice(0, 2).join('/')
    assert.ok(name in manifest.peerDependencies, `${name} must be a peerDependency, not an installed dependency`)
  }
})

test('the compatibility-gate peers carry no upper bound', () => {
  // DSH matches these with `includePrerelease: true`, while pnpm matches them
  // with the default rules. A `^` or `<` bound is what makes the two disagree:
  // it silently drops the prereleases of the next version tuple, so the harness
  // gate passes and pnpm then fails the user's install with ERESOLVE. Lower
  // bounds only, widened by a release when the floor actually moves.
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    if (!name.startsWith('@deepseek-ai/')) continue
    assert.match(range, /^>=\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, `${name}: ${range} is not a lower-bound-only range`)
  }
})

test('repository, homepage and bugs name the same repository', () => {
  // A published package is linked back to this repository through these fields,
  // and a market entry is accepted only when its url matches the repository
  // exactly — so they are one fact written three times.
  assert.equal(manifest.repository.type, 'git')
  assert.equal(manifest.repository.url, `git+${REPOSITORY}.git`)
  assert.equal(manifest.homepage, `${REPOSITORY}#readme`)
  assert.equal(manifest.bugs.url, `${REPOSITORY}/issues`)
})

test('the files whitelist covers every path the manifest points at', () => {
  // `files` decides what a published tarball contains. Anything the host reads
  // through a manifest field has to survive that filter, or the installed
  // package is missing a file it declared.
  const declared = [
    manifest.main,
    manifest.icon,
    manifest.dsh.bundle.patch,
    ...Object.values(manifest.exports).map((entry) => (typeof entry === 'string' ? entry : entry.default)),
  ]
  for (const relative of declared) {
    if (relative === './package.json') continue // npm always ships it
    const top = relative.replace(/^\.\//, '').split('/')[0]
    assert.ok(manifest.files.includes(top), `${relative} is not covered by files`)
  }
})
