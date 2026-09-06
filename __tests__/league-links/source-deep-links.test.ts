// @vitest-environment node
/**
 * Screen-aware source links — lineup, waivers, trade — behind a verified gate.
 *
 * The rule under test: an unverified format is never a destination. It falls
 * back to the league page and carries its URL as `candidate` for the
 * verification pass to click. The census at the bottom pins which formats are
 * verified today, so flipping a flag is a visible, deliberate test change.
 */
import { describe, expect, it } from 'vitest'
import {
  isSafeProviderUrl,
  normalizeYahooLeagueId,
  normalizeYahooTeamId,
  PROVIDER_ALLOWED_HOSTS,
  resolveSourceScreenLink,
  VERIFIED_SCREENS,
} from '@/lib/league-links/sourceLinkResolver'

describe('Yahoo id normalizers — three stored shapes, one URL number', () => {
  it('reads the league number out of a bare id, a full key, and a pasted URL', () => {
    expect(normalizeYahooLeagueId('1361311')).toBe('1361311')
    expect(normalizeYahooLeagueId('449.l.1361311')).toBe('1361311')
    expect(normalizeYahooLeagueId('https://football.fantasysports.yahoo.com/f1/1361311/3')).toBe('1361311')
    expect(normalizeYahooLeagueId('not-an-id')).toBeNull()
    expect(normalizeYahooLeagueId('')).toBeNull()
  })
  it('reads the team number out of a team key or a bare number', () => {
    expect(normalizeYahooTeamId('449.l.1361311.t.3')).toBe('3')
    expect(normalizeYahooTeamId('3')).toBe('3')
    expect(normalizeYahooTeamId('u-tasha')).toBeNull()
  })
})

describe('resolveSourceScreenLink', () => {
  const sleeper = { platform: 'sleeper', sourceLeagueId: '123456', leagueName: 'Dynasty Dragons', season: 2026 }
  const espn = { platform: 'espn', sourceLeagueId: '888', leagueName: 'Gridiron Gang', season: 2026, teamId: '2' }
  const yahoo = { platform: 'yahoo', sourceLeagueId: '449.l.1361311', leagueName: 'Waiver Warriors', season: 2026, teamId: '449.l.1361311.t.3' }

  it('Sleeper lineup and waivers are verified and land on the screen', () => {
    const lineup = resolveSourceScreenLink({ ...sleeper, screen: 'lineup' })
    expect(lineup).toMatchObject({ href: 'https://sleeper.com/leagues/123456/team', verified: true, screen: 'lineup', destinationType: 'action', candidate: null })
    const waivers = resolveSourceScreenLink({ ...sleeper, screen: 'waivers' })
    expect(waivers).toMatchObject({ href: 'https://sleeper.com/leagues/123456/players', verified: true, screen: 'waivers' })
  })

  /*
   * ⚠ THE GATE. Unverified means the league page, with the candidate carried,
   * never used. Sleeper's trade screen was the last unverified launch format
   * and it flipped on 2026-09-06 (Guap opened it on league 1313566817444167680
   * and landed on the trade screen), so no live format exercises the gate
   * today — the no-format branch below is the nearest live neighbour. Adding
   * a provider screen with `verified: false` must come with a test here.
   */
  it('Sleeper trade is verified and lands on the trade screen', () => {
    const trade = resolveSourceScreenLink({ ...sleeper, screen: 'trade' })
    expect(trade).toMatchObject({ href: 'https://sleeper.com/leagues/123456/trades', verified: true, screen: 'trade', destinationType: 'action', candidate: null })
  })

  it('a provider with no screen formats falls back to its approved page, unverified, with nothing to carry', () => {
    const trade = resolveSourceScreenLink({ platform: 'mfl', sourceLeagueId: '123', leagueName: 'Old Guard', season: 2026, screen: 'trade' })
    expect(trade).toMatchObject({ verified: false, screen: 'trade', candidate: null })
    expect(trade.href).toMatch(/^https:\/\/www\.myfantasyleague\.com/)
  })

  /*
   * Verified 2026-09-05 on Guap's own leagues, each opened signed in and the
   * settled URL pasted back: ESPN league 919055222 team 7 season 2026, Yahoo
   * league 1361311 team 10. The expected hrefs below ARE those settled URLs.
   */
  it('ESPN lineup and waivers are verified and land on the team page and the free-agent list', () => {
    const real = { platform: 'espn', sourceLeagueId: '919055222', season: 2026, teamId: '7' }
    expect(resolveSourceScreenLink({ ...real, screen: 'lineup' })).toMatchObject({
      href: 'https://fantasy.espn.com/football/team?leagueId=919055222&teamId=7&seasonId=2026',
      verified: true,
      screen: 'lineup',
      destinationType: 'action',
      candidate: null,
    })
    expect(resolveSourceScreenLink({ ...real, screen: 'waivers' })).toMatchObject({
      href: 'https://fantasy.espn.com/football/players/add?leagueId=919055222&seasonId=2026',
      verified: true,
      screen: 'waivers',
    })
  })

  /*
   * ESPN has no standalone trade URL: `/football/trade?…` returned "Page not
   * found" on league 919055222. A trade is proposed from the other manager's
   * team page, so the trade link is the verified team-page format with the
   * PARTNER's id — and with no partner known, the league page.
   */
  it('ESPN trade lands on the partner’s team page, and on the league page without a partner', () => {
    const real = { platform: 'espn', sourceLeagueId: '919055222', season: 2026, teamId: '7' }
    expect(resolveSourceScreenLink({ ...real, screen: 'trade', partnerTeamId: '3' })).toMatchObject({
      href: 'https://fantasy.espn.com/football/team?leagueId=919055222&teamId=3&seasonId=2026',
      verified: true,
      screen: 'trade',
    })
    expect(resolveSourceScreenLink({ ...real, screen: 'trade' })).toMatchObject({
      href: 'https://fantasy.espn.com/football/league?leagueId=919055222&seasonId=2026',
      verified: false,
      candidate: null,
    })
  })

  it('Yahoo lineup, waivers and trade are verified, from any stored id shape', () => {
    const fromUrl = { platform: 'yahoo', sourceLeagueId: 'https://football.fantasysports.yahoo.com/f1/1361311/10', teamId: '10' }
    expect(resolveSourceScreenLink({ ...fromUrl, screen: 'lineup' })).toMatchObject({ href: 'https://football.fantasysports.yahoo.com/f1/1361311/10', verified: true })
    expect(resolveSourceScreenLink({ ...fromUrl, screen: 'waivers' })).toMatchObject({ href: 'https://football.fantasysports.yahoo.com/f1/1361311/players', verified: true })
    // Verified without a counterparty parameter; none is appended even when a partner is known.
    expect(resolveSourceScreenLink({ ...fromUrl, screen: 'trade', partnerTeamId: '449.l.1361311.t.7' })).toMatchObject({
      href: 'https://football.fantasysports.yahoo.com/f1/1361311/10/proposetrade',
      verified: true,
      screen: 'trade',
    })
    const fromKey = { platform: 'yahoo', sourceLeagueId: '449.l.1361311', teamId: '449.l.1361311.t.10' }
    expect(resolveSourceScreenLink({ ...fromKey, screen: 'trade' })?.href).toBe('https://football.fantasysports.yahoo.com/f1/1361311/10/proposetrade')
  })

  it('a format that needs a team id builds no candidate without one', () => {
    const noTeam = resolveSourceScreenLink({ ...espn, teamId: null, screen: 'lineup' })
    expect(noTeam).toMatchObject({ verified: false, candidate: null, destinationType: 'league' })
    const badTeam = resolveSourceScreenLink({ ...espn, teamId: 'u-me', screen: 'trade' })
    expect(badTeam?.candidate).toBeNull()
  })

  it('the league screen is the plain league page, and a native league resolves to nothing', () => {
    expect(resolveSourceScreenLink({ ...espn, screen: 'league' })).toMatchObject({ screen: 'league', verified: true, candidate: null })
    expect(resolveSourceScreenLink({ platform: 'manual', sourceLeagueId: 'x', screen: 'lineup' })).toBeNull()
  })

  it('every href AND every candidate passes the provider allowlist', () => {
    for (const ctx of [sleeper, espn, yahoo]) {
      for (const screen of ['league', 'lineup', 'waivers', 'trade'] as const) {
        const link = resolveSourceScreenLink({ ...ctx, screen, partnerTeamId: '5' })
        expect(link).not.toBeNull()
        const hosts = PROVIDER_ALLOWED_HOSTS[link!.provider]
        expect(isSafeProviderUrl(link!.href, hosts)).toBe(true)
        if (link!.candidate) expect(isSafeProviderUrl(link!.candidate, hosts)).toBe(true)
      }
    }
  })
})

/*
 * 🛑 THE CENSUS. A format becomes verified only with the league and team id it
 * was opened on, recorded in the commit that flips it. If this assertion
 * fails, someone flipped a flag — make sure that record exists.
 */
describe('VERIFIED_SCREENS census', () => {
  it('pins which formats are live destinations today', () => {
    expect(VERIFIED_SCREENS).toEqual({
      // Sleeper trade verified 2026-09-06 by Guap on league 1313566817444167680 (roster 1).
      sleeper: ['league', 'lineup', 'waivers', 'trade'],
      // Verified 2026-09-05 by Guap on league 919055222 / team 7 (ESPN) and 1361311 / team 10 (Yahoo).
      // ESPN "trade" is the partner's team page — /football/trade 404s.
      espn: ['league', 'lineup', 'waivers', 'trade'],
      yahoo: ['league', 'lineup', 'waivers', 'trade'],
      mfl: [],
      fantrax: [],
      fleaflicker: [],
    })
  })
})
