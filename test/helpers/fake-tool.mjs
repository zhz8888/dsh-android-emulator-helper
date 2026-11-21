import { chmod, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Describe a fake CLI tool once as a list of steps, rendered twice: a POSIX shell
 * script on POSIX, and on Windows a Node step script behind a `.cmd`/`.bat`
 * launcher started by `cmd.exe`. The launcher embeds the suite's absolute
 * `process.execPath`, so no PowerShell or `node` on `PATH` is needed — the
 * project's Windows rule is `pwsh` first, `cmd.exe` last, never `powershell.exe`.
 */

/**
 * One step of a fake tool. Branch steps hold their body in `then`; steps run in
 * order and text values may interpolate `${SUB}`, `${REST}` or a captured
 * `${NAME}`.
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
 * @property {{file: string, timeout: number}} [waitFor]
 *   - block until that file exists, or for that many seconds; a rendezvous
 *   between two concurrent invocations, so a test can prove they overlap
 *   without racing a fixed sleep window.
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
 * Render a text as one POSIX shell word, escaping literal `$`, backtick and
 * quotes so only `$NAME` expands — a value containing a space stays one argument.
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
 * Render a text as a JavaScript expression; the generated script defines `SUB`,
 * `REST` and `A1`…`A6` from argv, plus one identifier per capture step.
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
 * Render a glob (`*` and `?` only) as a JavaScript `RegExp` expression,
 * case-sensitive to match the POSIX `case` rendering exactly.
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
 * Render a glob as a POSIX `case` pattern, quoting literal segments so spaces
 * (`getprop sys.boot_completed`) do not split the word while `*` stays a wildcard.
 *
 * @param {string} pattern - the glob.
 * @returns {string} the pattern, quoted segment by segment.
 */
function shCasePattern(pattern) {
  // `*` and `?` are the two wildcards {@link globExpression} understands, so
  // both stay unquoted here; every other character is quoted, which keeps a
  // space inside one word. Quoting `?` made the same fake match a different
  // set of strings on POSIX than on Windows.
  return String(pattern)
    .split(/([*?])/)
    .map((part) => (part === '*' || part === '?' ? part : part.length === 0 ? '' : shQuote(part)))
    .join('')
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
    if (step.waitFor !== undefined) {
      // A bounded poll: the deadline is what keeps a broken rendezvous from
      // hanging the suite, and the step is a no-op once the file appears.
      out.push(
        `i=0; while [ ! -f ${shQuote(step.waitFor.file)} ] && [ "$i" -lt ${Math.round(step.waitFor.timeout * 10)} ]; do sleep 0.1; i=$((i + 1)); done`,
      )
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
 * Render the steps as a Node script — the Windows rendering. The `.cmd`/`.bat`
 * launcher starts it with the suite's `process.execPath`; stdout is written with
 * `process.stdout.write` and exit goes through `process.exitCode` so pending
 * bytes (a raw PNG, a UTF-8 line) flush before exit.
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
    '/**',
    ' * Block until a file exists, or until the deadline passes.',
    ' *',
    ' * The rendezvous a fake uses to prove two invocations overlap: each one',
    ' * announces itself and then waits for the other, so the test does not have',
    ' * to guess a sleep window that is long enough on a loaded machine.',
    ' *',
    ' * @param {string} file - the file to wait for.',
    ' * @param {number} timeoutMs - how long to wait.',
    ' * @returns {Promise<void>} resolves when the file appears or the deadline passes.',
    ' */',
    'async function waitForFile(file, timeoutMs) {',
    '  const deadline = Date.now() + timeoutMs',
    '  while (!existsSync(file) && Date.now() < deadline) {',
    '    await new Promise((resolve) => setTimeout(resolve, 50))',
    '  }',
    '}',
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
 * The names of every `ifRest` capture in step order; each becomes one `let` at
 * the top of `main` so a value set in one branch stays readable later, mirroring
 * the script-scope captures of the other renderings.
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
 * Render steps as Node lines inside `async function main`: `exit` becomes
 * `return` so writes flush at normal shutdown, and `hang` keeps the event loop
 * alive for the platform to terminate.
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
    if (step.waitFor !== undefined) {
      out.push(
        `${indent}await waitForFile(${JSON.stringify(step.waitFor.file)}, ${step.waitFor.timeout * 1000})`,
      )
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
 * Refuse a fake whose steps are not step objects: both renderers walk with
 * `for…of`, so a string is walked character by character and yields a no-op
 * script that exits 0 — making an assertion pass for the worst reason.
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
 * Write a fake tool in the flavour this host can run: an executable shell script
 * on POSIX, or a `.mjs` behaviour plus a `.cmd`/`.bat` launcher on Windows
 * (`bat` for project-local wrappers like `gradlew.bat`, `cmd` for `PATH` tools).
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

