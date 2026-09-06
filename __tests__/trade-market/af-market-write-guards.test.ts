import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { endpointFromDatabaseUrl, endpointMatches } from '@/lib/db/databaseEndpoint'

/**
 * Two guards on the AF market-value writer, added 2026-09-06 after it was run against production
 * with neither in place:
 *
 *   1. `--write` requires `--endpoint=<id>` — a POSITIVE allowlist naming the database.
 *   2. The centring gate is evaluated inside the run that writes, not in a separate dry call.
 */

const raw = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

/**
 * ⚠ NEGATIVES AGAINST COMMENT-STRIPPED SOURCE. Both files DOCUMENT the old two-call shape in
 * their headers as a warning, so a raw scan matches the prose and reports the defect as present.
 */
const stripComments = (src: string) =>
  src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join('\n')

const WRITER = 'scripts/recalculate-af-market-values-from-trades.ts'
const MODULE = 'lib/trade-market/completedTradeObservations.ts'

describe('endpointFromDatabaseUrl', () => {
  it('reduces a Neon URL to the endpoint id', () => {
    expect(endpointFromDatabaseUrl('postgresql://u:p@ep-curly-block-ad0dlt9o.c-2.us-east-1.aws.neon.tech/db')).toBe(
      'ep-curly-block-ad0dlt9o',
    )
  })

  it('🛑 TREATS THE POOLED AND DIRECT HOSTS AS ONE ENDPOINT — they are the same database', () => {
    /*
     * DATABASE_URL and DIRECT_URL differ by exactly this suffix in this repo. A guard comparing
     * raw hosts would refuse a correct --endpoint= whenever the caller read the other variable,
     * and the natural "fix" for that is to loosen the comparison — which is how a positive
     * allowlist quietly degrades into a substring test.
     */
    const pooled = 'postgresql://u:p@ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech/db'
    const direct = 'postgresql://u:p@ep-curly-block-ad0dlt9o.c-2.us-east-1.aws.neon.tech/db'
    expect(endpointFromDatabaseUrl(pooled)).toBe(endpointFromDatabaseUrl(direct))
    expect(endpointFromDatabaseUrl(pooled)).toBe('ep-curly-block-ad0dlt9o')
  })

  it('handles a port, a query string, and a bare host', () => {
    expect(endpointFromDatabaseUrl('postgresql://u:p@localhost:5432/db')).toBe('localhost')
    expect(endpointFromDatabaseUrl('postgresql://u:p@ep-x.neon.tech/db?sslmode=require')).toBe('ep-x')
    // The vitest db-guard sentinel, so a pinned run is legible rather than mysterious.
    expect(endpointFromDatabaseUrl('postgresql://u:p@127.0.0.1:1/db')).toBe('127.0.0.1')
  })

  it('🛑 [regression] AN IP IS NOT REDUCED TO ITS FIRST OCTET — that made different hosts equal', () => {
    /*
     * Caught by the test above on its first run: the first-label rule turned `127.0.0.1` into
     * `127`, so `127.0.0.1` and `127.0.0.2` compared EQUAL. A false REFUSAL is merely annoying;
     * a false MATCH is the failure this guard exists to prevent.
     */
    expect(endpointFromDatabaseUrl('postgresql://u:p@127.0.0.1:5432/db')).not.toBe(
      endpointFromDatabaseUrl('postgresql://u:p@127.0.0.2:5432/db'),
    )
    expect(endpointMatches('postgresql://u:p@10.0.0.1/db', '10.0.0.2')).toBe(false)
  })

  it('🛑 RETURNS null RATHER THAN A GUESS when there is nothing to compare', () => {
    for (const bad of [null, undefined, '', 'not-a-url', 'postgresql://nohost']) {
      expect(endpointFromDatabaseUrl(bad as string | null | undefined)).toBeNull()
    }
  })
})

describe('endpointMatches — the guard itself', () => {
  const PROD = 'postgresql://u:p@ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech/db'

  it('permits only the endpoint the operator named', () => {
    expect(endpointMatches(PROD, 'ep-curly-block-ad0dlt9o')).toBe(true)
    expect(endpointMatches(PROD, '  ep-curly-block-ad0dlt9o  ')).toBe(true)
    expect(endpointMatches(PROD, 'ep-muddy-leaf-adigvvph')).toBe(false)
  })

  it('🛑 A MISSING FLAG IS A REFUSAL, NOT A WILDCARD — that is the case it exists for', () => {
    for (const missing of ['', null, undefined]) {
      expect(endpointMatches(PROD, missing as string | null | undefined)).toBe(false)
    }
  })

  it('🛑 AN UNRESOLVED URL REFUSES EVEN WHEN A FLAG IS GIVEN', () => {
    /*
     * `@prisma/client` populates DATABASE_URL from `.env` on import and `.env` points at prod, so
     * "unset" is never the safe state here. Failing closed is the only correct direction.
     */
    expect(endpointMatches(undefined, 'ep-curly-block-ad0dlt9o')).toBe(false)
    expect(endpointMatches('', 'ep-curly-block-ad0dlt9o')).toBe(false)
  })

  it('[control] a substring is NOT a match — this is an allowlist, not a `includes` test', () => {
    expect(endpointMatches(PROD, 'ep-curly')).toBe(false)
    expect(endpointMatches(PROD, 'curly-block')).toBe(false)
  })
})

describe('the writer wires both guards', () => {
  it('🛑 CALLS recalculateFromCompletedTrades EXACTLY ONCE — the race was two calls', () => {
    /*
     * The gate used to be evaluated on a separate invocation from the write, over a table the
     * Sleeper sync appends to every ten minutes. Structural, so it is asserted structurally: a
     * second call site reintroduces the race no matter what the arguments say.
     */
    const code = stripComments(raw(WRITER))
    const calls = code.match(/recalculateFromCompletedTrades\(/g) ?? []
    expect(calls).toHaveLength(1)
    expect(code).toContain('requireCentred: true')
    expect(code).toContain('dryRun: !write')
  })

  it('🛑 refuses a write unless the endpoint is named, BEFORE any call', () => {
    const code = stripComments(raw(WRITER))
    expect(code).toContain("from '../lib/db/databaseEndpoint'")
    expect(code).toMatch(/if \(write && !endpointMatches\(/)

    // The guard must precede the computation, or a refusal still costs a full gather.
    const guardAt = code.indexOf('endpointMatches(')
    const callAt = code.indexOf('recalculateFromCompletedTrades(prisma')
    expect(guardAt).toBeGreaterThan(-1)
    expect(callAt).toBeGreaterThan(-1)
    expect(guardAt).toBeLessThan(callAt)
  })

  it('⚠ reports the verdict the run REACHED, not a second opinion about it', () => {
    /*
     * On a write the printed PASS/FAIL reads `refused` — the flag that decided whether rows were
     * stored. Re-deriving it beside the real gate is how the probe came to disagree with the
     * writer, so no hard-coded tolerance may reappear here.
     */
    const code = stripComments(raw(WRITER))
    expect(code).toContain("dry.refused === 'not_centred'")
    expect(code).not.toMatch(/<=\s*1\.5/)
    expect(code).not.toMatch(/CENTRING_TOLERANCE\s*=/)
  })

  it('🛑 the module gates its write block on the same flag it returns', () => {
    const code = stripComments(raw(MODULE))
    expect(code).toContain('refused')
    expect(code).toMatch(/if \(!dryRun && refused === null\)/)
    // The gate is computed from THIS run's median, not from an argument handed in.
    expect(code).toMatch(/!isCentred\(medianAdjustment\)/)
  })

  it('[control] the scan reads real files and real code, so the negatives cannot pass vacuously', () => {
    for (const p of [WRITER, MODULE]) {
      const code = stripComments(raw(p))
      expect(code.length).toBeGreaterThan(400)
      expect(code).toContain('recalculateFromCompletedTrades')
    }
  })
})
