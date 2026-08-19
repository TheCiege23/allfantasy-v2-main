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
  hostOf,
  isProductionHost,
  parseExplicitLeagueIds,
  parseManagerId,
  formatCheckLine,
  PROD_HOST_MARKER,
} from '@/scripts/decision-os-suite-conformance-helpers'

describe('hostOf / isProductionHost', () => {
  it('extracts the host from a postgres URL', () => {
    expect(hostOf('postgresql://user:pass@ep-spring-tooth.us-east-1.aws.neon.tech/db')).toBe(
      'ep-spring-tooth.us-east-1.aws.neon.tech',
    )
  })

  it('returns "?" for a null or unparseable URL', () => {
    expect(hostOf(null)).toBe('?')
    expect(hostOf('not a url')).toBe('?')
  })

  it('flags the production host marker', () => {
    expect(isProductionHost('postgresql://user:pass@ep-spring-tooth.us-east-1.aws.neon.tech/db')).toBe(true)
  })

  it('does not flag a non-production host', () => {
    expect(isProductionHost('postgresql://user:pass@ep-throwaway-nonprod.us-east-1.aws.neon.tech/db')).toBe(false)
    expect(isProductionHost(null)).toBe(false)
  })

  it('the exported marker matches the existing scripts/decision-os-*-nonprod.ts convention', () => {
    expect(PROD_HOST_MARKER).toBe('ep-spring-tooth')
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
