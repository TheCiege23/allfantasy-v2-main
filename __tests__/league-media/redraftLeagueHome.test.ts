import { describe, expect, it } from 'vitest'
import {
  buildDraftGrades,
  buildLastWeekRecap,
  buildPlayoffRace,
  buildScoreBug,
  draftCountdown,
  isDailyRedraftSport,
  type WeekResultRow,
} from '@/lib/league-media/redraftLeagueHome'
import type { MatchupCenterPayload, MatchupPlayerSlot, MatchupSidePayload } from '@/lib/matchup-center/types'

function slot(name: string, currentPoints: number): MatchupPlayerSlot {
  return { playerId: name, name, position: 'RB', team: null, opponent: null, headshotUrl: null, currentPoints, projectedPoints: 10, hasRealProjection: true, injuryStatus: null, newsBlurb: null, weatherSummary: null, gameStatus: 'final', gameLabel: '', aiInsight: null }
}

function sideOf(teamName: string, totalPoints: number, projectedTotal: number, extra: Partial<MatchupSidePayload> = {}): MatchupSidePayload {
  return { projectedTotalIncludesFallback: false, rosterId: teamName, teamName, avatarUrl: null, record: { wins: 6, losses: 2, ties: 0 }, winPct: 0.75, totalPoints, projectedTotal, starters: [], remainingStarters: 2, ...extra }
}

function payload(extra: Partial<MatchupCenterPayload> = {}): MatchupCenterPayload {
  return {
    leagueId: 'L', season: 2026, week: 9, sport: 'NFL', matchupStatus: 'live', conceptOverlay: null,
    left: sideOf('Fourth & Long', 98.6, 121.4, { starters: [slot('B. Robinson', 31.2), slot('J. Chase', 24.8), slot('Bench Guy', 0)] }),
    right: sideOf('Gridiron Ghosts', 87.2, 109.5, { record: { wins: 5, losses: 3, ties: 0 }, remainingStarters: 1 }),
    winProbabilityLeft: 0.64,
    insights: { matchupEdge: '', startSit: '', weather: '', injuryNews: '', swingPlayers: [], riskLevel: 'low', floorVsCeiling: '' },
    partialData: false, refreshIntervalMs: 60_000, ...extra,
  }
}

describe('score bug', () => {
  it('live: both scores, records, win chance as an integer percent, the top scorer and the margin', () => {
    const bug = buildScoreBug(payload())!
    expect(bug.you).toMatchObject({ name: 'Fourth & Long', record: '6–2', points: 98.6, projected: 121.4, yetToPlay: 2 })
    expect(bug.them).toMatchObject({ name: 'Gridiron Ghosts', record: '5–3', points: 87.2, yetToPlay: 1 })
    expect(bug.winChance).toBe(64)
    expect(bug.topScorer).toEqual({ name: 'B. Robinson', points: 31.2 })
    expect(bug.headline).toBe('Winning by 11.4')
  })

  it('no head-to-head opponent (a bye, guillotine, survivor) is no score bug at all', () => {
    expect(buildScoreBug(payload({ right: sideOf('No opponent', 0, 0) }))).toBeNull()
    expect(buildScoreBug(null)).toBeNull()
  })

  it('a win chance the server withheld stays withheld, and a final never shows one or a projection', () => {
    expect(buildScoreBug(payload({ winProbabilityLeft: null }))!.winChance).toBeNull()
    const final = buildScoreBug(payload({ matchupStatus: 'final' }))!
    expect(final.winChance).toBeNull()
    expect(final.you.projected).toBeNull()
    expect(final.headline).toBe('Won by 11.4')
  })

  it('a projection built on the flat per-position fallback is not quoted', () => {
    const bug = buildScoreBug(payload({ matchupStatus: 'upcoming', left: sideOf('A', 0, 120, { projectedTotalIncludesFallback: true }) }))!
    expect(bug.you.projected).toBeNull()
    expect(bug.headline).toBe('Not started yet')
  })

  it('before kickoff the headline is the projection; nobody has scored, so no top scorer', () => {
    const bug = buildScoreBug(payload({ matchupStatus: 'upcoming', left: sideOf('A', 0, 120), right: sideOf('B', 0, 110) }))!
    expect(bug.headline).toBe('Projected 120.0 – 110.0')
    expect(bug.topScorer).toBeNull()
  })

  it('an empty record (0–0) is dropped rather than printed', () => {
    expect(buildScoreBug(payload({ left: sideOf('A', 1, 2, { record: { wins: 0, losses: 0, ties: 0 } }) }))!.you.record).toBeNull()
  })
})

const ordered = Array.from({ length: 10 }, (_, i) => ({ id: `t${i + 1}`, teamName: `Team ${i + 1}`, wins: 9 - i, losses: i, ties: 0 }))

describe('playoff race', () => {
  it('draws the line where the league’s own settings put it', () => {
    const race = buildPlayoffRace(ordered, { playoff_structure: { playoff_team_count: 6 } }, 't1')!
    expect(race.field).toBe(6)
    expect(race.lineAfter).toBe(6)
    expect(race.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(race.rows.filter((r) => r.inField)).toHaveLength(6)
    expect(race.rows[0]).toMatchObject({ isYou: true, record: '9–0' })
  })

  it('no playoff field in the settings means no line — never the sport default', () => {
    expect(buildPlayoffRace(ordered, {}, 't1')).toBeNull()
    expect(buildPlayoffRace(ordered, null, 't1')).toBeNull()
  })

  it('a field as large as the league is not a race', () => {
    expect(buildPlayoffRace(ordered, { playoff_team_count: 10 }, 't1')).toBeNull()
  })

  it('your team stays on the board when it is below the rows shown', () => {
    const race = buildPlayoffRace(ordered, { playoff_team_count: 4 }, 't10', { maxRows: 6 })!
    expect(race.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 10])
    expect(race.rows.at(-1)).toMatchObject({ isYou: true, inField: false })
  })
})

function row(rosterId: string, totalPoints: number, opponentRosterId: string | null, status = 'final'): WeekResultRow {
  return { rosterId, teamName: rosterId.toUpperCase(), totalPoints, opponentRosterId, opponentName: null, winLoss: null, status }
}

describe('last week recap', () => {
  const rows = [row('a', 154.8, 'b'), row('b', 101.2, 'a'), row('c', 133.0, 'd'), row('d', 132.6, 'c')]

  it('top score, the closest finish and the biggest win from the head-to-head pairs', () => {
    const recap = buildLastWeekRecap(8, rows)!
    expect(recap.topScore).toEqual({ team: 'A', points: 154.8 })
    expect(recap.closest).toEqual({ winner: 'C', loser: 'D', margin: 0.4 })
    expect(recap.biggest).toEqual({ winner: 'A', loser: 'B', margin: 53.6 })
  })

  it('a week with any row not final is not recapped', () => {
    expect(buildLastWeekRecap(8, [...rows.slice(0, 3), row('d', 132.6, 'c', 'provisional')])).toBeNull()
  })

  it('no head-to-head pairs, or nothing loaded, is no recap', () => {
    expect(buildLastWeekRecap(8, [row('a', 10, null), row('b', 12, null)])).toBeNull()
    expect(buildLastWeekRecap(8, [])).toBeNull()
    expect(buildLastWeekRecap(0, rows)).toBeNull()
  })

  it('one pair has no separate "biggest win" — the same game is not named twice', () => {
    expect(buildLastWeekRecap(3, rows.slice(0, 2))!.biggest).toBeNull()
  })
})

describe('draft countdown', () => {
  const now = Date.parse('2026-10-31T12:00:00Z')
  it('days and hours far out, hours and minutes on the day', () => {
    expect(draftCountdown('2026-11-02T16:12:00Z', now)!.label).toBe('2d 04h')
    expect(draftCountdown('2026-10-31T17:05:00Z', now)!.label).toBe('5h 05m')
  })
  it('no time, a bad time, or a time already past is no countdown', () => {
    expect(draftCountdown(null, now)).toBeNull()
    expect(draftCountdown('not a date', now)).toBeNull()
    expect(draftCountdown('2026-10-30T12:00:00Z', now)).toBeNull()
  })
})

describe('draft grades', () => {
  const teams = [{ id: 'team-1', externalId: 'roster-1', teamName: 'Mine' }, { id: 'team-2', externalId: 'roster-2', teamName: 'Theirs' }]
  it('names each row by this league’s team and sorts by score', () => {
    const lines = buildDraftGrades([{ rosterId: 'roster-2', grade: 'b+', score: 81 }, { rosterId: 'roster-1', grade: 'A', score: 92 }], teams, 'team-1')!
    expect(lines.map((l) => [l.teamName, l.grade, l.isYou])).toEqual([['Mine', 'A', true], ['Theirs', 'B+', false]])
  })
  it('a row that matches no team, or carries no letter grade, is dropped; nothing left is null', () => {
    expect(buildDraftGrades([{ rosterId: 'stranger', grade: 'A', score: 90 }, { rosterId: 'roster-1', grade: '??', score: 50 }], teams, null)).toBeNull()
    expect(buildDraftGrades([], teams, null)).toBeNull()
  })
})

describe('daily sports', () => {
  it('NBA, NHL, MLB and NCAAB set lineups by the day; football and soccer by the week', () => {
    expect(['NBA', 'NHL', 'MLB', 'NCAAB', 'nba'].map(isDailyRedraftSport)).toEqual([true, true, true, true, true])
    expect(['NFL', 'NCAAF', 'SOCCER', null].map(isDailyRedraftSport)).toEqual([false, false, false, false])
  })
})
