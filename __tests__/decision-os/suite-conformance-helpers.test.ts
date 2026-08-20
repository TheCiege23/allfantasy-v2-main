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
  describeTarget,
  isProductionHost,
  parseExplicitLeagueIds,
  parseManagerId,
  formatCheckLine,
} from '@/scripts/decision-os-suite-conformance-helpers'

/** Production is the (endpoint, database) PAIR — see scripts/db-target-identity.cjs. */
const PROD = 'postgresql://u:p@ep-curly-block-ad0dlt9o.c-2.us-east-1.aws.neon.tech/neondb'
const PROD_POOLED = 'postgresql://u:p@ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech/neondb'
const TEST_DB = 'postgresql://u:p@ep-muddy-leaf-adigvvph-pooler.c-2.us-east-1.aws.neon.tech/neondb'
/** The endpoint the old guard named as production. It is the claude-dashboard-local-dev FORK. */
const OLD_MARKER = 'postgresql://u:p@ep-spring-tooth-adaoi9x1.c-2.us-east-1.aws.neon.tech/neondb'

describe('describeTarget / isProductionHost', () => {
  it('describes a target without leaking credentials — it is used in logs and this repo is public', () => {
    const described = describeTarget(TEST_DB)
    expect(described).toContain('ep-muddy-leaf-adigvvph')
    expect(described).not.toContain('u:p')
    expect(described).not.toContain('p@')
  })

  it('reports unparseable input rather than throwing', () => {
    expect(describeTarget(null)).toContain('unparseable')
    expect(describeTarget('not a url')).toContain('unparseable')
  })

  it('flags the REAL production database, pooled and direct alike', () => {
    expect(isProductionHost(PROD)).toBe(true)
    expect(isProductionHost(PROD_POOLED)).toBe(true)
  })

  it('does not flag the test database', () => {
    expect(isProductionHost(TEST_DB)).toBe(false)
    expect(isProductionHost(null)).toBe(false)
  })

  // Regression: the guard used to key on 'ep-spring-tooth' and therefore flagged the dev fork as
  // production while letting ep-curly-block — the real one — straight through. The old unit test
  // asserted that inverted mapping, so it passed for as long as the bug existed.
  it('does NOT treat the old ep-spring-tooth marker as production', () => {
    expect(isProductionHost(OLD_MARKER)).toBe(false)
  })

  it('does not treat the dev shadow as production, even on production own compute', () => {
    expect(isProductionHost('postgresql://u:p@ep-curly-block-ad0dlt9o.c-2.us-east-1.aws.neon.tech/mydb_shadow')).toBe(false)
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
