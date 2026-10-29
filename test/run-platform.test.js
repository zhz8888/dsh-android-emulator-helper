import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { cmdQuote, run } from '../lib/util/run.js'

/**
 * The command line `cmd.exe` reads, and the batch files it launches.
 *
 * Windows cannot start a batch file directly, so a `.bat`/`.cmd` is handed to
 * `cmd.exe`, which parses the rest of the line as **text** rather than as
 * arguments. Two of its rules decide whether a tool starts at all: a leading
 * quote makes it strip the first quote and remove the last one, and `%NAME%`
 * is a variable reference that expands before the batch file sees it. Both are
 * pinned here, because both fail silently — the call returns an exit code and
 * nothing says the argument was split or rewritten.
 */

/** A scratch directory that is removed when the test ends. */
async function scratch(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-run-'))
  t.after(async () => {
    const { rm } = await import('node:fs/promises')
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

// ---------------------------------------------------------------------------
// Quoting one token
// ---------------------------------------------------------------------------

test('a token with a space keeps its quotes', () => {
  assert.equal(cmdQuote('C:\\Program Files\\Android\\Sdk'), '"C:\\Program Files\\Android\\Sdk"')
})

test('a plain token is left alone', () => {
  assert.equal(cmdQuote('--version'), '--version')
  assert.equal(
    cmdQuote('D:\\Android\\Sdk\\cmdline-tools\\latest\\bin\\sdkmanager.bat'),
    'D:\\Android\\Sdk\\cmdline-tools\\latest\\bin\\sdkmanager.bat',
  )
})

test('a percent sign is escaped so cmd.exe does not expand it', () => {
  // `%NAME%` is a variable reference and cmd.exe expands it before the batch
  // file sees the argument; the caret is what stops that.
  assert.equal(cmdQuote('--flag=%PATH%'), '--flag=^%PATH^%')
  assert.equal(cmdQuote('100%'), '100^%')
})

test('a command metacharacter is escaped with a caret', () => {
  assert.equal(cmdQuote('a&b'), 'a^&b')
  assert.equal(cmdQuote('a|b'), 'a^|b')
  assert.equal(cmdQuote('a^b'), 'a^^b')
})

test('an empty token is quoted so it survives', () => {
  assert.equal(cmdQuote(''), '""')
})

// ---------------------------------------------------------------------------
// Launching a batch file
// ---------------------------------------------------------------------------

test('a .bat in a directory with a space keeps its arguments', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await scratch(t)
  const nested = path.join(dir, 'a directory', 'nested')
  await mkdir(nested, { recursive: true })
  const bat = path.join(nested, 'my tool.bat')
  await writeFile(bat, '@echo off\r\necho ARGS=[%*]\r\n')
  const out = await run([bat, 'list', 'extra arg'], { timeout: 20_000 })
  assert.equal(out.code, 0)
  // `cmd.exe` reads a command line as text: without the quoting this route
  // does, the path is split at its first space and the tool never starts.
  assert.match(out.stdout, /ARGS=\[list "extra arg"\]/)
})

test('a .bat reports its own exit code', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await scratch(t)
  const bat = path.join(dir, 'fail.bat')
  await writeFile(bat, '@echo off\r\nexit /b 7\r\n')
  const out = await run([bat], { timeout: 20_000 })
  assert.equal(out.code, 7)
})
