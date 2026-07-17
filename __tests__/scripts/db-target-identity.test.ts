/**
 * db-target-identity — production/non-production classification.
 *
 * This guard has been wrong twice. On 2026-07-14 the production marker was set to the
 * dev clone's endpoint, which meant every guard in the repo refused the dev clone and
 * PERMITTED real production. These tests exist to make that class of mistake loud.
 *
 * The two properties that actually matter:
 *   1. FAIL CLOSED — anything not positively recognised as safe is refused. A wrong
 *      table then costs a confused developer, not the production database.
 *   2. HOST IS NOT ENOUGH — local dev shares production's COMPUTE and is isolated only
 *      by database name (ep-curly-block-ad0dlt9o/mydb_shadow vs /neondb). Classification
 *      must be keyed on (endpoint, database) or it cannot be both safe and usable.
 */

import { describe, expect, it } from 'vitest'

// require: the module is CommonJS so the bare-`node` guards can load it without tsx.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const identity = require('../../scripts/db-target-identity.cjs') as typeof import('../../scripts/db-target-identity')

const {
  classifyDatabaseTarget,
  isProductionOrUnknownTarget,
  assertNonProductionTarget,
  describeTarget,
  PRODUCTION_TARGETS,
  NONPRODUCTION_TARGETS,
} = identity

const PROD = 'postgresql://u:p@ep-curly-block-ad0dlt9o.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require'
const PROD_POOLED = 'postgresql://u:p@ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require'
const PROD_BINDING = 'postgresql://u:p@ep-curly-block-ad0dlt9o-llc.c-2.us-east-1.aws.neon.tech/neondb'
const LOCAL_DEV = 'postgresql://u:p@ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech/mydb_shadow?sslmode=require'
const DEV_CLONE = 'postgresql://u:p@ep-spring-tooth-adaoi9x1.c-2.us-east-1.aws.neon.tech/neondb'
const EPHEMERAL = 'postgresql://u:p@ep-ancient-base-adn6yz7w.c-2.us-east-1.aws.neon.tech/neondb'

describe('the verified production target', () => {
  // Verified 2026-07-17 against Neon project icy-field-51189449 via three independent
  // signals: branch name "production", primary:true/default:true, and 26.8M xact_commit
  // vs the clone's 126k.
  it('is ep-curly-block-ad0dlt9o/neondb, and nothing else', () => {
    expect(PRODUCTION_TARGETS).toEqual([
      expect.objectContaining({ endpoint: 'ep-curly-block-ad0dlt9o', database: 'neondb' }),
    ])
  })

  it('classifies production as production across every Neon hostname variant', () => {
    for (const url of [PROD, PROD_POOLED, PROD_BINDING]) {
      expect(classifyDatabaseTarget(url, {}).classification).toBe('production')
    }
  })

  // The 2026-07-14 inversion, asserted directly: spring-tooth is a fork of production,
  // NOT production. If someone "fixes" the table back, this fails.
  it('does NOT classify the ep-spring-tooth dev clone as production', () => {
    expect(classifyDatabaseTarget(DEV_CLONE, {}).classification).toBe('non-production')
  })
})

describe('host alone is not enough — the mydb_shadow nuance', () => {
  it('treats /neondb and /mydb_shadow on the SAME compute as different classifications', () => {
    expect(classifyDatabaseTarget(PROD_POOLED, {}).classification).toBe('production')
    expect(classifyDatabaseTarget(LOCAL_DEV, {}).classification).toBe('non-production')
  })

  it('keeps local dev against mydb_shadow usable', () => {
    expect(isProductionOrUnknownTarget(LOCAL_DEV, {})).toBe(false)
    expect(() => assertNonProductionTarget(LOCAL_DEV, { env: {} })).not.toThrow()
  })
})

describe('fails closed', () => {
  it.each([
    ['an unlisted Neon endpoint', EPHEMERAL],
    ['an unparseable URL', 'not-a-url'],
    ['an empty URL', ''],
    ['a null URL', null],
    ['some other provider', 'postgresql://u:p@db.example.supabase.co:5432/postgres'],
  ])('refuses %s', (_label, url) => {
    expect(classifyDatabaseTarget(url as string, {}).classification).toBe('unknown')
    expect(isProductionOrUnknownTarget(url as string, {})).toBe(true)
    expect(() => assertNonProductionTarget(url as string, { env: {} })).toThrow(/REFUSING/)
  })

  it('permits localhost', () => {
    expect(classifyDatabaseTarget('postgresql://u:p@localhost:5432/anything', {}).classification).toBe('non-production')
  })

  // The regression that started all this: a wrong table must degrade to refusing dev,
  // never to permitting prod. With production mislabelled, prod lands in `unknown` —
  // which is still refused.
  it('still refuses production when the production entry is missing entirely', () => {
    const url = new URL(PROD.replace(/^postgres(ql)?:\/\//, 'http://'))
    expect(['production', 'unknown']).toContain(classifyDatabaseTarget(PROD, {}).classification)
    expect(url.pathname).toBe('/neondb')
    // An endpoint that is in NO table at all — the shape a mislabelled prod would take.
    expect(isProductionOrUnknownTarget(EPHEMERAL, {})).toBe(true)
  })
})

describe('AF_NONPROD_ENDPOINT_ACK escape hatch', () => {
  it('permits a named disposable endpoint', () => {
    expect(
      classifyDatabaseTarget(EPHEMERAL, { AF_NONPROD_ENDPOINT_ACK: 'ep-ancient-base-adn6yz7w' }).classification,
    ).toBe('non-production')
  })

  it('can NEVER downgrade a known production target', () => {
    expect(classifyDatabaseTarget(PROD, { AF_NONPROD_ENDPOINT_ACK: 'ep-curly-block-ad0dlt9o' }).classification).toBe(
      'production',
    )
    expect(() => assertNonProductionTarget(PROD, { env: { AF_NONPROD_ENDPOINT_ACK: 'ep-curly-block-ad0dlt9o' } })).toThrow(
      /PRODUCTION/,
    )
  })

  it('is not a blanket bypass — it must name the endpoint actually being used', () => {
    expect(classifyDatabaseTarget(EPHEMERAL, { AF_NONPROD_ENDPOINT_ACK: 'true' }).classification).toBe('unknown')
    expect(classifyDatabaseTarget(EPHEMERAL, { AF_NONPROD_ENDPOINT_ACK: 'ep-some-other-branch' }).classification).toBe(
      'unknown',
    )
  })
})

describe('endpoint matching is label-exact', () => {
  it('does not confuse a longer endpoint id that shares a prefix', () => {
    const nearMiss = 'postgresql://u:p@ep-curly-block-ad0dlt9o2.c-2.us-east-1.aws.neon.tech/neondb'
    expect(classifyDatabaseTarget(nearMiss, {}).classification).toBe('unknown')
  })
})

describe('describeTarget', () => {
  it('reports endpoint/database and never leaks credentials', () => {
    expect(describeTarget(PROD_POOLED)).toBe('ep-curly-block-ad0dlt9o/neondb')
    expect(describeTarget(LOCAL_DEV)).toBe('ep-curly-block-ad0dlt9o/mydb_shadow')
    expect(describeTarget(PROD_POOLED)).not.toContain('p@')
  })
})

describe('the known non-production table', () => {
  it('documents mydb_shadow as sharing production compute', () => {
    const shadow = NONPRODUCTION_TARGETS.find((t) => t.database === 'mydb_shadow')
    expect(shadow?.endpoint).toBe('ep-curly-block-ad0dlt9o')
    expect(shadow?.note.toLowerCase()).toContain('compute')
  })
})
