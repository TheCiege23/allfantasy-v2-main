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
    expect(deriveImportType('allfantasy')).toBe('native')
  })

  it('labels fantrax as csv_snapshot, never live_sync', () => {
    expect(deriveImportType('fantrax')).toBe('csv_snapshot')
  })

  it('labels fleaflicker as read_only (open-read, no membership verification)', () => {
    expect(deriveImportType('fleaflicker')).toBe('read_only')
  })

  it('labels sleeper/espn/yahoo/mfl as live_sync', () => {
    expect(deriveImportType('sleeper')).toBe('live_sync')
    expect(deriveImportType('espn')).toBe('live_sync')
    expect(deriveImportType('yahoo')).toBe('live_sync')
    expect(deriveImportType('mfl')).toBe('live_sync')
  })

  it('never claims live_sync for an unrecognized/legacy platform string', () => {
    expect(deriveImportType('cbs')).toBe('read_only')
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
    expect(badges).toContain('manual_refresh')
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
    expect(badges).toEqual(expect.arrayContaining(['live_sync', 'manual_refresh', 'membership_verified']))
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

  it('fantrax gets csv_snapshot + manual_refresh, never membership_verified', () => {
    const badges = deriveProviderCapabilities({ provider: 'fantrax', isCommissioner: false, settings: null })
    expect(badges).toEqual(['csv_snapshot', 'manual_refresh'])
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
