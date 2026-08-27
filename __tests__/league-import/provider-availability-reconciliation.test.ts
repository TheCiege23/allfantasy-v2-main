// @vitest-environment node
/**
 * Guards lib/league-import/provider-ui-config.ts (which gates ImportProviderSelector.tsx —
 * the real, authenticated /startup-dynasty import picker) against silently drifting from an
 * actual end-to-end audit. hasFullAdapter() can't serve this role: it's a structural "is an
 * adapter class registered" check that is true for every provider here regardless of whether a
 * real user can actually complete an import today, so it always passed even while three
 * providers were unusable behind an `available: true` flag. See
 * docs/redraft/G61_IMPORT_PROVIDER_AVAILABILITY_RECONCILIATION.md for the audit this list
 * reflects. If you're changing a value below, you're expected to have re-verified the provider
 * end-to-end (or built the missing piece) — not just flipping a flag to unblock a build.
 */
import { describe, it, expect } from 'vitest'
import { IMPORT_PROVIDER_UI_OPTIONS } from '@/lib/league-import/provider-ui-config'

const EXPECTED_AVAILABILITY: Record<string, boolean> = {
  sleeper: true,
  espn: true,
  yahoo: true,
  /*
   * Flipped 2026-08-27 with the missing piece built, not to unblock anything.
   * Fantrax has a live read API (`fxea`), so the import runs from a league id:
   * discovery reads getLeagueInfo and lists the league's TEAMS, the chosen team
   * rides in the sourceId as `fantrax-league:<leagueId>|<teamName>`, and
   * fetchFantraxLeagueForImport materialises the snapshot before the existing
   * ownership gate and normalisation run unchanged. Verified against a real
   * league end to end; see the G61 doc.
   */
  fantrax: true,
  mfl: false,
  fleaflicker: false,
}

describe('provider-ui-config availability reconciliation', () => {
  it('matches the last audited state exactly', () => {
    const actual = Object.fromEntries(IMPORT_PROVIDER_UI_OPTIONS.map((o) => [o.provider, o.available]))
    expect(actual).toEqual(EXPECTED_AVAILABILITY)
  })

  it('covers every provider this test knows about, and vice versa', () => {
    const configuredProviders = IMPORT_PROVIDER_UI_OPTIONS.map((o) => o.provider).sort()
    const expectedProviders = Object.keys(EXPECTED_AVAILABILITY).sort()
    expect(configuredProviders).toEqual(expectedProviders)
  })
})
