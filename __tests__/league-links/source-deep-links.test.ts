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

  /* ⚠ THE GATE. Unverified means the league page, with the candidate carried, never used. */
  it('an unverified format falls back to the league page and carries its candidate', () => {
    const trade = resolveSourceScreenLink({ ...sleeper, screen: 'trade' })
    expect(trade).toMatchObject({ href: 'https://sleeper.com/leagues/123456/league', verified: false, destinationType: 'league', candidate: 'https://sleeper.com/leagues/123456/trades' })

    const espnWaivers = resolveSourceScreenLink({ ...espn, screen: 'waivers' })
    expect(espnWaivers).toMatchObject({
      href: 'https://fantasy.espn.com/football/league?leagueId=888&seasonId=2026',
      verified: false,
      candidate: 'https://fantasy.espn.com/football/players/add?leagueId=888&seasonId=2026',
    })

    const yahooWaivers = resolveSourceScreenLink({ ...yahoo, screen: 'waivers' })
    expect(yahooWaivers).toMatchObject({
      href: 'https://football.fantasysports.yahoo.com/f1/1361311',
      verified: false,
      candidate: 'https://football.fantasysports.yahoo.com/f1/1361311/players',
    })
    const yahooTrade = resolveSourceScreenLink({ ...yahoo, screen: 'trade', partnerTeamId: '449.l.1361311.t.7' })
    expect(yahooTrade?.candidate).toBe('https://football.fantasysports.yahoo.com/f1/1361311/3/proposetrade?tid=7')
  })

  /*
   * Verified 2026-09-05 against Guap's own team pages, pasted from his browser:
   * ESPN league 919055222 team 7 season 2026, Yahoo league 1361311 team 10.
   * The expected hrefs below ARE those pasted URLs.
   */
  it('ESPN and Yahoo lineup are verified and land on the team page', () => {
    const espnLineup = resolveSourceScreenLink({ platform: 'espn', sourceLeagueId: '919055222', season: 2026, teamId: '7', screen: 'lineup' })
    expect(espnLineup).toMatchObject({
      href: 'https://fantasy.espn.com/football/team?leagueId=919055222&teamId=7&seasonId=2026',
      verified: true,
      screen: 'lineup',
      destinationType: 'action',
      candidate: null,
    })
    const yahooLineup = resolveSourceScreenLink({ platform: 'yahoo', sourceLeagueId: 'https://football.fantasysports.yahoo.com/f1/1361311/10', teamId: '10', screen: 'lineup' })
    expect(yahooLineup).toMatchObject({ href: 'https://football.fantasysports.yahoo.com/f1/1361311/10', verified: true, screen: 'lineup' })
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
      sleeper: ['league', 'lineup', 'waivers'],
      // lineup verified 2026-09-05 on league 919055222 / team 7 (ESPN) and 1361311 / team 10 (Yahoo).
      espn: ['league', 'lineup'],
      yahoo: ['league', 'lineup'],
      mfl: [],
      fantrax: [],
      fleaflicker: [],
    })
  })
})
