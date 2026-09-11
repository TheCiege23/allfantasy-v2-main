/**
 * Universal League Hub — Part 6 truthful capability derivation.
 *
 * Every assertion here is a direct consequence of the Import Security
 * Closure phase's own findings: Sleeper is the only provider with a real
 * `true`/`false` commissioner signal; MFL/ESPN/Yahoo prove real membership
 * but never commissioner status (`membership_verified`, plus
 * `user_attested` only once a real attestation was recorded); Fantrax/
 * Fleaflicker are open-read and never membership-verified at all.
 */
import { describe, expect, it } from 'vitest'
import { deriveImportType, deriveProviderCapabilities } from '@/lib/shared-services/league-hub/providerCapabilities'

describe('deriveImportType', () => {
  it('labels native leagues native', () => {
    expect(deriveImportType({ provider: 'allfantasy' })).toBe('native')
  })

  it('labels sleeper/espn/yahoo/mfl as live_sync', () => {
    for (const provider of ['sleeper', 'espn', 'yahoo', 'mfl'] as const) {
      expect(deriveImportType({ provider })).toBe('live_sync')
    }
  })

  /*
   * 🛑 THIS REPLACES "labels fleaflicker as read_only (open-read, no membership verification)".
   * That test's own parenthetical is the bug it was pinning: open-read is an AUTHORIZATION fact,
   * and it was being used to answer a SYNC question. Fleaflicker is in `SYNCABLE_PROVIDERS` and is
   * refreshed on the same ten-minute heartbeat as everyone else, so `read_only` understated it on
   * the card.
   */
  it('REGRESSION: fleaflicker is live_sync — the collector refreshes it, whatever we can prove about the importer', () => {
    expect(deriveImportType({ provider: 'fleaflicker' })).toBe('live_sync')
  })

  /*
   * 🛑 AND THIS REPLACES "labels fantrax as csv_snapshot, never live_sync", which hardcoded a
   * provider-wide answer to a per-league question. Both Fantrax cases are asserted, because
   * getting either direction wrong has a real cost: `isSnapshotOnly` suppresses abandonment
   * recommendations, so a wrong `csv_snapshot` hides a real inactive manager from a commissioner,
   * and a wrong `live_sync` accuses someone on the strength of one months-old upload.
   */
  it('REGRESSION: a refreshable Fantrax league is live_sync, a CSV-era one is still csv_snapshot', () => {
    expect(deriveImportType({ provider: 'fantrax', isRefreshable: true })).toBe('live_sync')
    expect(deriveImportType({ provider: 'fantrax', isRefreshable: false })).toBe('csv_snapshot')
  })

  it('downgrades ANY provider whose league cannot be re-read, not just fantrax', () => {
    // The parameter is general because the question is. A league with no live source is a
    // snapshot regardless of which logo is on it.
    expect(deriveImportType({ provider: 'sleeper', isRefreshable: false })).toBe('csv_snapshot')
  })

  it('treats unknown refreshability as "ask the provider", never as "not refreshable"', () => {
    // Five of the six have nothing league-specific to know, so an absent answer must not downgrade
    // them — that would relabel every non-Fantrax league the moment a caller forgot to pass it.
    expect(deriveImportType({ provider: 'espn' })).toBe('live_sync')
    expect(deriveImportType({ provider: 'espn', isRefreshable: null })).toBe('live_sync')
  })

  it('never claims live_sync for an unrecognized/legacy platform string', () => {
    expect(deriveImportType({ provider: 'cbs' })).toBe('read_only')
    // Not even if a caller insists it is refreshable — the collector does not sync it.
    expect(deriveImportType({ provider: 'cbs', isRefreshable: true })).toBe('read_only')
  })
})

describe('deriveProviderCapabilities', () => {
  it('native leagues get exactly ["native"]', () => {
    expect(
      deriveProviderCapabilities({ provider: 'allfantasy', isCommissioner: true, settings: null })
    ).toEqual(['native'])
  })

  it('sleeper commissioner gets commissioner_verified (real API true/false signal)', () => {
    const badges = deriveProviderCapabilities({ provider: 'sleeper', isCommissioner: true, settings: null })
    expect(badges).toContain('live_sync')
    // auto_refresh, not manual_refresh: the collector re-reads this league every ten minutes.
    expect(badges).toContain('auto_refresh')
    expect(badges).not.toContain('manual_refresh')
    expect(badges).toContain('commissioner_verified')
    expect(badges).not.toContain('membership_verified')
  })

  it('sleeper non-commissioner member gets membership_verified, not commissioner_verified', () => {
    const badges = deriveProviderCapabilities({ provider: 'sleeper', isCommissioner: false, settings: null })
    expect(badges).toContain('membership_verified')
    expect(badges).not.toContain('commissioner_verified')
  })

  it('mfl with no recorded verification gets membership_verified only — never commissioner_verified', () => {
    const badges = deriveProviderCapabilities({ provider: 'mfl', isCommissioner: false, settings: null })
    expect(badges).toEqual(expect.arrayContaining(['live_sync', 'auto_refresh', 'membership_verified']))
    expect(badges).not.toContain('commissioner_verified')
    expect(badges).not.toContain('user_attested')
  })

  it('espn/yahoo with a real recorded attestation gets user_attested, still never commissioner_verified', () => {
    const settings = { commissionerVerification: { method: 'attestation' } }
    for (const provider of ['espn', 'yahoo'] as const) {
      const badges = deriveProviderCapabilities({ provider, isCommissioner: false, settings })
      expect(badges).toContain('membership_verified')
      expect(badges).toContain('user_attested')
      expect(badges).not.toContain('commissioner_verified')
    }
  })

  it('REGRESSION: a CSV-era fantrax league keeps csv_snapshot + manual_refresh, never membership_verified', () => {
    const badges = deriveProviderCapabilities({ provider: 'fantrax', isCommissioner: false, settings: null, isRefreshable: false })
    expect(badges).toEqual(['csv_snapshot', 'manual_refresh'])
  })

  it('REGRESSION: a refreshable fantrax league gets live_sync + auto_refresh, and still never membership_verified', () => {
    /*
     * The second half matters as much as the first. Becoming refreshable says something about the
     * DATA, not about what we can prove about the importer — Fantrax is still open-read, so a
     * membership claim here would be fabricated.
     */
    const badges = deriveProviderCapabilities({ provider: 'fantrax', isCommissioner: false, settings: null, isRefreshable: true })
    expect(badges).toEqual(['live_sync', 'auto_refresh'])
  })

  it('fantrax with a real recorded attestation gets user_attested', () => {
    const settings = { commissionerAttestation: { accepted: true } }
    const badges = deriveProviderCapabilities({ provider: 'fantrax', isCommissioner: false, settings })
    expect(badges).toContain('user_attested')
  })

  it('unrecognized platform string gets only the conservative read_only + manual_refresh, no fabricated verification', () => {
    const badges = deriveProviderCapabilities({ provider: 'cbs', isCommissioner: false, settings: null })
    expect(badges).toEqual(['read_only', 'manual_refresh'])
  })
})
