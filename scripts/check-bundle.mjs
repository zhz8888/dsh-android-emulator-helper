#!/usr/bin/env node
import process from 'node:process'
import { FIELD_KEYS, FIELDS, SETTINGS_NAMESPACE } from '../lib/settings.js'
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
