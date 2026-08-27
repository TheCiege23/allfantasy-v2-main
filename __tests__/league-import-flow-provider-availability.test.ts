import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  IMPORT_PROVIDER_UI_OPTIONS,
  isImportProviderAvailable,
} from '@/lib/league-import/provider-ui-config'

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

  /**
   * ⚠ THIS TEST USED TO KEEP ITS OWN COPY OF THE PER-PROVIDER TRUTH TABLE, and
   * that copy drifted TWICE IN ONE DAY. Fleaflicker was flipped to available and
   * this file was missed; MFL was flipped hours later and it was missed again.
   * Both times the sibling audit — provider-availability-reconciliation.test.ts
   * — was updated correctly, so the two guards contradicted each other and main
   * went red for a change that was entirely legitimate.
   *
   * Two files asserting the same list is one file too many. The reconciliation
   * test IS the audit of record for which providers are available; this one goes
   * back to what only it can check — that the FLOW reads the config instead of
   * hardcoding a verdict, and that the config is internally coherent.
   */
  it('keeps Sleeper, the launch provider, available', () => {
    expect(isImportProviderAvailable('sleeper')).toBe(true)
  })

  it('never marks a provider available without the fields the tile needs', () => {
    const available = IMPORT_PROVIDER_UI_OPTIONS.filter((o) => o.available)
    expect(available.length).toBeGreaterThan(0)
    for (const option of available) {
      expect(option.label.trim()).not.toBe('')
      /* A tile claiming no sport tells the user nothing about what it imports. */
      expect(option.supportedSports.length).toBeGreaterThan(0)
    }
  })

  /**
   * The set changes as providers get built; what must not change is that it is
   * decided in ONE place. See provider-availability-reconciliation.test.ts for
   * the audited per-provider values.
   */
  it('routes every availability answer through the shared config', () => {
    for (const option of IMPORT_PROVIDER_UI_OPTIONS) {
      expect(isImportProviderAvailable(option.provider)).toBe(option.available)
    }
  })
})
