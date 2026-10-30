import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { cmdQuote, platformCommand, run } from '../lib/util/run.js'

/**
 * The command line `cmd.exe` reads, and the batch files it launches.
 *
 * Windows cannot start a batch file directly, so a `.bat`/`.cmd` is handed to
 * `cmd.exe`, which parses the rest of the line as **text** rather than as
 * arguments. `cmd.exe` also reparses what it is handed, which is why a caret
 * escape written by the parent is not a safe way to protect a metacharacter:
 * the old implementation escaped `&` with a caret and the batch file then
 * never ran at all, while `cmd.exe` still returned exit code 0. Every token is
 * quoted instead, and the three characters a batch argument cannot carry are
 * refused rather than rewritten.
 *
 * These rules are pinned here because they fail silently: the call returns an
 * exit code and nothing says the argument was split or the batch skipped.
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

test('a token is always quoted, even when it holds no special character', () => {
  assert.equal(cmdQuote('--version'), '"--version"')
  assert.equal(
    cmdQuote('D:\\Android\\Sdk\\cmdline-tools\\latest\\bin\\sdkmanager.bat'),
    '"D:\\Android\\Sdk\\cmdline-tools\\latest\\bin\\sdkmanager.bat"',
  )
})

test('whitespace stays inside the quotes', () => {
  assert.equal(cmdQuote('C:\\Program Files\\Android\\Sdk'), '"C:\\Program Files\\Android\\Sdk"')
  assert.equal(cmdQuote('extra arg'), '"extra arg"')
})

test('a command metacharacter stays literal inside the quotes', () => {
  assert.equal(cmdQuote('a&b'), '"a&b"')
  assert.equal(cmdQuote('a|b'), '"a|b"')
  assert.equal(cmdQuote('a>b'), '"a>b"')
  assert.equal(cmdQuote('a<b'), '"a<b"')
  assert.equal(cmdQuote('a^b'), '"a^b"')
  assert.equal(cmdQuote('a(b)'), '"a(b)"')
})

test('an empty token is quoted so it survives', () => {
  assert.equal(cmdQuote(''), '""')
})

test('an argument containing a percent variable reference is refused', () => {
  // `%NAME%` expands even inside double quotes, so quoting cannot protect it.
  // The environment is explicit: the rule asks whether the child has the
  // variable, so the test must not depend on the machine's own environment.
  assert.throws(() => cmdQuote('--flag=%PATH%', { PATH: '/bin' }), /batch variable/)
  assert.throws(() => cmdQuote('%TEMP%', { TEMP: 'C:\\Temp' }), /batch variable/)
  assert.throws(() => cmdQuote('%CD%', {}), /batch variable/, 'cmd.exe defines CD itself')
  assert.throws(() => cmdQuote('%PATH:~0,3%', { PATH: '/bin' }), /batch variable/, 'a substring reference expands too')
})

test('a percent reference to an undefined variable is safe and stays literal', () => {
  // `input text` writes a space as `%s`; once two spaces are typed the
  // argument looks like `%s…%`, which is not a variable cmd.exe knows.
  assert.equal(cmdQuote('%s'), '"%s"')
  assert.equal(cmdQuote('a%sb%sc'), '"a%sb%sc"')
  assert.equal(cmdQuote('%NOT_A_DEFINED_VARIABLE%', {}), '"%NOT_A_DEFINED_VARIABLE%"')
  assert.equal(cmdQuote('100%'), '"100%"')
  assert.equal(cmdQuote('a%%b'), '"a%%b"')
})

test('an argument containing a double quote is refused', () => {
  assert.throws(() => cmdQuote('say "hi"'), /double quote/)
})

test('an argument containing a line break is refused', () => {
  assert.throws(() => cmdQuote('a\nb'), /line break/)
  assert.throws(() => cmdQuote('a\rb'), /line break/)
})

// ---------------------------------------------------------------------------
// Building the cmd.exe command line
// ---------------------------------------------------------------------------

test(
  'a batch file is routed through cmd.exe with every token quoted',
  { skip: process.platform !== 'win32' },
  () => {
    const { argv, verbatim } = platformCommand(['C:\\a directory\\my tool.bat', 'a&b'])
    assert.equal(verbatim, true)
    assert.deepEqual(argv.slice(0, 4), ['cmd.exe', '/d', '/s', '/c'])
    assert.equal(argv[4], '""C:\\a directory\\my tool.bat" "a&b""')
  },
)

test('a non-batch tool is spawned directly', { skip: process.platform === 'win32' }, () => {
  assert.deepEqual(platformCommand(['/usr/bin/adb', 'devices']), {
    argv: ['/usr/bin/adb', 'devices'],
    verbatim: false,
  })
})

test('a Windows executable is spawned directly', { skip: process.platform !== 'win32' }, () => {
  assert.deepEqual(platformCommand(['C:\\Sdk\\platform-tools\\adb.exe', 'devices']), {
    argv: ['C:\\Sdk\\platform-tools\\adb.exe', 'devices'],
    verbatim: false,
  })
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
  assert.match(out.stdout, /ARGS=\["list" "extra arg"\]/)
})

test('a .bat whose path contains & still runs', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await scratch(t)
  const nested = path.join(dir, 'R&D tools')
  await mkdir(nested, { recursive: true })
  const bat = path.join(nested, 'probe.bat')
  await writeFile(bat, '@echo off\r\necho RAN=[%*]\r\n')
  const out = await run([bat, 'ok'], { timeout: 20_000 })
  assert.equal(out.code, 0, out.stderr)
  assert.match(out.stdout, /RAN=\["ok"\]/)
})

test('metacharacters in an argument reach the batch file unchanged', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await scratch(t)
  const bat = path.join(dir, 'args.bat')
  await writeFile(bat, '@echo off\r\necho ARGS=[%*]\r\n')
  for (const value of ['a&b', 'a|b', 'a>b', 'a<b', 'a^b', 'a(b)']) {
    const out = await run([bat, value], { timeout: 20_000 })
    assert.equal(out.code, 0, value)
    assert.ok(out.stdout.includes(`"${value}"`), `${value} arrived as ${JSON.stringify(out.stdout)}`)
  }
})

test(
  'a lone percent sign reaches the batch file unchanged',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const dir = await scratch(t)
    const bat = path.join(dir, 'percent.bat')
    await writeFile(bat, '@echo off\r\necho ARGS=[%*]\r\n')
    const out = await run([bat, '%s', '100%'], { timeout: 20_000 })
    assert.equal(out.code, 0, out.stderr)
    assert.match(out.stdout, /ARGS=\["%s" "100%"\]/)
  },
)

test('an argument a batch file cannot carry is refused before anything runs', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await scratch(t)
  const bat = path.join(dir, 'never.bat')
  await writeFile(bat, '@echo off\r\necho SHOULD-NOT-RUN\r\n')
  await assert.rejects(() => run([bat, '%PATH%'], { timeout: 20_000 }), /batch variable/)
  await assert.rejects(() => run([bat, 'say "hi"'], { timeout: 20_000 }), /double quote/)
  await assert.rejects(() => run([bat, 'a\nb'], { timeout: 20_000 }), /line break/)
})

test('a .bat reports its own exit code', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await scratch(t)
  const bat = path.join(dir, 'fail.bat')
  await writeFile(bat, '@echo off\r\nexit /b 7\r\n')
  const out = await run([bat], { timeout: 20_000 })
  assert.equal(out.code, 7)
})
