import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, pixelAt } from './helpers/decode-png.mjs'

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

/**
 * Find the dark blobs in a decoded icon, eight-connected.
 *
 * The Android head draws exactly two dark marks — its eyes — so a blob count
 * above two means a stray mark was painted in, and an eye that has grown is one
 * that something merged into. Only pixels that are both opaque enough and dark
 * enough count, which keeps the antialiased edges out of it; eight-connectivity
 * then keeps a single borderline pixel on an eye's rim from reading as a mark of
 * its own.
 *
 * @param {{width: number, height: number, data: Buffer}} image - a decoded icon.
 * @returns {Array<{area: number, width: number, height: number}>} the blobs.
 */
function darkBlobs(image) {
  const { width, height } = image
  const seen = new Uint8Array(width * height)
  const isDark = (x, y) => {
    const { r, g, b, a } = pixelAt(image, x, y)
    return a >= 128 && 0.299 * r + 0.587 * g + 0.114 * b < 60
  }
  const neighbours = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ]
  const blobs = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (seen[y * width + x] || !isDark(x, y)) continue
      seen[y * width + x] = 1
      const stack = [[x, y]]
      let area = 0
      let minX = x
      let maxX = x
      let minY = y
      let maxY = y
      while (stack.length > 0) {
        const [cx, cy] = stack.pop()
        area += 1
        if (cx < minX) minX = cx
        if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy
        if (cy > maxY) maxY = cy
        for (const [dx, dy] of neighbours) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          if (seen[ny * width + nx] || !isDark(nx, ny)) continue
          seen[ny * width + nx] = 1
          stack.push([nx, ny])
        }
      }
      blobs.push({ area, width: maxX - minX + 1, height: maxY - minY + 1 })
    }
  }
  return blobs
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
  assert.equal(dictionaries.en.meta.title, 'Android Emulator Helper')
  assert.equal(dictionaries.zh.meta.title, 'Android 模拟器助手')
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

test('the DSH range is declared identically in all three places', () => {
  // Only the peer range is enforced: `dsh plugin add` resolves the
  // `@deepseek-ai/dsh*` peers, while the harness reads neither `engines.dsh` nor
  // `dsh.compatibility` today. A requirement that is documented but declared
  // somewhere else is worse than none, so the three copies are compared here and
  // `dshReleases` records the release actually exercised.
  const range = manifest.peerDependencies['@deepseek-ai/dsh-tools']
  assert.equal(manifest.engines.dsh, range)
  assert.equal(manifest.dsh.compatibility.dsh, range)
  assert.equal(manifest.dsh.compatibility.dshReleases['0.2.0-rc.2'], 'compatible')
  assert.match(range, /^>=/, 'the DSH requirement must state a lower bound only')
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

test('the icon is a PNG the plugin loader admits', () => {
  // The icon is the one asset a plugin list renders verbatim. `dsh-app-boot`
  // admits SVG, PNG, JPEG and WebP only, resolves the path inside the manifest
  // directory, and refuses anything over 256 KiB — so the format, the square
  // frame and the size budget are all part of the contract.
  assert.equal(manifest.icon, './android-emulator.png')
  const file = path.join(ROOT, 'android-emulator.png')
  assert.ok(existsSync(file), 'the icon the manifest names must exist')
  const bytes = readFileSync(file)
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'the icon must be a PNG',
  )
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  assert.equal(width, height, 'a plugin icon renders in a square seat')
  assert.ok(width >= 128, `too small to stay sharp once a list scales it up: ${width}`)
  assert.ok(bytes.length <= 256 * 1024, 'dsh-app-boot refuses an icon over 256 KiB')
  assert.ok(!existsSync(path.join(ROOT, 'icon.svg')), 'the superseded SVG must be removed')
})

test('the icon keys the artwork tile out without leaving a rim', () => {
  // The upstream artwork sits on a flat #EDF6E9 tile, which reads as a
  // washed-out square in a dark list, so the tile is keyed out here. The key has
  // to stay clean: removing a flat background without carrying the edge colours
  // outwards leaves a rim of half-blended background pixels — invisible on a
  // white page and glaring on the dark theme. So the alpha channel, the
  // transparent corners and the absence of any near-background pixel are all
  // pinned, and the last of the three is why this test decodes the sprite
  // instead of reading its header.
  const image = decodePng(readFileSync(path.join(ROOT, 'android-emulator.png')))
  assert.equal(image.width, 192)
  assert.equal(image.height, 192)
  for (const [x, y] of [
    [0, 0],
    [image.width - 1, 0],
    [0, image.height - 1],
    [image.width - 1, image.height - 1],
  ]) {
    assert.equal(pixelAt(image, x, y).a, 0, `the corner at ${x},${y} must be transparent`)
  }
  // A pixel under 5% coverage cannot read as a rim whatever colour it carries,
  // so only the visible part of the edge is held to the head's own palette. The
  // head's brightest pixel sits near 150; the keyed-out tile was 245.
  let palest = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const { r, g, b, a } = pixelAt(image, x, y)
      if (a < 13) continue
      palest = Math.max(palest, 0.299 * r + 0.587 * g + 0.114 * b)
    }
  }
  assert.ok(palest < 200, `a half-transparent pixel is as pale as the keyed-out tile: ${palest.toFixed(0)}`)
})

test('the icon keeps exactly the two eyes the artwork draws', () => {
  // Carrying the edge colours outwards must not grow the *darkest* pixels: an
  // edge extension applied blindly paints black crescents beside the eyes, which
  // reads as a pair of eyebrows. The head draws exactly two dark marks, they are
  // round, and they are the same size because they are mirror images of each
  // other — so a stray crescent (a third blob) or a crescent merged into an eye
  // (one blob distinctly larger) both fail here.
  const blobs = darkBlobs(decodePng(readFileSync(path.join(ROOT, 'android-emulator.png')))).sort(
    (left, right) => right.area - left.area,
  )
  assert.equal(blobs.length, 2, `expected the two eyes, saw ${blobs.length} dark blobs`)
  for (const blob of blobs) {
    const aspect = Math.max(blob.width, blob.height) / Math.min(blob.width, blob.height)
    assert.ok(aspect < 1.4, `an eye of ${blob.width}x${blob.height} is not round`)
  }
  const [larger, smaller] = blobs
  assert.ok(larger.area / smaller.area < 1.2, `the eyes differ in size: ${larger.area} vs ${smaller.area}`)
})

test('the screenshot manifest lists 1-8 images that exist inside the repo', () => {
  // `screenshots.json` next to package.json is what a plugin market reads for
  // the preview gallery; the paths are relative to it and may not leave the
  // plugin directory. A missing or empty list costs the listing its previews,
  // and a path that climbs out of the repo would be fetched from a file that is
  // not ours, so both are pinned here.
  const file = path.join(ROOT, 'screenshots.json')
  assert.ok(existsSync(file), 'screenshots.json is missing')
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  const list = Array.isArray(parsed) ? parsed : parsed.screenshots
  assert.ok(Array.isArray(list), 'screenshots.json must be a list or {"screenshots": [...]}')
  assert.ok(list.length >= 1 && list.length <= 8, `expected 1-8 screenshots, saw ${list.length}`)
  for (const entry of list) {
    assert.equal(typeof entry, 'string', 'every screenshot entry must be a path')
    assert.ok(!entry.startsWith('/'), `${entry} must be relative to screenshots.json`)
    assert.ok(!entry.split('/').includes('..'), `${entry} must stay inside the plugin directory`)
    assert.match(entry, /\.(png|jpe?g|webp)$/i, `${entry} must be an image`)
    assert.ok(existsSync(path.join(ROOT, entry)), `${entry} is declared but missing`)
  }
})

test('every screenshot the market is shown is embedded in both READMEs', () => {
  // The gallery and the prose are two halves of one listing. A rename that
  // reaches only one of them renders as a broken image on GitHub, and nothing
  // else in this suite would notice, so the two are compared here.
  const declared = JSON.parse(readFileSync(path.join(ROOT, 'screenshots.json'), 'utf8'))
  for (const relative of declared) {
    for (const readme of ['README.md', 'README.zh-CN.md']) {
      const source = readFileSync(path.join(ROOT, readme), 'utf8')
      assert.ok(source.includes(relative), `${readme} does not embed ${relative}`)
    }
  }
})
