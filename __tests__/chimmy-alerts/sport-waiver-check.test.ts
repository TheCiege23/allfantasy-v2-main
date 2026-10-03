import { describe, expect, it } from 'vitest'

import type { WaiverBoardRow, WaiverPlayer, WaiverSportSection } from '@/lib/core-app/waiversBoard'
import {
  combineSportPicks,
  dayBefore,
  easternClock,
  recentSportWaiverClaimKeys,
  renderSportWaiverCheck,
  selectSportWaiverPicks,
  sportAlertSeason,
  sportPickSignature,
  sportWaiverCheckDedupeKey,
  sportWaiverWindow,
  type SportWaiverPick,
} from '@/lib/chimmy-alerts/sportWaiverCheck'
import {
  SPORT_WAIVER_ALERT_MAX_PICKS,
  SPORT_WAIVER_ALERT_RULES,
  sportWaiverAlertRule,
  type SportWaiverAlertRule,
} from '@/lib/chimmy-alerts/waiverAlertRules'
import { waiverSportPlan } from '@/lib/waivers/waiverSportBasis'

/**
 * Chimmy's waiver check for every sport but the NFL — the rules, the clock, the picks and the copy.
 * Every figure is PER GAME, so no message may name a week.
 */

const rule = (sport: string): SportWaiverAlertRule => {
  const r = sportWaiverAlertRule(sport)
  if (!r) throw new Error(`no rule for ${sport}`)
  return r
}

const player = (id: string, name: string, projected: number, position = 'C', team = 'BOS'): WaiverPlayer => ({
  playerId: id,
  name,
  position,
  team,
  imageUrl: null,
  projected,
  ownPct: null,
  startPct: null,
})

const row = (leagueId: string, netGain: number, over: Partial<WaiverBoardRow> = {}): WaiverBoardRow => ({
  leagueId,
  leagueName: `League ${leagueId}`,
  platform: 'sleeper',
  platformLeagueId: `s-${leagueId}`,
  logoUrl: null,
  format: null,
  netGain,
  add: player(`a-${leagueId}`, 'Nick Richards', 18 + netGain),
  drop: player(`d-${leagueId}`, 'Kris Dunn', 18, 'PG', 'LAC'),
  faabRemaining: null,
  runsAt: null,
  href: '',
  reasoning: '',
  sport: 'NBA',
  ...over,
})

const section = (sport: string, rows: WaiverBoardRow[], over: Partial<WaiverSportSection> = {}): WaiverSportSection => ({
  sport,
  state: 'ok',
  reason: null,
  basis: sport === 'NCAAF' ? 'season_per_game_league' : 'season_per_game_af_default',
  basisLabel: null,
  season: 2026,
  rows,
  considered: rows.length,
  withheld: { noRoster: 0, idSpace: 0, noScoring: 0, noCandidate: 0, noUpgrade: 0 },
  ...over,
})

const pick = (sport: string, leagueId: string, netGain: number): SportWaiverPick => ({
  sport,
  basis: sport === 'NCAAF' ? 'season_per_game_league' : 'season_per_game_af_default',
  leagueId,
  leagueName: `League ${leagueId}`,
  add: player(`a-${leagueId}`, `Add ${leagueId}`, 20 + netGain),
  drop: player(`d-${leagueId}`, `Drop ${leagueId}`, 20),
  netGain,
  faabRemaining: null,
})

const all = (ids: string[]) => new Set(ids)
const game = (iso: string) => ({ startTime: new Date(iso) })

describe('the rules', () => {
  it('🛑 every sport with a rule has a per-game producer; soccer and the NFL have none', () => {
    for (const r of SPORT_WAIVER_ALERT_RULES) expect(waiverSportPlan(r.sport).kind).toBe('per_game')
    expect(sportWaiverAlertRule('SOCCER')).toBeNull()
    expect(sportWaiverAlertRule('soccer')).toBeNull()
    // The NFL keeps its own rule in waiverCheck.ts, untouched.
    expect(sportWaiverAlertRule('NFL')).toBeNull()
  })

  it('every rule is a sane, positive per-game bar inside a real window', () => {
    for (const r of SPORT_WAIVER_ALERT_RULES) {
      expect(r.minGainPerGame).toBeGreaterThan(0)
      expect(r.opensAtHourEt).toBeGreaterThanOrEqual(0)
      expect(r.closesAtHourEt).toBeGreaterThan(r.opensAtHourEt)
      expect(r.closesAtHourEt).toBeLessThanOrEqual(24)
    }
    // One message per day works only because every window opens together — see waiverAlertRules.ts.
    expect(new Set(SPORT_WAIVER_ALERT_RULES.map((r) => r.opensAtHourEt)).size).toBe(1)
  })

  it('states the chosen defaults', () => {
    expect(Object.fromEntries(SPORT_WAIVER_ALERT_RULES.map((r) => [r.sport, r.minGainPerGame]))).toEqual({
      NCAAF: 3,
      NBA: 4,
      NCAAB: 5,
      NHL: 2,
      MLB: 2,
    })
    expect(rule('NCAAF').cadence).toEqual({ kind: 'weekly', weekdayEt: 2 })
    for (const s of ['NBA', 'NCAAB', 'NHL', 'MLB']) expect(rule(s).cadence).toEqual({ kind: 'daily' })
  })
})

describe('the US Eastern clock', () => {
  it('is DST-correct and keeps a late game on its Eastern day', () => {
    expect(easternClock(new Date('2026-09-29T14:30:00Z'))).toEqual({ day: '2026-09-29', year: 2026, hour: 10, weekday: 2 })
    expect(easternClock(new Date('2026-11-10T16:00:00Z'))).toEqual({ day: '2026-11-10', year: 2026, hour: 11, weekday: 2 })
    // 10pm Eastern is already the next day in UTC.
    expect(easternClock(new Date('2026-11-11T03:00:00Z'))).toMatchObject({ day: '2026-11-10', hour: 22 })
    expect(easternClock(new Date('2027-01-01T04:59:00Z'))).toMatchObject({ day: '2026-12-31', year: 2026, hour: 23 })
  })

  it('steps back across months and years', () => {
    expect(dayBefore('2026-11-01', 1)).toBe('2026-10-31')
    expect(dayBefore('2027-01-02', 3)).toBe('2026-12-30')
  })
})

describe('in season', () => {
  it('🛑 NBA: not in preseason, from the recorded opener, and not past the regular season', () => {
    expect(sportAlertSeason(rule('NBA'), new Date('2026-10-19T16:00:00Z'))).toBeNull()
    expect(sportAlertSeason(rule('NBA'), new Date('2026-10-20T16:00:00Z'))).toBe(2026)
    expect(sportAlertSeason(rule('NBA'), new Date('2027-03-01T16:00:00Z'))).toBe(2026)
    expect(sportAlertSeason(rule('NBA'), new Date('2027-05-01T16:00:00Z'))).toBeNull()
  })

  it('MLB activates from its recorded opener; NCAAF is the Eastern year', () => {
    expect(sportAlertSeason(rule('MLB'), new Date('2027-03-23T16:00:00Z'))).toBeNull()
    expect(sportAlertSeason(rule('MLB'), new Date('2027-05-01T16:00:00Z'))).toBe(2027)
    expect(sportAlertSeason(rule('NCAAF'), new Date('2026-09-29T16:00:00Z'))).toBe(2026)
  })
})

describe('the window', () => {
  const NBA = rule('NBA')
  const nightGame = [game('2026-11-11T00:30:00Z')] // 7:30pm Eastern, 10 Nov

  it('daily: open mid-morning on a game day, counting a game by its EASTERN day', () => {
    expect(sportWaiverWindow(NBA, { now: new Date('2026-11-10T16:00:00Z'), games: nightGame })).toBe('open')
  })

  it('daily: no game that Eastern day is no message', () => {
    expect(sportWaiverWindow(NBA, { now: new Date('2026-11-10T16:00:00Z'), games: [] })).toBe('no_games')
    // Tomorrow night's game is not today's.
    expect(sportWaiverWindow(NBA, { now: new Date('2026-11-10T16:00:00Z'), games: [game('2026-11-12T00:30:00Z')] })).toBe('no_games')
  })

  it('daily: not before 10:00 Eastern, not from 13:00, and never inside an hour of the first game', () => {
    expect(sportWaiverWindow(NBA, { now: new Date('2026-11-10T14:59:00Z'), games: nightGame })).toBe('early')
    expect(sportWaiverWindow(NBA, { now: new Date('2026-11-10T15:00:00Z'), games: nightGame })).toBe('open')
    expect(sportWaiverWindow(NBA, { now: new Date('2026-11-10T17:59:00Z'), games: nightGame })).toBe('open')
    expect(sportWaiverWindow(NBA, { now: new Date('2026-11-10T18:00:00Z'), games: nightGame })).toBe('closed')
    const noon = [game('2026-11-10T17:05:00Z'), ...nightGame] // a 12:05 Eastern game that day
    expect(sportWaiverWindow(NBA, { now: new Date('2026-11-10T15:30:00Z'), games: noon })).toBe('open')
    expect(sportWaiverWindow(NBA, { now: new Date('2026-11-10T16:30:00Z'), games: noon })).toBe('closed')
  })

  it('weekly (NCAAF): Tuesday only, and only with a game in the week ahead', () => {
    const NCAAF = rule('NCAAF')
    const saturday = [game('2026-10-03T16:00:00Z')]
    expect(sportWaiverWindow(NCAAF, { now: new Date('2026-09-29T15:00:00Z'), games: saturday })).toBe('open')
    expect(sportWaiverWindow(NCAAF, { now: new Date('2026-09-28T15:00:00Z'), games: saturday })).toBe('not_today')
    expect(sportWaiverWindow(NCAAF, { now: new Date('2026-09-29T15:00:00Z'), games: [] })).toBe('no_games')
    expect(sportWaiverWindow(NCAAF, { now: new Date('2026-09-29T15:00:00Z'), games: [game('2026-10-10T16:00:00Z')] })).toBe(
      'no_games',
    )
  })
})

describe('the picks', () => {
  const NBA = rule('NBA')

  it('a priced swap at or over the per-game bar, in an allowed league, best first', () => {
    const s = section('NBA', [row('A', 3.99), row('B', 4), row('C', 9), row('D', 12, { drop: null }), row('E', 20)])
    expect(selectSportWaiverPicks(s, NBA, all(['A', 'B', 'C', 'D'])).map((p) => [p.leagueId, p.netGain])).toEqual([
      ['C', 9],
      ['B', 4],
    ])
  })

  it('🛑 never from a section that is not ok, not per game, of another sport, or with no producer', () => {
    const rows = [row('A', 9)]
    expect(selectSportWaiverPicks(section('NBA', rows, { state: 'no_projections' }), NBA, all(['A']))).toEqual([])
    expect(selectSportWaiverPicks(section('NBA', rows, { state: 'no_producer' }), NBA, all(['A']))).toEqual([])
    expect(selectSportWaiverPicks(section('NBA', rows, { basis: 'weekly_projection' }), NBA, all(['A']))).toEqual([])
    expect(selectSportWaiverPicks(section('NBA', rows, { basis: null }), NBA, all(['A']))).toEqual([])
    expect(selectSportWaiverPicks(section('NHL', rows), NBA, all(['A']))).toEqual([])
    // A soccer rule someone adds by mistake still sends nothing: soccer has no producer.
    const soccerRule = { ...NBA, sport: 'SOCCER' } as unknown as SportWaiverAlertRule
    expect(selectSportWaiverPicks(section('SOCCER', rows), soccerRule, all(['A']))).toEqual([])
    expect(selectSportWaiverPicks(section('NBA', rows), NBA, all(['A']))).toHaveLength(1)
  })

  it('round-robin across sports, capped, repeats dropped', () => {
    const nba = [pick('NBA', 'N1', 9), pick('NBA', 'N2', 8), pick('NBA', 'N3', 7), pick('NBA', 'N4', 6)]
    const nhl = [pick('NHL', 'H1', 3), pick('NHL', 'H2', 2.5)]
    expect(combineSportPicks([nba, nhl]).map((p) => p.leagueId)).toEqual(['N1', 'H1', 'N2', 'H2', 'N3'])
    expect(combineSportPicks([nba, nhl])).toHaveLength(SPORT_WAIVER_ALERT_MAX_PICKS)
    const seen = new Set([sportPickSignature(nba[0]!), sportPickSignature(nhl[0]!)])
    expect(combineSportPicks([nba, nhl], seen).map((p) => p.leagueId)).toEqual(['N2', 'H2', 'N3', 'N4'])
    expect(combineSportPicks([[nba[0]!]], new Set([sportPickSignature(nba[0]!)]))).toEqual([])
  })

  it('a different drop for the same add is a different pick', () => {
    const a = pick('NBA', 'N1', 9)
    const b = { ...a, drop: player('other', 'Other', 10) }
    expect(sportPickSignature(a)).not.toBe(sportPickSignature(b))
  })
})

describe('where it lands', () => {
  it('one key per Eastern day, never the NFL’s', () => {
    expect(sportWaiverCheckDedupeKey('2026-11-10')).toBe('chimmy-waiver-check:sports:2026-11-10')
    expect(recentSportWaiverClaimKeys('2026-11-01', 'u1')).toEqual([
      'chimmy-waiver-check:sports:2026-10-31:u1',
      'chimmy-waiver-check:sports:2026-10-30:u1',
      'chimmy-waiver-check:sports:2026-10-29:u1',
    ])
  })
})

describe('what it says', () => {
  it('one pick: the sport, the league, the add, per game', () => {
    const m = renderSportWaiverCheck([{ ...pick('NBA', 'N1', 4.25), faabRemaining: 57 }], { baseUrl: 'https://allfantasy.ai' })!
    expect(m.title).toBe("Chimmy's NBA waiver pick for League N1: Add N1 (+4.3 pts/game)")
    expect(m.body).toBe('League N1 (NBA): add Add N1 (C, BOS), drop Drop N1 — +4.3 pts per game · $57 FAAB left.')
    expect(m.email.subject).toBe(m.title)
    expect(m.email.html).toContain('on AllFantasy&#39;s default NBA scoring')
    expect(m.email.html).toContain('pts/game')
    const href = new URL(m.actionHref, 'https://x.test')
    expect(href.pathname).toBe('/chimmy/chat')
    expect(href.searchParams.get('from')).toBe('waiver_check')
    expect(href.searchParams.get('leagueId')).toBe('N1')
    expect(href.searchParams.get('prompt')).toBe('Should I pick up Add N1 and drop Drop N1?')
  })

  it('🛑 opens Chimmy in the PICK’S sport — not the NFL the weekly links default to', () => {
    const m = renderSportWaiverCheck([pick('NHL', 'H1', 3)])!
    expect(new URL(m.actionHref, 'https://x.test').searchParams.get('sport')).toBe('NHL')
    expect(m.email.html).toContain('sport=NHL&amp;from=waiver_check_email')
    expect(m.email.html).not.toContain('sport=NFL')
  })

  it('several sports: one message naming them all, college sports in sentence case', () => {
    const m = renderSportWaiverCheck([pick('NBA', 'N1', 5), pick('NCAAB', 'C1', 6), pick('NCAAF', 'F1', 3.5)])!
    expect(m.title).toBe("Chimmy's waiver picks: 3 upgrades across your NBA, college basketball and college football leagues")
    expect(m.body.split('\n')).toEqual([
      'League N1 (NBA): add Add N1 (C, BOS), drop Drop N1 — +5.0 pts per game.',
      'League C1 (College basketball): add Add C1 (C, BOS), drop Drop C1 — +6.0 pts per game.',
      'League F1 (College football): add Add F1 (C, BOS), drop Drop F1 — +3.5 pts per game.',
    ])
    // NCAAF is priced under the league's own scoring, and says so.
    expect(m.email.html).toContain('under this league&#39;s scoring')
  })

  it('🛑 never says "week", never says "projected pts" — a season per-game rate is neither', () => {
    const m = renderSportWaiverCheck([pick('NBA', 'N1', 5), pick('NHL', 'H1', 2.2), pick('NCAAF', 'F1', 3)])!
    for (const text of [m.title, m.body, m.email.subject, m.email.html]) {
      expect(text).not.toMatch(/\bweek\b/i)
      expect(text).not.toContain('projected pts')
      expect(text).not.toMatch(/\bAI\b/)
    }
  })

  it('nothing to say is no message; a long body is capped', () => {
    expect(renderSportWaiverCheck([])).toBeNull()
    const many = Array.from({ length: 5 }, (_, i) => ({ ...pick('NBA', `N${i}`, 9), leagueName: `A very long league name number ${i}` }))
    expect(renderSportWaiverCheck(many)!.body.length).toBeLessThanOrEqual(300)
  })
})
