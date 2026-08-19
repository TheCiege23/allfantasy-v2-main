import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isImportProviderAvailable } from '@/lib/league-import/provider-ui-config'

/**
 * Drift guard: the /import UI must derive provider availability from the single
 * authoritative `provider-ui-config` (`isImportProviderAvailable`), never a
 * hardcoded literal. A prior patch regressed this by stamping every provider
 * `status: 'verified'`, which would falsely advertise fantrax/mfl/fleaflicker as
 * enabled. This complements the config-level
 * `__tests__/league-import/provider-availability-reconciliation.test.ts`.
 */
const flowSrc = readFileSync(
  resolve(__dirname, '../components/unified-import-ui/LeagueImportFlow.tsx'),
  'utf8',
)

describe('LeagueImportFlow — provider availability truth (no UI/config drift)', () => {
  it('derives availability from the authoritative config, not a hardcoded literal', () => {
    expect(flowSrc).toContain('isImportProviderAvailable')
    // The exact regression this guards against — every provider forced verified.
    expect(flowSrc).not.toContain("status: 'verified' as const")
  })

  it('config reflects launch truth: Sleeper enabled; unusable providers stay blocked', () => {
    // Sleeper is the launch-recommended, available provider.
    expect(isImportProviderAvailable('sleeper')).toBe(true)
    // Providers with no usable end-to-end import must not be silently enabled.
    expect(isImportProviderAvailable('fantrax')).toBe(false)
    expect(isImportProviderAvailable('mfl')).toBe(false)
    expect(isImportProviderAvailable('fleaflicker')).toBe(false)
  })
})
