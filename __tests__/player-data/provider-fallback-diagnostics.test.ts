import { describe, expect, it, vi } from 'vitest'
import {
  logNormalizedPlayerDataDiagnostics,
  redactDiagnosticsForLog,
  type ProviderFallbackDiagnostics,
} from '@/lib/player-data/providerFallbackDiagnostics'

describe('provider fallback diagnostics helpers', () => {
  it('redactDiagnosticsForLog strips suspicious keys', () => {
    const d = {
      surface: 'draft',
      sport: 'NFL',
      primaryByDomain: {},
      missingDomains: [],
      playerId: 'x',
      api_key: 'secret',
    } as unknown as ProviderFallbackDiagnostics
    const r = redactDiagnosticsForLog(d)
    expect(r).not.toHaveProperty('api_key')
  })

  it('logNormalizedPlayerDataDiagnostics respects limit', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const diags: ProviderFallbackDiagnostics[] = Array.from({ length: 10 }, (_, i) => ({
      surface: 'waivers',
      sport: 'NFL',
      primaryByDomain: {},
      missingDomains: [],
      playerId: `p${i}`,
    }))
    logNormalizedPlayerDataDiagnostics('test', diags, { enabled: true, limit: 3 })
    expect(spy.mock.calls.length).toBe(3)
    spy.mockRestore()
  })
})
