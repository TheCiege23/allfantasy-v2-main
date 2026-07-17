/**
 * Fantasy OS Suite — Phase D Increment 6.
 *
 * Pure unit tests for the conformance script's CLI/safety helpers — the clean testable seam
 * extracted specifically so this increment's "add tests only if there is a clean unit/integration
 * seam" instruction has one to use, mirroring `scripts/manager-intelligence/nonprodValidationGuard.ts`'s
 * own established test pattern.
 */
import { describe, it, expect } from 'vitest'
import {
  shouldRefuseTarget,
  refusalReason,
  describeTarget,
  parseExplicitLeagueIds,
  parseManagerId,
  formatCheckLine,
} from '@/scripts/decision-os-suite-conformance-helpers'

/**
 * These helpers no longer own classification — scripts/db-target-identity.cjs does, and its own
 * suite covers the rules. What matters here is that this module still refuses correctly after
 * delegating, including for targets that are merely unrecognised.
 *
 * The previous version of this block asserted `PROD_HOST_MARKER === 'ep-spring-tooth'`, which
 * pinned the 2026-07-14 inversion in place: the marker named a dev clone, so the guards permitted
 * real production, and this test enforced that. Assert the SAFETY PROPERTY, never the literal
 * endpoint id — endpoint ids drift, and a test that hardcodes one converts drift into a
 * green build.
 */
describe('shouldRefuseTarget', () => {
  const PROD = 'postgresql://user:pass@ep-curly-block-ad0dlt9o.c-2.us-east-1.aws.neon.tech/neondb'
  const LOCAL_DEV = 'postgresql://user:pass@ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech/mydb_shadow'

  it('refuses production', () => {
    expect(shouldRefuseTarget(PROD)).toBe(true)
    expect(refusalReason(PROD)).toMatch(/PRODUCTION/i)
  })

  it('permits local dev on mydb_shadow — the same compute as production, a different database', () => {
    expect(shouldRefuseTarget(LOCAL_DEV)).toBe(false)
  })

  it('refuses anything unrecognised, null, or unparseable (fails closed)', () => {
    expect(shouldRefuseTarget('postgresql://user:pass@ep-unlisted-branch-zz99xx11.aws.neon.tech/neondb')).toBe(true)
    expect(shouldRefuseTarget(null)).toBe(true)
    expect(shouldRefuseTarget('not a url')).toBe(true)
  })

  it('describeTarget reports endpoint/database without credentials', () => {
    expect(describeTarget(LOCAL_DEV)).toBe('ep-curly-block-ad0dlt9o/mydb_shadow')
    expect(describeTarget(LOCAL_DEV)).not.toContain('pass')
  })
})

describe('parseExplicitLeagueIds', () => {
  it('parses a comma-separated --leagueIds= flag', () => {
    expect(parseExplicitLeagueIds(['--leagueIds=L1,L2,L3'])).toEqual(['L1', 'L2', 'L3'])
  })

  it('trims whitespace and drops empty entries', () => {
    expect(parseExplicitLeagueIds(['--leagueIds=L1, L2 ,,L3'])).toEqual(['L1', 'L2', 'L3'])
  })

  it('returns an empty array when the flag is absent — never auto-discovers', () => {
    expect(parseExplicitLeagueIds(['--managerId=u1'])).toEqual([])
    expect(parseExplicitLeagueIds([])).toEqual([])
  })
})

describe('parseManagerId', () => {
  it('parses the --managerId= flag', () => {
    expect(parseManagerId(['--leagueIds=L1', '--managerId=u1'])).toBe('u1')
  })

  it('returns null when absent or empty', () => {
    expect(parseManagerId(['--leagueIds=L1'])).toBeNull()
    expect(parseManagerId(['--managerId='])).toBeNull()
  })
})

describe('formatCheckLine', () => {
  it('formats a passing check with a checkmark', () => {
    expect(formatCheckLine({ name: 'league health resolves', ok: true, detail: 'status=healthy' })).toBe(
      '✅ league health resolves  — status=healthy',
    )
  })

  it('formats a failing check with an X and omits the separator when detail is empty', () => {
    expect(formatCheckLine({ name: 'user os resolves', ok: false, detail: '' })).toBe('❌ user os resolves')
  })
})
