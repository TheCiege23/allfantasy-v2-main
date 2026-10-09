import { describe, expect, it } from 'vitest'

import { GAME_DAY_HOURS, allSportsInjuryAlertsEnabled, isCurrentSeasonLeague, onGameDay } from '@/lib/chimmy-alerts/gameDayScope'
import { DIGEST_BODY_MAX, digestCopy, type FanOutAlert } from '@/lib/chimmy-alerts/injuryFanOutCopy'
import { easternDay, injuredStarterDedupeKey } from '@/lib/chimmy-alerts/sweepAudience'

/*
 * The game-day injury alert across every sport (Guap, 2026-10-08): who may be spoken about, in
 * which leagues, and the one-notification digest that names them all.
 */

const NOW = new Date('2026-10-08T15:00:00.000Z') // Thursday 11am ET
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()

describe('onGameDay', () => {
  it('the NFL is unchanged — a Wednesday Out for Sunday, or no game on file, still speaks', () => {
    expect(onGameDay({ sport: 'NFL', lockAt: inHours(96) }, NOW)).toBe(true)
    expect(onGameDay({ sport: 'NFL', lockAt: null }, NOW)).toBe(true)
    expect(onGameDay({ lockAt: null }, NOW)).toBe(true)
  })

  it(`a daily sport speaks only when his game starts within ${GAME_DAY_HOURS} hours`, () => {
    expect(onGameDay({ sport: 'NBA', lockAt: inHours(8) }, NOW)).toBe(true)
    expect(onGameDay({ sport: 'NHL', lockAt: inHours(GAME_DAY_HOURS + 1) }, NOW)).toBe(false)
    expect(onGameDay({ sport: 'MLB', lockAt: inHours(-1) }, NOW)).toBe(false)
  })

  it('🛑 a daily sport with no game on file says nothing — that is the off-season, not "soon"', () => {
    expect(onGameDay({ sport: 'NBA', lockAt: null }, NOW)).toBe(false)
    expect(onGameDay({ sport: 'NCAAB', lockAt: 'not a date' }, NOW)).toBe(false)
  })

  it('NCAAF is weekly: a Saturday game is in reach on Thursday', () => {
    expect(onGameDay({ sport: 'NCAAF', lockAt: inHours(52) }, NOW)).toBe(true)
    expect(onGameDay({ sport: 'NCAAF', lockAt: null }, NOW)).toBe(false)
  })
})

describe('isCurrentSeasonLeague', () => {
  it('🛑 a 2025-26 NBA league is not played in October 2026; 2026-27 is, under either platform year', () => {
    expect(isCurrentSeasonLeague('NBA', 2025, NOW)).toBe(false)
    expect(isCurrentSeasonLeague('NBA', 2026, NOW)).toBe(true) // Sleeper: start year
    expect(isCurrentSeasonLeague('NBA', 2027, NOW)).toBe(true) // ESPN: end year
  })

  it('in March the split season is still the one that opened last autumn', () => {
    const march = new Date('2027-03-01T12:00:00.000Z')
    expect(isCurrentSeasonLeague('NHL', 2026, march)).toBe(true)
    expect(isCurrentSeasonLeague('NHL', 2027, march)).toBe(true)
    expect(isCurrentSeasonLeague('NHL', 2025, march)).toBe(false)
  })

  it('NFL bowls and playoffs in January belong to last year’s season; MLB is the calendar year', () => {
    const jan = new Date('2027-01-10T12:00:00.000Z')
    expect(isCurrentSeasonLeague('NFL', 2026, jan)).toBe(true)
    expect(isCurrentSeasonLeague('NCAAF', 2027, jan)).toBe(false)
    expect(isCurrentSeasonLeague('MLB', 2026, NOW)).toBe(true)
    expect(isCurrentSeasonLeague('MLB', 2025, NOW)).toBe(false)
    expect(isCurrentSeasonLeague('MLB', null, NOW)).toBe(false)
  })
})

describe('allSportsInjuryAlertsEnabled', () => {
  it('is on unless INJURY_ALERTS_NFL_ONLY=1', () => {
    expect(allSportsInjuryAlertsEnabled({})).toBe(true)
    expect(allSportsInjuryAlertsEnabled({ INJURY_ALERTS_NFL_ONLY: '0' })).toBe(true)
    expect(allSportsInjuryAlertsEnabled({ INJURY_ALERTS_NFL_ONLY: '1' })).toBe(false)
  })
})

describe('the dedupe key is an Eastern day', () => {
  const TOP = { title: 'Jalen Brunson is Out and still starting', metadata: { playerName: 'Jalen Brunson', designation: 'Out' } }

  it('🛑 a 7:30pm ET tip told at 6pm is not told again when UTC rolls past midnight at 8pm', () => {
    const sixPm = new Date('2026-10-27T22:00:00.000Z')
    const ninePm = new Date('2026-10-28T01:00:00.000Z')
    expect(injuredStarterDedupeKey(TOP, ninePm)).toBe(injuredStarterDedupeKey(TOP, sixPm))
    expect(easternDay(ninePm)).toBe('2026-10-27')
  })

  it('the next Eastern day is a new key', () => {
    expect(injuredStarterDedupeKey(TOP, new Date('2026-10-28T16:00:00.000Z'))).toBe('injured-starter:jalen-brunson:out:2026-10-28')
  })
})

const alert = (leagueId: string, leagueName: string, player: string, extra: Record<string, unknown> = {}): FanOutAlert => ({
  title: `${player} is Out and still starting`,
  message: `${player} starts for you in ${leagueName}.`,
  leagueId,
  urgencySignal: 90,
  metadata: { playerName: player, designation: 'Out', leagueName, ...extra },
})

describe('digestCopy', () => {
  it('names each player once with the leagues to fix, and counts the lineups', () => {
    const copy = digestCopy([
      [alert('L1', 'KBFL', 'Josh Allen', { inactive: true }), alert('L2', 'Maye 26', 'Josh Allen', { inactive: true })],
      [alert('L3', 'Dynasty', 'Travis Kelce')],
    ])
    expect(copy.title).toBe('2 of your starters are out — fix 3 lineups')
    expect(copy.body).toBe('Josh Allen (inactive): KBFL, Maye 26. Travis Kelce (Out): Dynasty.')
  })

  it('says "flagged" rather than "out" when one of them is only Doubtful — the designation is never upgraded', () => {
    const copy = digestCopy([[alert('L1', 'KBFL', 'A')], [alert('L2', 'Home', 'B', { designation: 'Doubtful' })]])
    expect(copy.title).toBe('2 of your starters are flagged — fix 2 lineups')
    expect(copy.body).toContain('B (Doubtful): Home.')
  })

  it('shows three leagues and "+N more" past that', () => {
    const many = ['A', 'B', 'C', 'D', 'E'].map((n, i) => alert(`L${i}`, `League ${n}`, 'Josh Allen'))
    expect(digestCopy([many, [alert('X', 'X', 'Other')]]).body).toContain('Josh Allen (Out): League A, League B, League C +2 more.')
  })

  it(`stops at ${DIGEST_BODY_MAX} characters on a whole player, and never sends only "…"`, () => {
    const groups = Array.from({ length: 12 }, (_, i) => [alert(`L${i}`, `A Very Long League Name ${i}`, `Player Number ${i}`)])
    const body = digestCopy(groups).body
    expect(body.length).toBeLessThanOrEqual(DIGEST_BODY_MAX + 2)
    expect(body.endsWith(' …')).toBe(true)
    const huge = digestCopy([[alert('L', 'x'.repeat(400), 'P')], [alert('M', 'y', 'Q')]]).body
    expect(huge.length).toBe(DIGEST_BODY_MAX)
    expect(huge.startsWith('P (Out): xxx')).toBe(true)
  })
})
