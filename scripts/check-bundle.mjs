#!/usr/bin/env node
import process from 'node:process'
import { FIELD_GROUPS, FIELD_KEYS, FIELDS, SETTINGS_NAMESPACE } from '../lib/settings.js'
import { ROOT, loadBundle } from '../test/helpers/load-bundle.mjs'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Consistency gate for the browser bundle.
 *
 * The client half cannot import the host's settings module — the client bundle
 * purity gate forbids cross-plugin value imports — so the field table and the
 * settings namespace are written twice. This script is the check that keeps the
 * two copies identical, plus the structural checks a host-side test cannot make
 * about a file the browser evaluates on its own.
 *
 * Run with `pnpm run check`.
 */

const failures = []

/** Record one failed invariant. */
function fail(message) {
  failures.push(message)
}

const { registration, exported, required } = loadBundle()

// --- bundle identity -------------------------------------------------------
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
if (registration.id !== manifest.name) {
  fail(`bundle id ${JSON.stringify(registration.id)} must equal the package name ${JSON.stringify(manifest.name)}`)
}
if (!Array.isArray(exported.inject) || exported.inject.length === 0) {
  fail('the client bundle must export a non-empty inject list')
}
for (const name of ['apply', 'inject', 'NS', 'FIELD_META']) {
  if (exported[name] === undefined) fail(`the client bundle must export ${name}`)
}

// --- namespace agreement ---------------------------------------------------
if (exported.NS !== SETTINGS_NAMESPACE) {
  fail(`client namespace ${JSON.stringify(exported.NS)} must equal SETTINGS_NAMESPACE ${JSON.stringify(SETTINGS_NAMESPACE)}`)
}
const patch = readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8')
if (!patch.includes(`id: ${SETTINGS_NAMESPACE}`)) {
  fail(`cordis.patch.yml must mount a row whose id is ${SETTINGS_NAMESPACE}`)
}

// --- field table agreement -------------------------------------------------
const clientFields = exported.FIELD_META ?? []
if (clientFields.length !== FIELD_KEYS.length) {
  fail(`client declares ${clientFields.length} fields but the host schema declares ${FIELD_KEYS.length}`)
}
const hostOrder = [...FIELDS.keys()]
const clientOrder = clientFields.map((field) => field.key)
if (hostOrder.join(',') !== clientOrder.join(',')) {
  fail(`field order differs:\n  host:   ${hostOrder.join(', ')}\n  client: ${clientOrder.join(', ')}`)
}
for (const field of clientFields) {
  const host = FIELDS.get(field.key)
  if (host === undefined) {
    fail(`client declares unknown field "${field.key}"`)
    continue
  }
  if (host.kind !== field.kind) {
    fail(`field "${field.key}": host kind ${host.kind} != client kind ${field.kind}`)
  }
  if (host.options !== undefined) {
    const hostOptions = host.options.join('|')
    const clientOptions = (field.options ?? []).join('|')
    if (hostOptions !== clientOptions) {
      fail(`field "${field.key}": host options [${hostOptions}] != client options [${clientOptions}]`)
    }
  }
}

// --- group agreement -------------------------------------------------------
// The page draws one card per group and reads its heading from `group.<id>`.
// The two tables are written twice, so they have to agree key by key, in order.
const clientGroups = exported.GROUP_META ?? []
const hostGroupIds = FIELD_GROUPS.map((group) => group.id)
const clientGroupIds = clientGroups.map((group) => group.id)
if (hostGroupIds.join(',') !== clientGroupIds.join(',')) {
  fail(`group order differs:\n  host:   ${hostGroupIds.join(', ')}\n  client: ${clientGroupIds.join(', ')}`)
}
const clientFieldsByKey = new Map((exported.FIELD_META ?? []).map((field) => [field.key, field]))
for (const group of clientGroups) {
  const hostGroup = FIELD_GROUPS.find((item) => item.id === group.id)
  if (hostGroup === undefined) {
    fail(`client declares unknown group "${group.id}"`)
    continue
  }
  const hostFields = hostGroup.fields.map((field) => field.key).join(',')
  if (hostFields !== group.fields.join(',')) {
    fail(`group "${group.id}" holds different fields:\n  host:   ${hostFields}\n  client: ${group.fields.join(',')}`)
  }
}

// --- user-visible text agreement -------------------------------------------
// Every heading, hint and label the page can render is written twice. Comparing
// only the keys would let a reworded or mistranslated label ship: the form
// would still render, just with text that no longer matches the host. Compare
// the text itself, in both languages.
/** Compare two `{en, zh}` text objects, reporting every difference. */
function compareText(what, hostText, clientText) {
  for (const lang of ['en', 'zh']) {
    const host = hostText?.[lang]
    const client = clientText?.[lang]
    if (typeof host !== 'string' || host.length === 0) fail(`${what}: the host declares no ${lang} text`)
    else if (host !== client) {
      fail(`${what}: ${lang} text differs\n  host:   ${host}\n  client: ${client === undefined ? '(missing)' : client}`)
    }
  }
}
for (const group of FIELD_GROUPS) {
  const client = clientGroups.find((item) => item.id === group.id)
  if (client === undefined) continue
  compareText(`group "${group.id}" title`, group.title, client.title)
  compareText(`group "${group.id}" hint`, group.hint, client.hint)
  for (const field of group.fields) {
    const clientField = clientFieldsByKey.get(field.key)
    if (clientField === undefined) continue
    compareText(`field "${field.key}" label`, field.label, clientField.label)
    compareText(`field "${field.key}" hint`, field.hint, clientField.hint)
    if ((field.placeholder ?? '') !== (clientField.placeholder ?? '')) {
      fail(`field "${field.key}": placeholder differs\n  host:   ${field.placeholder ?? '(none)'}\n  client: ${clientField.placeholder ?? '(none)'}`)
    }
  }
}
// `locale/*.json` carries the package metadata the plugin list reads, so both
// languages must describe the same package with the same keys.
const localeFiles = {}
for (const name of ['en', 'zh']) {
  localeFiles[name] = JSON.parse(readFileSync(path.join(ROOT, 'locale', `${name}.json`), 'utf8'))
}
for (const key of new Set([...Object.keys(localeFiles.en), ...Object.keys(localeFiles.zh)])) {
  if (!(key in localeFiles.en)) fail(`locale/zh.json declares "${key}" but locale/en.json does not`)
  if (!(key in localeFiles.zh)) fail(`locale/en.json declares "${key}" but locale/zh.json does not`)
}
for (const name of ['en', 'zh']) {
  if (typeof localeFiles[name].meta?.title !== 'string' || localeFiles[name].meta.title.length === 0) {
    fail(`locale/${name}.json must declare meta.title`)
  }
  if (typeof localeFiles[name].meta?.description !== 'string' || localeFiles[name].meta.description.length === 0) {
    fail(`locale/${name}.json must declare meta.description`)
  }
}

// --- route agreement -------------------------------------------------------
const hostSource = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const clientSource = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const hostPrefix = /const ROUTE_PREFIX = '([^']+)'/.exec(hostSource)?.[1]
if (hostPrefix === undefined) {
  fail('lib/index.js must declare ROUTE_PREFIX')
} else {
  for (const route of [`${hostPrefix}/status`, `${hostPrefix}/inventory`]) {
    if (!clientSource.includes(`"${route}"`)) fail(`the client page does not call the host route ${route}`)
    if (!hostSource.includes(`\${ROUTE_PREFIX}/${route.split('/').at(-1)}`)) {
      fail(`lib/index.js does not register ${route}`)
    }
  }
}

// --- client bundle hygiene -------------------------------------------------
if (/^\s*(import|export)\s/m.test(clientSource)) {
  fail('the client bundle must be a classic script: no import/export statements')
}
for (const specifier of new Set(required)) {
  if (!['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'].includes(specifier)) {
    console.warn(`note: the bundle requires ${specifier}; confirm it is a shell static module or declared in dsh.client.external`)
  }
}

if (failures.length > 0) {
  console.error(`check-bundle: ${failures.length} problem(s)\n`)
  for (const message of failures) console.error(`  - ${message}`)
  process.exit(1)
}

console.log(
  `check-bundle: OK — bundle id, namespace, ${clientFields.length} fields, 2 routes and script hygiene all agree.`,
)
