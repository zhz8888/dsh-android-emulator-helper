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
 * twice: as a POSIX shell script and as a PowerShell script. On Windows the
 * PowerShell script is what carries the behaviour, and a `.cmd` (or `.bat`)
 * launcher puts it on `PATH` next to the name the plugin looks for — `cmd.exe`
 * is the only thing Windows can start a script through, and the plugin already
 * routes a batch file through it.
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

/** The name of the variable that holds the sub-command. */
const SUB = 'SUB'

/** The name of the variable that holds the command after the sub-command. */
const REST = 'REST'

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
 * Quote a value for PowerShell as a single-quoted string.
 *
 * @param {string} value - the value.
 * @returns {string} the quoted value.
 */
function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
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
 * Render a text as a PowerShell expression, expanding any variable references.
 *
 * @param {string} text - the text.
 * @returns {string} the expression.
 */
function psWord(text) {
  /** @type {string[]} */
  const pieces = []
  for (const part of parts(text)) {
    if ('variable' in part) pieces.push(`$${part.variable}`)
    else if (part.literal.length > 0) pieces.push(psQuote(part.literal))
  }
  if (pieces.length === 0) return "''"
  return pieces.length === 1 ? (pieces[0] ?? "''") : `(${pieces.join(' + ')})`
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
 * Render the steps as a PowerShell script.
 *
 * @param {FakeStep[]} steps - the fake's steps.
 * @returns {string} the script.
 */
function renderPowerShell(steps) {
  const lines = [
    '$ErrorActionPreference = "Stop"',
    '$stdout = [Console]::OpenStandardOutput()',
    '$stderr = [Console]::OpenStandardError()',
    'function Write-Out([string]$text) { $bytes = [Text.Encoding]::UTF8.GetBytes($text); $stdout.Write($bytes, 0, $bytes.Length) }',
    'function Write-Err([string]$text) { $bytes = [Text.Encoding]::UTF8.GetBytes($text); $stderr.Write($bytes, 0, $bytes.Length) }',
    '$raw = @($args)',
    '$sub = ""',
    '$rest = ""',
    'if ($raw.Count -gt 0 -and $raw[0] -eq "-s") { $sub = $raw[2]; $skip = 4 } else { $sub = $raw[0]; $skip = 2 }',
    'for ($i = $skip - 1; $i -lt $raw.Count; $i++) { if ($i -ge 0) { if ($rest -eq "") { $rest = $raw[$i] } else { $rest = "$rest $($raw[$i])" } } }',
    '$A1 = if ($raw.Count -gt 0) { $raw[0] } else { "" }',
    '$A2 = if ($raw.Count -gt 1) { $raw[1] } else { "" }',
    '$A3 = if ($raw.Count -gt 2) { $raw[2] } else { "" }',
    '$A4 = if ($raw.Count -gt 3) { $raw[3] } else { "" }',
    '$A5 = if ($raw.Count -gt 4) { $raw[4] } else { "" }',
    '$A6 = if ($raw.Count -gt 5) { $raw[5] } else { "" }',
  ]
  lines.push(...renderPowerShellSteps(steps))
  return `${lines.join('\n')}\n`
}

/**
 * Render a list of steps as PowerShell lines.
 *
 * @param {FakeStep[]} steps - the steps.
 * @returns {string[]} the PowerShell lines.
 */
function renderPowerShellSteps(steps) {
  /** @type {string[]} */
  const out = []
  for (const step of steps) {
    if (step.record !== undefined) {
      out.push('$line = if ($raw.Count -eq 0) { "`n" } else { ($raw -join "|") + "|`n" }')
      out.push(`$bytes = [Text.Encoding]::UTF8.GetBytes($line); $handle = [IO.File]::Open(${psQuote(step.record)}, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite); $handle.Write($bytes, 0, $bytes.Length); $handle.Dispose()`)
    }
    if (step.recordLines !== undefined) {
      out.push('$text = (($raw -join "`n") + "`n")')
      out.push(`$bytes = [Text.Encoding]::UTF8.GetBytes($text); [IO.File]::WriteAllBytes(${psQuote(step.recordLines)}, $bytes)`)
    }
    if (step.appendLines !== undefined) {
      out.push('$line = ($raw -join "`n") + "`n"')
      out.push(`$bytes = [Text.Encoding]::UTF8.GetBytes($line); $handle = [IO.File]::Open(${psQuote(step.appendLines)}, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite); $handle.Write($bytes, 0, $bytes.Length); $handle.Dispose()`)
    }
    if (step.out !== undefined) {
      out.push(`Write-Out (([string]${psWord(step.out)}) + "\`n")`)
    }
    if (step.outRaw !== undefined) {
      out.push(`Write-Out ([string]${psWord(step.outRaw)})`)
    }
    if (step.err !== undefined) {
      out.push(`Write-Err (([string]${psWord(step.err)}) + "\`n")`)
    }
    if (step.outBytes !== undefined) {
      const bytes = step.outBytes.map((byte) => String(byte)).join(',')
      out.push(`$bytes = [byte[]]@(${bytes}); $stdout.Write($bytes, 0, $bytes.Length)`)
    }
    if (step.write !== undefined) {
      out.push(`$bytes = [Text.Encoding]::UTF8.GetBytes([string]${psWord(step.write[1])}); [IO.File]::WriteAllBytes(${psQuote(step.write[0])}, $bytes)`)
    }
    if (step.append !== undefined) {
      out.push(`$bytes = [Text.Encoding]::UTF8.GetBytes([string]${psWord(step.append[1])}); $handle = [IO.File]::Open(${psQuote(step.append[0])}, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite); $handle.Write($bytes, 0, $bytes.Length); $handle.Dispose()`)
    }
    if (step.copy !== undefined) {
      out.push(`Copy-Item -LiteralPath ${psQuote(step.copy[0])} -Destination ${psQuote(step.copy[1])} -Force`)
    }
    if (step.cat !== undefined) {
      out.push(`if (Test-Path -LiteralPath ${psQuote(step.cat)}) { Write-Out ([IO.File]::ReadAllText(${psQuote(step.cat)})) }`)
    }
    if (step.stdinTo !== undefined) {
      out.push(
        `$reader = New-Object IO.StreamReader([Console]::OpenStandardInput()); [IO.File]::WriteAllText(${psQuote(step.stdinTo)}, $reader.ReadToEnd())`,
      )
    }
    if (step.ifArg !== undefined) {
      out.push(`if ($A${step.ifArg[0]} -eq [string]${psWord(step.ifArg[1])}) {`)
      out.push(...renderPowerShellSteps(step.then ?? []))
      out.push('}')
    }
    if (step.ifArgPrefix !== undefined) {
      out.push(`if ($A${step.ifArgPrefix[0]} -like ${psQuote(`${step.ifArgPrefix[1]}*`)}) {`)
      out.push(...renderPowerShellSteps(step.then ?? []))
      out.push('}')
    }
    if (step.ifSub !== undefined) {
      out.push(`if ($sub -eq [string]${psWord(step.ifSub)}) {`)
      out.push(...renderPowerShellSteps(step.then ?? []))
      out.push('}')
    }
    if (step.ifRest !== undefined) {
      out.push(`if ($rest -like ${psQuote(step.ifRest.pattern)}) {`)
      if (step.ifRest.capture !== undefined) {
        const strip = step.ifRest.strip
        out.push(
          strip !== undefined
            ? `$${step.ifRest.capture} = if ($rest.StartsWith(${psQuote(strip)})) { $rest.Substring(${strip.length}) } else { $rest }`
            : `$${step.ifRest.capture} = $rest`,
        )
      }
      out.push(...renderPowerShellSteps(step.then ?? []))
      out.push('}')
    }
    if (step.ifFile !== undefined) {
      out.push(`if (Test-Path -LiteralPath ${psQuote(step.ifFile)}) {`)
      out.push(...renderPowerShellSteps(step.then ?? []))
      out.push('}')
    }
    if (step.ifContentEquals !== undefined) {
      out.push(
        `if ((Test-Path -LiteralPath ${psQuote(step.ifContentEquals[0])}) -and ([IO.File]::ReadAllText(${psQuote(step.ifContentEquals[0])}) -eq [string]${psWord(step.ifContentEquals[1])})) {`,
      )
      out.push(...renderPowerShellSteps(step.then ?? []))
      out.push('}')
    }
    if (step.sleep !== undefined) {
      out.push(`Start-Sleep -Seconds ${step.sleep}`)
    }
    if (step.hang === true) {
      out.push('while ($true) { Start-Sleep -Milliseconds 200 }')
    }
    if (step.pidTo !== undefined) {
      out.push(`[IO.File]::WriteAllText(${psQuote(step.pidTo)}, [string]$PID)`)
    }
    if (step.exit !== undefined) {
      out.push(`exit ${step.exit}`)
    }
  }
  return out
}

/**
 * Write a fake tool into a directory, in the flavour this host can run.
 *
 * On POSIX the fake is an executable shell script named after the tool. On
 * Windows the behaviour lives in a `.ps1` script and a launcher named after the
 * tool puts it on `PATH` — `cmd.exe` is the only thing Windows can start a
 * script through.
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
  if (process.platform === 'win32') {
    const extension = options.launcher ?? 'cmd'
    await writeFile(path.join(dir, `${name}.ps1`), renderPowerShell(steps), 'utf8')
    const launcher = [
      '@echo off',
      'setlocal',
      'set "PS=powershell"',
      'where pwsh >nul 2>&1 && set "PS=pwsh"',
      `%PS% -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0${name}.ps1" %*`,
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
  return platform === 'win32' ? renderPowerShell(steps) : renderShell(steps)
}
