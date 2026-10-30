import { chmod, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Fake command-line tools, described once and rendered for the host.
 *
 * The providers under test drive real child processes, so the suite has to put
 * something on `PATH` that answers like `adb`, `emulator` or `avdmanager`. That
 * something used to be a `/bin/sh` script, which is the one thing a Windows
 * machine cannot run — so every test that needed a fake tool either failed
 * there or was skipped.
 *
 * A fake is therefore described **once**, as a list of steps, and rendered
 * twice: a POSIX shell script on POSIX, and on Windows a Node step script
 * behind a `.cmd` (or `.bat`) launcher. That launcher is the name the plugin
 * resolves on `PATH`, and `cmd.exe` is the only thing Windows can start a
 * script through; it starts the launcher, not the behaviour. The launcher
 * names the absolute `process.execPath` the suite already runs on, so a
 * Windows machine needs neither a PowerShell installation nor a `node` on
 * `PATH`.
 *
 * Windows used to render a PowerShell script. It does not any more: the
 * project's Windows rule is `pwsh` (PowerShell 7) first, `cmd.exe` as the final
 * fallback and never the in-box Windows PowerShell 5.1 (`powershell.exe`). A
 * fake needs no shell at all, so Node carries the behaviour and `cmd.exe` only
 * starts the launcher — which keeps the suite runnable on a stock Windows that
 * has never installed PowerShell 7.
 *
 * The step set is deliberately small: it covers what the fakes actually do —
 * record an argv, print something, branch on an argument or a file, write or
 * copy a file, sleep, and exit with a code.
 *
 * @module @zhz8888/dsh-android-emulator-helper/test/helpers/fake-tool
 */

/**
 * One step of a fake tool.
 *
 * A branch step holds its body in `then`; the steps run in the order they are
 * listed, and only the first matching branch's body runs when that body ends
 * in `exit`.
 *
 * Text values may interpolate `${SUB}` (the sub-command), `${REST}` (the
 * command after it) and `${NAME}` (whatever a capture step stored under that
 * name).
 *
 * @typedef {object} FakeStep
 * @property {string} [record] - append the argv, `|`-joined, plus a newline.
 * @property {string} [recordLines] - write the argv, one argument per line.
 * @property {string} [appendLines] - append the argv, one argument per line.
 * @property {string} [out] - print a line on stdout.
 * @property {string} [outRaw] - print on stdout without a newline.
 * @property {string} [err] - print a line on stderr.
 * @property {number[]} [outBytes] - print raw bytes on stdout.
 * @property {[string, string]} [write] - write text to a file, replacing it.
 * @property {[string, string]} [append] - append text to a file.
 * @property {[string, string]} [copy] - copy a file.
 * @property {string} [cat] - print a file's contents on stdout.
 * @property {string} [stdinTo] - read stdin to end and write it to that file.
 * @property {[number, string]} [ifArg] - branch when that argument equals the value.
 * @property {[number, string]} [ifArgPrefix] - branch when that argument starts with the prefix.
 * @property {string} [ifSub] - branch when the sub-command equals the value.
 * @property {{pattern: string, capture?: string, strip?: string}} [ifRest]
 *   - branch when the command after the sub-command matches the glob; an
 *   optional `capture` receives the command with `strip` removed.
 * @property {string} [ifFile] - branch when that file exists.
 * @property {[string, string]} [ifContentEquals] - branch when that file's contents equal the value.
 * @property {number} [sleep] - sleep for that many seconds.
 * @property {boolean} [hang] - ignore termination and sleep forever.
 * @property {string} [pidTo] - write this process's id to that file.
 * @property {number} [exit] - exit with that code.
 * @property {FakeStep[]} [then] - the steps of a branch.
 */

/** Splits a text into literal parts and `${NAME}` references. */
const VARIABLE = /\$\{(\w+)\}/g

/**
 * Quote a value for a POSIX shell as a single word.
 *
 * @param {string} value - the value.
 * @returns {string} the quoted value.
 */
function shQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

/**
 * Split a text into its literal parts and its variable references.
 *
 * @param {string} text - the text.
 * @returns {Array<{literal: string} | {variable: string}>} the parts, in order.
 */
function parts(text) {
  /** @type {Array<{literal: string} | {variable: string}>} */
  const out = []
  let last = 0
  for (const match of String(text).matchAll(VARIABLE)) {
    const at = match.index ?? 0
    if (at > last) out.push({ literal: String(text).slice(last, at) })
    out.push({ variable: match[1] ?? '' })
    last = at + match[0].length
  }
  if (last < String(text).length) out.push({ literal: String(text).slice(last) })
  return out
}

/**
 * Render a text as a POSIX shell word, expanding any variable references.
 *
 * A literal part is escaped for a double-quoted string, so `$`, `` ` `` and
 * `"` stay literal while `$NAME` expands. The result is always one word: a
 * value that contains a space survives as one argument.
 *
 * @param {string} text - the text.
 * @returns {string} the shell word.
 */
function shWord(text) {
  let out = '"'
  for (const part of parts(text)) {
    if ('variable' in part) {
      out += `$${part.variable}`
    } else {
      out += part.literal.replace(/[\\"$`]/g, '\\$&')
    }
  }
  return `${out}"`
}

/**
 * Render a text as a JavaScript expression, expanding any variable references.
 *
 * The generated script defines `SUB`, `REST` and `A1`…`A6` from its own argv,
 * and a `capture` step declares one more; a reference to any of them becomes
 * the identifier itself.
 *
 * @param {string} text - the text.
 * @returns {string} the expression.
 */
function jsWord(text) {
  /** @type {string[]} */
  const pieces = []
  for (const part of parts(text)) {
    if ('variable' in part) pieces.push(part.variable)
    else if (part.literal.length > 0) pieces.push(JSON.stringify(part.literal))
  }
  if (pieces.length === 0) return "''"
  return pieces.length === 1 ? (pieces[0] ?? "''") : `(${pieces.join(' + ')})`
}

/**
 * Render a glob as a JavaScript `RegExp` expression.
 *
 * `*` and `?` are the only wildcards, as they are for the POSIX `case`
 * rendering, and matching is case-sensitive for the same reason: the two
 * renderings have to answer identically for the same command line.
 *
 * @param {string} pattern - the glob.
 * @returns {string} a JavaScript expression that evaluates to the RegExp.
 */
function globExpression(pattern) {
  let source = ''
  for (const character of String(pattern)) {
    if (character === '*') source += '.*'
    else if (character === '?') source += '.'
    else source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return `new RegExp(${JSON.stringify(`^${source}$`)})`
}

/**
 * Render a glob as a POSIX `case` pattern.
 *
 * A `case` pattern is word-split like any other shell word, so a pattern that
 * contains a space — `getprop sys.boot_completed` is one — is parsed as two
 * words and the script fails to parse at all. Quoting the literal segments
 * fixes that while leaving `*` a wildcard, which is what makes
 * `uiautomator dump*` a prefix match rather than a literal.
 *
 * @param {string} pattern - the glob.
 * @returns {string} the pattern, quoted segment by segment.
 */
function shCasePattern(pattern) {
  return String(pattern)
    .split('*')
    .map((part) => (part.length === 0 ? '' : shQuote(part)))
    .join('*')
}

/**
 * Render the steps as a POSIX shell script.
 *
 * @param {FakeStep[]} steps - the fake's steps.
 * @returns {string} the script.
 */
function renderShell(steps) {
  const lines = [
    '#!/bin/sh',
    'SUB=""',
    'REST=""',
    'A1="$1"',
    'A2="$2"',
    'A3="$3"',
    'A4="$4"',
    'A5="$5"',
    'A6="$6"',
    'if [ "$A1" = "-s" ]; then SUB="$A3"; SKIP=4; else SUB="$A1"; SKIP=2; fi',
    'REST=""',
    'i=1',
    'for a in "$@"; do',
    '  if [ "$i" -ge "$SKIP" ]; then',
    '    if [ -z "$REST" ]; then REST="$a"; else REST="$REST $a"; fi',
    '  fi',
    '  i=$((i + 1))',
    'done',
  ]
  lines.push(...renderShellSteps(steps))
  return `${lines.join('\n')}\n`
}

/**
 * Render a list of steps as POSIX shell lines.
 *
 * @param {FakeStep[]} steps - the steps.
 * @returns {string[]} the shell lines.
 */
function renderShellSteps(steps) {
  /** @type {string[]} */
  const out = []
  for (const step of steps) {
    if (step.record !== undefined) {
      out.push(`{ for a in "$@"; do printf '%s|' "$a"; done; printf '\\n'; } >> ${shQuote(step.record)}`)
    }
    if (step.recordLines !== undefined) {
      out.push(`for a in "$@"; do printf '%s\\n' "$a"; done > ${shQuote(step.recordLines)}`)
    }
    if (step.appendLines !== undefined) {
      out.push(`for a in "$@"; do printf '%s\\n' "$a"; done >> ${shQuote(step.appendLines)}`)
    }
    if (step.out !== undefined) {
      out.push(`printf '%s\\n' ${shWord(step.out)}`)
    }
    if (step.outRaw !== undefined) {
      out.push(`printf '%s' ${shWord(step.outRaw)}`)
    }
    if (step.err !== undefined) {
      out.push(`printf '%s\\n' ${shWord(step.err)} >&2`)
    }
    if (step.outBytes !== undefined) {
      const octal = step.outBytes.map((byte) => `\\${byte.toString(8).padStart(3, '0')}`).join('')
      out.push(`printf '${octal}'`)
    }
    if (step.write !== undefined) {
      out.push(`printf '%s' ${shWord(step.write[1])} > ${shQuote(step.write[0])}`)
    }
    if (step.append !== undefined) {
      out.push(`printf '%s' ${shWord(step.append[1])} >> ${shQuote(step.append[0])}`)
    }
    if (step.copy !== undefined) {
      out.push(`cp ${shQuote(step.copy[0])} ${shQuote(step.copy[1])}`)
    }
    if (step.cat !== undefined) {
      out.push(`cat ${shQuote(step.cat)}`)
    }
    if (step.stdinTo !== undefined) {
      out.push(`cat > ${shQuote(step.stdinTo)}`)
    }
    if (step.ifArg !== undefined) {
      out.push(`if [ "$A${step.ifArg[0]}" = ${shWord(step.ifArg[1])} ]; then`)
      out.push(...renderShellSteps(step.then ?? []))
      out.push('fi')
    }
    if (step.ifArgPrefix !== undefined) {
      out.push(`case "$A${step.ifArgPrefix[0]}" in`)
      out.push(`  ${shCasePattern(`${step.ifArgPrefix[1]}*`)})`)
      out.push(...renderShellSteps(step.then ?? []))
      out.push('    ;;')
      out.push('esac')
    }
    if (step.ifSub !== undefined) {
      out.push(`if [ "$SUB" = ${shWord(step.ifSub)} ]; then`)
      out.push(...renderShellSteps(step.then ?? []))
      out.push('fi')
    }
    if (step.ifRest !== undefined) {
      out.push('case "$REST" in')
      out.push(`  ${shCasePattern(step.ifRest.pattern)})`)
      if (step.ifRest.capture !== undefined) {
        const strip = step.ifRest.strip
        out.push(
          strip !== undefined
            ? `    ${step.ifRest.capture}="\${REST#${strip}}"`
            : `    ${step.ifRest.capture}="$REST"`,
        )
      }
      out.push(...renderShellSteps(step.then ?? []))
      out.push('    ;;')
      out.push('esac')
    }
    if (step.ifFile !== undefined) {
      out.push(`if [ -f ${shQuote(step.ifFile)} ]; then`)
      out.push(...renderShellSteps(step.then ?? []))
      out.push('fi')
    }
    if (step.ifContentEquals !== undefined) {
      out.push(
        `if [ -f ${shQuote(step.ifContentEquals[0])} ] && [ "$(cat ${shQuote(step.ifContentEquals[0])})" = ${shWord(step.ifContentEquals[1])} ]; then`,
      )
      out.push(...renderShellSteps(step.then ?? []))
      out.push('fi')
    }
    if (step.sleep !== undefined) {
      out.push(`sleep ${step.sleep}`)
    }
    if (step.hang === true) {
      out.push('trap "" TERM', 'while true; do sleep 0.2; done')
    }
    if (step.pidTo !== undefined) {
      out.push(`echo $$ > ${shQuote(step.pidTo)}`)
    }
    if (step.exit !== undefined) {
      out.push(`exit ${step.exit}`)
    }
  }
  return out
}

/**
 * Render the steps as a Node script.
 *
 * This is the Windows rendering. The `.cmd`/`.bat` launcher starts it with the
 * absolute `process.execPath` the suite itself is running under, so the fake
 * needs no PowerShell installation and no `node` on `PATH`. The launcher is a
 * batch file because that is the only kind of script Windows starts through
 * `cmd.exe`; there is no PowerShell anywhere in the chain.
 *
 * Standard output is written with `process.stdout.write` and the generated
 * program leaves through `process.exitCode`, so Node flushes every pending byte
 * before it goes away — a raw PNG payload or a UTF-8 line is neither cut off
 * nor re-encoded through a console code page.
 *
 * @param {FakeStep[]} steps - the fake's steps.
 * @returns {string} the script.
 */
function renderNode(steps) {
  const lines = [
    '#!/usr/bin/env node',
    '// Generated by test/helpers/fake-tool.mjs from a list of steps.',
    "import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'",
    '',
    'const RAW = process.argv.slice(2)',
    "const SUB = RAW[0] === '-s' ? (RAW[2] ?? '') : (RAW[0] ?? '')",
    "const SKIP = RAW[0] === '-s' ? 4 : 2",
    "const REST = RAW.slice(SKIP - 1).join(' ')",
    "const A1 = RAW[0] ?? ''",
    "const A2 = RAW[1] ?? ''",
    "const A3 = RAW[2] ?? ''",
    "const A4 = RAW[3] ?? ''",
    "const A5 = RAW[4] ?? ''",
    "const A6 = RAW[5] ?? ''",
    '',
    'async function main() {',
  ]
  for (const capture of captures(steps)) lines.push(`  let ${capture} = ''`)
  lines.push(...renderNodeSteps(steps, 1))
  lines.push('  return 0', '}', '', 'process.exitCode = await main()', '')
  return `${lines.join('\n')}\n`
}

/**
 * The names of every `ifRest` capture in a step tree, in first-seen order.
 *
 * A capture is script-scope in the other two renderings, so a value set in one
 * branch stays readable by a later step. The generated script mirrors that with
 * one `let` per capture at the top of `main`.
 *
 * @param {FakeStep[]} steps - the steps to walk.
 * @returns {string[]} the capture names.
 */
function captures(steps) {
  /** @type {string[]} */
  const found = []
  /** @param {FakeStep[]} list */
  const walk = (list) => {
    for (const step of list) {
      const name = step.ifRest?.capture
      if (name !== undefined && !found.includes(name)) found.push(name)
      if (step.then !== undefined) walk(step.then)
    }
  }
  walk(steps)
  return found
}

/**
 * Render a list of steps as Node lines inside `async function main`.
 *
 * `exit` becomes `return`, so pending writes are flushed by Node's normal
 * shutdown instead of being truncated by `process.exit()`; `hang` keeps the
 * event loop alive so the platform can terminate the process the same way the
 * other renderings are terminated.
 *
 * @param {FakeStep[]} steps - the steps.
 * @param {number} depth - the indentation depth inside `main`.
 * @returns {string[]} the Node lines.
 */
function renderNodeSteps(steps, depth) {
  const indent = '  '.repeat(depth)
  /** @type {string[]} */
  const out = []
  for (const step of steps) {
    if (step.record !== undefined) {
      out.push(
        `${indent}appendFileSync(${JSON.stringify(step.record)}, RAW.length === 0 ? ${JSON.stringify('\n')} : RAW.join('|') + ${JSON.stringify('|\n')})`,
      )
    }
    if (step.recordLines !== undefined) {
      out.push(
        `${indent}writeFileSync(${JSON.stringify(step.recordLines)}, RAW.join(${JSON.stringify('\n')}) + ${JSON.stringify('\n')})`,
      )
    }
    if (step.appendLines !== undefined) {
      out.push(
        `${indent}appendFileSync(${JSON.stringify(step.appendLines)}, RAW.join(${JSON.stringify('\n')}) + ${JSON.stringify('\n')})`,
      )
    }
    if (step.out !== undefined) {
      out.push(`${indent}process.stdout.write(${jsWord(step.out)} + ${JSON.stringify('\n')})`)
    }
    if (step.outRaw !== undefined) {
      out.push(`${indent}process.stdout.write(${jsWord(step.outRaw)})`)
    }
    if (step.err !== undefined) {
      out.push(`${indent}process.stderr.write(${jsWord(step.err)} + ${JSON.stringify('\n')})`)
    }
    if (step.outBytes !== undefined) {
      out.push(`${indent}process.stdout.write(Buffer.from([${step.outBytes.join(', ')}]))`)
    }
    if (step.write !== undefined) {
      out.push(`${indent}writeFileSync(${JSON.stringify(step.write[0])}, ${jsWord(step.write[1])})`)
    }
    if (step.append !== undefined) {
      out.push(`${indent}appendFileSync(${JSON.stringify(step.append[0])}, ${jsWord(step.append[1])})`)
    }
    if (step.copy !== undefined) {
      out.push(`${indent}copyFileSync(${JSON.stringify(step.copy[0])}, ${JSON.stringify(step.copy[1])})`)
    }
    if (step.cat !== undefined) {
      out.push(
        `${indent}if (existsSync(${JSON.stringify(step.cat)})) process.stdout.write(readFileSync(${JSON.stringify(step.cat)}))`,
      )
    }
    if (step.stdinTo !== undefined) {
      out.push(`${indent}writeFileSync(${JSON.stringify(step.stdinTo)}, readFileSync(0))`)
    }
    if (step.ifArg !== undefined) {
      out.push(`${indent}if (A${step.ifArg[0]} === ${jsWord(step.ifArg[1])}) {`)
      out.push(...renderNodeSteps(step.then ?? [], depth + 1))
      out.push(`${indent}}`)
    }
    if (step.ifArgPrefix !== undefined) {
      out.push(`${indent}if (${globExpression(`${step.ifArgPrefix[1]}*`)}.test(A${step.ifArgPrefix[0]})) {`)
      out.push(...renderNodeSteps(step.then ?? [], depth + 1))
      out.push(`${indent}}`)
    }
    if (step.ifSub !== undefined) {
      out.push(`${indent}if (SUB === ${jsWord(step.ifSub)}) {`)
      out.push(...renderNodeSteps(step.then ?? [], depth + 1))
      out.push(`${indent}}`)
    }
    if (step.ifRest !== undefined) {
      out.push(`${indent}if (${globExpression(step.ifRest.pattern)}.test(REST)) {`)
      if (step.ifRest.capture !== undefined) {
        const strip = step.ifRest.strip
        out.push(
          `${indent}  ${step.ifRest.capture} = ${
            strip !== undefined
              ? `REST.startsWith(${JSON.stringify(strip)}) ? REST.slice(${strip.length}) : REST`
              : 'REST'
          }`,
        )
      }
      out.push(...renderNodeSteps(step.then ?? [], depth + 1))
      out.push(`${indent}}`)
    }
    if (step.ifFile !== undefined) {
      out.push(`${indent}if (existsSync(${JSON.stringify(step.ifFile)})) {`)
      out.push(...renderNodeSteps(step.then ?? [], depth + 1))
      out.push(`${indent}}`)
    }
    if (step.ifContentEquals !== undefined) {
      out.push(
        `${indent}if (existsSync(${JSON.stringify(step.ifContentEquals[0])}) && readFileSync(${JSON.stringify(step.ifContentEquals[0])}, 'utf8') === ${jsWord(step.ifContentEquals[1])}) {`,
      )
      out.push(...renderNodeSteps(step.then ?? [], depth + 1))
      out.push(`${indent}}`)
    }
    if (step.sleep !== undefined) {
      out.push(`${indent}await new Promise((resolve) => setTimeout(resolve, ${step.sleep * 1000}))`)
    }
    if (step.hang === true) {
      out.push(`${indent}setInterval(() => {}, 1000)`, `${indent}await new Promise(() => {})`)
    }
    if (step.pidTo !== undefined) {
      out.push(`${indent}writeFileSync(${JSON.stringify(step.pidTo)}, String(process.pid))`)
    }
    if (step.exit !== undefined) {
      out.push(`${indent}return ${step.exit}`)
    }
  }
  return out
}

/**
 * Refuse a fake whose steps are not step objects.
 *
 * Both renderers walk `steps` with `for…of` and branch on `step.<field>`, so a
 * value of the wrong type is not an error anywhere: a string is walked one
 * character at a time, every branch is false, and the written fake is a script
 * that does nothing and exits 0. An assertion that expects the tool to have
 * answered then passes for the worst possible reason — the fake silently never
 * ran. The old shell-string form of this helper is exactly how that happens, so
 * it is rejected at the door instead.
 *
 * @param {unknown} steps - the value the caller passed.
 * @param {string} where - the step path, for the message.
 * @returns {void} throws when the value is not a step list.
 */
function assertSteps(steps, where = 'steps') {
  if (!Array.isArray(steps)) {
    throw new TypeError(
      `${where} must be an array of step objects (fake-tool.mjs renders steps, not shell strings); got ${steps === null ? 'null' : typeof steps}`,
    )
  }
  steps.forEach((step, index) => {
    if (typeof step !== 'object' || step === null || Array.isArray(step)) {
      throw new TypeError(`${where}[${index}] must be a step object; got ${step === null ? 'null' : typeof step}`)
    }
    if (step.then !== undefined) assertSteps(step.then, `${where}[${index}].then`)
  })
}

/**
 * Write a fake tool into a directory, in the flavour this host can run.
 *
 * On POSIX the fake is an executable shell script named after the tool. On
 * Windows the behaviour lives in a `.mjs` script and a `.cmd`/`.bat` launcher
 * named after the tool puts it on `PATH` — `cmd.exe` is the only thing Windows
 * starts a script through, and the launcher runs the same Node that is running
 * the suite, not a PowerShell installation.
 *
 * @param {string} dir - the directory to write into.
 * @param {string} name - the tool's name, as the plugin looks for it.
 * @param {FakeStep[]} steps - what the fake does.
 * @param {{launcher?: 'cmd'|'bat'}} [options] - the launcher's extension on
 *   Windows. `cmd` suits a tool the plugin finds on `PATH`; `bat` suits a
 *   project-local launcher such as a Gradle wrapper, which the plugin names
 *   `gradlew.bat`.
 * @returns {Promise<void>} resolves when the fake is on disk.
 */
export async function writeFakeTool(dir, name, steps, options = {}) {
  assertSteps(steps)
  if (process.platform === 'win32') {
    const extension = options.launcher ?? 'cmd'
    await writeFile(path.join(dir, `${name}.mjs`), renderNode(steps), 'utf8')
    const launcher = [
      '@echo off',
      'setlocal',
      `"${process.execPath}" "%~dp0${name}.mjs" %*`,
      'exit /b %ERRORLEVEL%',
      '',
    ].join('\r\n')
    await writeFile(path.join(dir, `${name}.${extension}`), launcher, 'utf8')
    return
  }
  const file = path.join(dir, name)
  await writeFile(file, renderShell(steps), 'utf8')
  await chmod(file, 0o755)
}

/**
 * The fake's source, as text, for a test that asserts on it.
 *
 * @param {FakeStep[]} steps - what the fake does.
 * @param {NodeJS.Platform} [platform] - the platform to render for; defaults to
 *   the host. Naming the other one is how the POSIX rendering can be checked
 *   from a Windows machine and vice versa.
 * @returns {string} the script that platform would run.
 */
export function fakeToolSource(steps, platform = process.platform) {
  return platform === 'win32' ? renderNode(steps) : renderShell(steps)
}
