import { describe, it, expect } from 'vitest'
import {
  PROVIDER_ALLOWED_HOSTS,
  isSafeProviderUrl,
  resolveSourceLink,
} from '@/lib/league-links/sourceLinkResolver'

/**
 * The allowlist is CONFIGURATION THAT GOVERNS SECURITY, so it is pinned rather than exercised.
 *
 * ⚠ THIS FILE EXISTS BECAUSE THE REST OF THE SUITE CANNOT FAIL ON A WIDENED ALLOWLIST. Measured
 * 2026-08-29: adding `evil-sleeper.com.attacker.net` to Sleeper's hosts left all 27 existing tests
 * green, because every one of them exercises a URL that is already safe or already hostile — none
 * describes the config. A permissive host added later would ship unnoticed.
 *
 * Adding a host here is a deliberate, reviewable edit. That is the whole point: this test SHOULD
 * fail when the list changes, and the person changing it should have to say why.
 */
describe('source-link provider allowlist', () => {
  it('is exactly these hosts, per provider', () => {
    expect(PROVIDER_ALLOWED_HOSTS).toEqual({
      sleeper: ['sleeper.com', 'www.sleeper.com'],
      espn: ['fantasy.espn.com'],
      yahoo: ['football.fantasysports.yahoo.com'],
      mfl: ['www.myfantasyleague.com', 'myfantasyleague.com'],
      fantrax: ['www.fantrax.com', 'fantrax.com'],
      fleaflicker: ['www.fleaflicker.com', 'fleaflicker.com'],
    })
  })

  it('every allowed host is a bare hostname, never a wildcard or a url', () => {
    for (const hosts of Object.values(PROVIDER_ALLOWED_HOSTS)) {
      for (const h of hosts) {
        expect(h).toMatch(/^[a-z0-9.-]+$/)
        expect(h).not.toContain('*')
        expect(h).not.toContain('/')
      }
    }
  })

  /* A subdomain look-alike is the attack the exact-host rule exists to stop. */
  it('rejects a look-alike that merely CONTAINS an allowed host', () => {
    expect(
      isSafeProviderUrl('https://sleeper.com.attacker.net/leagues/1', PROVIDER_ALLOWED_HOSTS.sleeper),
    ).toBe(false)
    const link = resolveSourceLink({
      platform: 'sleeper',
      sourceLeagueId: '123',
      storedUrl: 'https://sleeper.com.attacker.net/leagues/1',
    })
    expect(link?.href).toBe('https://sleeper.com/leagues/123/league')
  })
})
