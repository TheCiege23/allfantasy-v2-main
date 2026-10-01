import { describe, expect, it } from 'vitest'
import { buildIntegrityCoverage } from '@/lib/integrity/coverage'

describe('integrity coverage', () => {
  const base = {
    platform: 'manual',
    hasNativeRedraftSeason: true,
    tankingEnabled: true,
    lastCollusionScanAt: null,
    lastTankingScanAt: null,
  }

  it('does not call an imported or uninitialized league clean', () => {
    expect(buildIntegrityCoverage({ ...base, platform: 'sleeper' }).collusion.status).toBe('unsupported')
    expect(buildIntegrityCoverage({ ...base, hasNativeRedraftSeason: false }).tanking.status).toBe('unsupported')
  })

  it('distinguishes disabled, never scanned and scanned', () => {
    const at = new Date('2026-09-20T12:00:00.000Z')
    const coverage = buildIntegrityCoverage({ ...base, tankingEnabled: false, lastCollusionScanAt: at })
    expect(coverage.collusion).toEqual({ status: 'scanned', lastScannedAt: at.toISOString() })
    expect(coverage.tanking.status).toBe('disabled')
    expect(buildIntegrityCoverage(base).tanking.status).toBe('never_scanned')
  })
})
