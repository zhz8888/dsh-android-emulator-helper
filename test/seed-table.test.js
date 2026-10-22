import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { STATIC_MODULES } from './helpers/load-bundle.mjs'

/**
 * The shell's static module table.
 *
 * A client bundle may only `require` what the DSH web shell serves, so the
 * table this repository pins has to be the shell's own seed table. It used to
 * be shorter than the shell's, which made the helper refuse a bundle the shell
 * would have loaded — a stricter list is a bug, not extra safety. The shipped
 * SPA is the source of truth; the test below reads it when DSH is installed
 * and skips when it is not, because the suite itself is hermetic.
 */

/** Where the installed desktop app keeps the web frontend's built assets. */
const SPA_ASSETS =
  '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets'

/**
 * The object literal that starts at the first `{` after `from`.
 *
 * @param {string} source - the bundle source.
 * @param {number} from - the offset to start looking at.
 * @returns {string|null} the literal, or null when it is not closed.
 */
function objectLiteralAfter(source, from) {
  const start = source.indexOf('{', from)
  if (start === -1) return null
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return null
}

/**
 * The specifiers the installed shell's seed table serves.
 *
 * The SPA builds the table once and hands it to the module loader as
 * `staticModules`; the table is an object literal whose keys are the
 * specifiers. This resolves that literal out of the installed bundle.
 *
 * @returns {string[]|null} the specifiers, or null when no SPA is installed.
 */
function installedShellSeed() {
  if (!existsSync(SPA_ASSETS)) return null
  for (const file of readdirSync(SPA_ASSETS).filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(path.join(SPA_ASSETS, file), 'utf8')
    const marker = /staticModules:([A-Za-z_$][\w$]*)\s*\(/.exec(source)
    if (marker === null) continue
    const definition = source.indexOf(`function ${marker[1]}`)
    if (definition === -1) continue
    const returned = source.indexOf('return', definition)
    const literal = objectLiteralAfter(source, returned)
    if (literal === null) continue
    const keys = [...literal.matchAll(/(?:"([^"]*)"|([A-Za-z_$][\w$]*))\s*:/g)].map((match) => match[1] ?? match[2])
    if (!keys.includes('react/jsx-runtime')) continue
    return keys
  }
  return null
}

test('the seed table matches the installed shell', (t) => {
  // This is the only assertion that compares the repository's table with a real
  // shell. Both arrays used to live in this repository, so the test compared two
  // hand-written copies and would stay green on any machine without a DSH
  // install; when there is no harness to read, skipping is more honest than
  // "passing" against itself.
  const seed = installedShellSeed()
  if (seed === null) {
    t.skip('no installed DSH web frontend to compare the seed table against')
    return
  }
  assert.deepEqual([...STATIC_MODULES].sort(), [...seed].sort())
})
