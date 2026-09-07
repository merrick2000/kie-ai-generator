/**
 * The catalog against Kie's own schemas.
 *
 * Every model here was transcribed from a documentation page by hand, and
 * hand transcription is exactly how four models ended up with a slug Kie has
 * never heard of and nine more ended up sending fields that do not exist. A
 * wrong slug or a missing required field is not a subtle bug: the model
 * simply never works, and the only symptom is a failed generation.
 *
 * So the catalog is checked against a snapshot of what Kie publishes.
 * Refresh it with `bun scripts/fetch-kie-schemas.mts`.
 *
 *   bun --preload ./scripts/preload.ts scripts/test-schemas.mts
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { MODELS } from '../src/lib/kie/catalog'
import type { Field } from '../src/lib/kie/fields'

interface FieldSpec {
  type?: string
  enum?: (string | number)[]
  default?: unknown
  minimum?: number
  maximum?: number
}

interface ModelSpec {
  doc: string
  path: string
  title: string
  required: string[]
  fields: Record<string, FieldSpec>
}

const schemas = JSON.parse(
  readFileSync(new URL('./kie/schemas.json', import.meta.url), 'utf8'),
) as Record<string, ModelSpec>

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

/**
 * Models this test cannot speak for.
 *
 * Veo and Suno have their own endpoints rather than the market job API, so
 * they carry no `input` schema to compare against, and the chat models put
 * their parameters at the top level. Each is covered by its own suite.
 */
const OTHER_TRANSPORTS = new Set(['veo', 'suno', 'chat'])

const market = MODELS.filter((m) => !OTHER_TRANSPORTS.has(m.api))

/**
 * Fields the studio owns rather than Kie.
 *
 * `reference_images` is the optional reference offered on a text-to-X model;
 * the router moves it onto the sibling slug's own field and never submits it
 * under this name. See resolveRoute in lib/jobs/runner.ts.
 */
const OURS = new Set(['reference_images'])

console.log('\nslugs')

check('every model id is one Kie documents', () => {
  const unknown = market.filter((m) => !schemas[m.id]).map((m) => m.id)

  assert.deepEqual(
    unknown,
    [],
    `not in Kie's schemas: ${unknown.join(', ')}. A slug Kie does not know is ` +
      'rejected on submission, so the model never runs.',
  )
})

console.log('\nfields')

check('no model sends a field its schema does not define', () => {
  const problems: string[] = []

  for (const model of market) {
    const spec = schemas[model.id]
    if (!spec) continue

    const unknown = model.fields
      .map((f: Field) => f.name)
      .filter((name) => !OURS.has(name) && !(name in spec.fields))

    if (unknown.length) problems.push(`${model.id}: ${unknown.join(', ')}`)
  }

  assert.deepEqual(problems, [], `unknown fields:\n  ${problems.join('\n  ')}`)
})

check('every required field is present on the form', () => {
  const problems: string[] = []

  for (const model of market) {
    const spec = schemas[model.id]
    if (!spec) continue

    const ours = new Set(model.fields.map((f: Field) => f.name))
    const missing = spec.required.filter((name) => !ours.has(name))

    if (missing.length) problems.push(`${model.id}: ${missing.join(', ')}`)
  }

  // A required field the form never collects is a request Kie refuses.
  assert.deepEqual(problems, [], `missing required:\n  ${problems.join('\n  ')}`)
})

check('a required field is marked required, so validation catches it early', () => {
  const problems: string[] = []

  for (const model of market) {
    const spec = schemas[model.id]
    if (!spec) continue

    for (const name of spec.required) {
      const field = model.fields.find((f: Field) => f.name === name)
      // A select with a default always submits a value, so it satisfies the
      // requirement without the user being asked for it.
      if (!field) continue
      const hasDefault =
        'default' in field && (field as { default?: unknown }).default !== undefined

      if (!field.required && !hasDefault) {
        problems.push(`${model.id}.${name}`)
      }
    }
  }

  assert.deepEqual(
    problems,
    [],
    `required upstream but optional here, with no default:\n  ${problems.join('\n  ')}`,
  )
})

check('enum options match what the model accepts', () => {
  const problems: string[] = []

  for (const model of market) {
    const spec = schemas[model.id]
    if (!spec) continue

    for (const field of model.fields) {
      if (field.kind !== 'select' && field.kind !== 'ratio') continue

      const allowed = spec.fields[field.name]?.enum
      if (!allowed) continue

      const permitted = new Set(allowed.map(String))
      const offered = field.options.map((o) => o.value)
      const rejected = offered.filter((v) => !permitted.has(v))

      // Offering a value the model rejects turns a menu into a trap.
      if (rejected.length) {
        problems.push(`${model.id}.${field.name}: ${rejected.join(', ')}`)
      }
    }
  }

  assert.deepEqual(problems, [], `values Kie rejects:\n  ${problems.join('\n  ')}`)
})

console.log('\ncoverage')

check('the catalog reports how much of Kie it covers', () => {
  const documented = Object.keys(schemas)
  const covered = documented.filter((slug) => market.some((m) => m.id === slug))
  const missing = documented.filter((slug) => !covered.includes(slug))

  console.log(
    `      ${covered.length} of ${documented.length} job-API models` +
      `${missing.length ? `, ${missing.length} not carried` : ''}`,
  )

  // Not an assertion on the number: this is here to make the gap visible in
  // the test output rather than to freeze it.
  assert.ok(covered.length > 0)
})

console.log(`\n${passed} checks passed`)
