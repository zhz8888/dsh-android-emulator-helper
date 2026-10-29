import { readFile } from 'node:fs/promises'

/**
 * Reader for Java `.properties` files.
 *
 * The Android Gradle Plugin and Android Studio write the SDK location into a
 * project's `local.properties`, so this is one of the places the real path of
 * an installed SDK is recorded. Reading it needs the JVM's own rules: a
 * properties file is not a text file with `key=value` lines, and the rules
 * decide what a path comes back as.
 *
 * @module @zhz8888/dsh-android-emulator-helper/util/properties
 */

/**
 * Unescape one properties value the way `java.util.Properties` does.
 *
 * A properties file stores a backslash as `\\`, a colon in a *key* as `\:`,
 * and a newline as `\n`. A backslash before anything else is **dropped**
 * silently, which is the trap: the natural spelling of a Windows path,
 * `sdk.dir=C:\Users\x`, parses as `C:Usersx` — the backslashes vanish and
 * nothing complains.
 *
 * Android Studio and the Android Gradle Plugin write the escaped form,
 * `sdk.dir=D\:\\Android\\Sdk`, and this reads it back as
 * `D:\Android\Sdk`.
 *
 * @param {string} value - the raw value.
 * @returns {string} the unescaped value.
 */
export function unescapePropertiesValue(value) {
  let out = ''
  let index = 0
  while (index < value.length) {
    const char = value[index]
    if (char !== '\\') {
      out += char
      index += 1
      continue
    }
    const next = value[index + 1]
    if (next === undefined) break
    if (next === 'u') {
      const hex = value.slice(index + 2, index + 6)
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(Number.parseInt(hex, 16))
        index += 6
        continue
      }
      out += 'u'
      index += 2
      continue
    }
    if (next === 'n') out += '\n'
    else if (next === 'r') out += '\r'
    else if (next === 't') out += '\t'
    else if (next === 'f') out += '\f'
    else out += next
    index += 2
  }
  return out
}

/**
 * Read one value out of a properties file.
 *
 * @param {string} file - the file to read.
 * @param {string} key - the key to look for.
 * @returns {Promise<string | undefined>} the unescaped value, when the file has it.
 */
export async function readPropertiesValue(file, key) {
  const text = await readFile(file, 'utf8').catch(() => '')
  if (!text) return undefined
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue
    const separator = trimmed.search(/[=:]/)
    if (separator < 0) continue
    const name = trimmed.slice(0, separator).trim()
    if (name !== key) continue
    return unescapePropertiesValue(trimmed.slice(separator + 1).trim())
  }
  return undefined
}
