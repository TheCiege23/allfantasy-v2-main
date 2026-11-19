/**
 * Big-league schedules: several games per team per week, many divisions, up to 250 teams.
 * The shapes are a real commissioner's leagues (36 teams / 6 divisions / 5 games, 34 teams / 8 uneven
 * divisions / 3 games, 160 teams / 16 divisions / 3 games).
 */
import { describe, expect, it } from 'vitest'

import { generateSchedule } from '@/lib/redraft/scheduleEngine'
import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import { buildCanonicalScheduleRuntimeState } from '@/lib/schedule-runtime/canonicalScheduleRuntime'
import { evenDivisionSizes, validateDivisionSetup } from '@/lib/league/divisions/leagueDivisions'
import { inferGamesPerWeek, normalizeGamesPerWeek, readGamesPerWeek } from '@/lib/schedule-runtime/gamesPerWeek'

function league(teamCount: number, divisionCount: number) {
  const rosters = Array.from({ length: teamCount }, (_, i) => ({ id: `r${String(i + 1).padStart(3, '0')}` }))
  const sizes = divisionCount > 0 ? evenDivisionSizes(teamCount, divisionCount) : []
  const divisionByRoster = new Map<string, { key: string; name: string }>()
  let cursor = 0
  sizes.forEach((size, d) => {
    for (let i = 0; i < size; i += 1) divisionByRoster.set(rosters[cursor + i]!.id, { key: `d${d}`, name: `Division ${d + 1}` })
    cursor += size
  })
  return { rosters, divisionByRoster, sizes }
}

function gamesByTeamByWeek(slots: ReturnType<typeof generateSchedule>) {
  const counts = new Map<string, number>()
  for (const slot of slots) {
    if (slot.type !== 'regular' || !slot.away) continue
    for (const id of [slot.home, slot.away]) counts.set(`${slot.week}|${id}`, (counts.get(`${slot.week}|${id}`) ?? 0) + 1)
  }
  return counts
}

describe('games per week', () => {
  it('reads only whole numbers from 1 to 7', () => {
    expect(readGamesPerWeek({ games_per_week: 5 })).toBe(5)
    expect(readGamesPerWeek({ games_per_week: '3' })).toBe(3)
    expect(readGamesPerWeek({})).toBe(1)
    expect(normalizeGamesPerWeek(0)).toBe(1)
    expect(normalizeGamesPerWeek(8)).toBe(1)
    expect(normalizeGamesPerWeek(2.5)).toBe(1)
  })

  it('leaves a one-game schedule exactly as it was', () => {
    const { rosters } = league(12, 0)
    expect(generateSchedule(rosters, 17, 15, 'NFL', { gamesPerWeek: 1 })).toEqual(generateSchedule(rosters, 17, 15, 'NFL'))
  })

  it.each([
    ['NBA: 36 teams, 6 divisions, 5 games', 36, 6, 5, 21],
    ['NFL: 34 teams, 8 uneven divisions, 3 games', 34, 8, 3, 13],
    ['College basketball: 160 teams, 16 divisions, 3 games', 160, 16, 3, 13],
    ['250 teams, 25 divisions, 2 games', 250, 25, 2, 14],
  ])('%s: every team plays exactly that many games every week, and does not meet an opponent twice in a week', (_label, teams, divisions, games, weeks) => {
    const { rosters, divisionByRoster } = league(teams, divisions)
    const slots = generateSchedule(rosters, weeks + 4, weeks + 1, 'NFL', { divisionByRoster, gamesPerWeek: games })
    const regular = slots.filter((slot) => slot.type === 'regular')
    expect(regular.every((slot) => slot.week >= 1 && slot.week <= weeks)).toBe(true)
    expect(regular).toHaveLength((teams / 2) * games * weeks)
    const counts = gamesByTeamByWeek(slots)
    expect(counts.size).toBe(teams * weeks)
    expect([...counts.values()].every((n) => n === games)).toBe(true)
    // No pairing twice in one week, except in a last week that has run out of new rounds.
    const seen = new Set<string>()
    const repeatWeeks = new Set<number>()
    for (const slot of regular) {
      const key = `${slot.week}|${[slot.home, slot.away].sort().join('|')}`
      if (seen.has(key)) repeatWeeks.add(slot.week)
      seen.add(key)
    }
    expect([...repeatWeeks].every((week) => week === weeks)).toBe(true)
    expect(inferGamesPerWeek(regular.map((slot) => ({ week: slot.week, homeRosterId: slot.home, awayRosterId: slot.away })))).toBe(games)
  })

  it('plays division rivals first', () => {
    const { rosters, divisionByRoster } = league(36, 6)
    const slots = generateSchedule(rosters, 22, 22, 'NBA', { divisionByRoster, gamesPerWeek: 5 }).filter((s) => s.type === 'regular')
    const divisionGame = (s: (typeof slots)[number]) => divisionByRoster.get(s.home)!.key === divisionByRoster.get(s.away!)!.key
    // Six teams in a division is five rivals: week one is all of them.
    expect(slots.filter((s) => s.week === 1).every(divisionGame)).toBe(true)
  })

  it('with an odd number of teams, a team sits out at most one game a week and has no bye row', () => {
    const { rosters } = league(35, 0)
    const slots = generateSchedule(rosters, 14, 14, 'NFL', { gamesPerWeek: 3 })
    expect(slots.some((slot) => slot.type === 'regular' && !slot.away)).toBe(false)
    const counts = gamesByTeamByWeek(slots)
    expect(counts.size).toBe(35 * 13)
    expect([...counts.values()].every((n) => n === 3 || n === 2)).toBe(true)
  })

  it('emits one league-median slot per team per week', () => {
    const { rosters } = league(36, 0)
    const median = generateSchedule(rosters, 22, 22, 'NBA', { gamesPerWeek: 5, medianGame: true }).filter((s) => s.type === 'median')
    expect(new Set(median.map((s) => `${s.week}|${s.home}`)).size).toBe(median.length)
  })
})

describe('divisions for big leagues', () => {
  const names = (n: number) => Array.from({ length: n }, (_, i) => `Division ${i + 1}`)
  const setup = (teams: number, count: number, sizes: number[]) => {
    const ids = Array.from({ length: teams }, (_, i) => `t${i}`)
    const teamAssignments: Record<string, number> = {}
    let cursor = 0
    sizes.forEach((size, d) => { for (let i = 0; i < size; i += 1) teamAssignments[ids[cursor + i]!] = d; cursor += size })
    return validateDivisionSetup({ count, names: names(count), teamAssignments } as Parameters<typeof validateDivisionSetup>[0], ids)
  }

  it('accepts 6 divisions of 6, 8 uneven divisions of 4 and 5, and 16 divisions of 10', () => {
    expect(setup(36, 6, [6, 6, 6, 6, 6, 6])).toEqual({ ok: true })
    expect(setup(34, 8, [5, 5, 4, 4, 4, 4, 4, 4])).toEqual({ ok: true })
    expect(setup(160, 16, new Array(16).fill(10))).toEqual({ ok: true })
  })

  it('still refuses more than 32 divisions, a one-team division, and lopsided divisions', () => {
    expect(setup(250, 33, evenDivisionSizes(250, 33))).toMatchObject({ ok: false, code: 'COUNT_NOT_ALLOWED' })
    expect(setup(10, 6, evenDivisionSizes(10, 6))).toMatchObject({ ok: false, code: 'TOO_FEW_TEAMS' })
    expect(setup(34, 8, [7, 5, 4, 4, 4, 4, 3, 3])).toMatchObject({ ok: false, code: 'UNEVEN' })
  })
})

describe('standings over a multi-game season', () => {
  const rules = {
    version: 1, leagueId: 'big', generatedAtIso: new Date(0).toISOString(),
    general: { sport: 'NBA', season: 2026, format: 'dynasty', status: 'active' },
    playoffs: { startWeek: 22, teamCount: 16, standingsTiebreakers: [] },
    schedule: { regularSeasonLength: 21, playoffTransitionPoint: 22 },
  } as unknown as CanonicalLeagueRules

  it('a 36-team, five-games-a-week season gives every team 105 results and a median game each week', () => {
    const { rosters, divisionByRoster } = league(36, 6)
    const strength = new Map(rosters.map((r, i) => [r.id, 100 + i]))
    const persisted = generateSchedule(rosters, 25, 22, 'NBA', { divisionByRoster, gamesPerWeek: 5 })
      .filter((slot) => slot.type === 'regular')
      .map((slot, i) => ({
        id: `m${String(i).padStart(5, '0')}`, week: slot.week, homeRosterId: slot.home, awayRosterId: slot.away,
        homeScore: strength.get(slot.home)!, awayScore: strength.get(slot.away!)!, status: 'final',
      }))
    const teams = rosters.map((r) => ({ rosterId: r.id, divisionId: divisionByRoster.get(r.id)!.key, divisionName: divisionByRoster.get(r.id)!.name }))
    const input = { rules, teams, persistedMatchups: persisted, currentWeek: 22, status: 'active', totalWeeks: 25, playoffStartWeek: 22 }

    // Positive control: read as an ordinary one-game schedule, the same rows are refused.
    const asOneGame = buildCanonicalScheduleRuntimeState({ ...input })
    expect(asOneGame.validationIssues.some((issue) => issue.code === 'WEEK_TEAM_DUPLICATE')).toBe(true)

    const state = buildCanonicalScheduleRuntimeState({ ...input, gamesPerWeek: 5 })
    expect(state.validationIssues.filter((issue) => issue.severity === 'blocking')).toEqual([])
    expect(state.standings).toHaveLength(36)
    expect(state.standings.every((row) => row.wins + row.losses + row.ties === 105)).toBe(true)
    // The strongest team wins every game.
    expect(state.standings[0]).toMatchObject({ rosterId: 'r036', wins: 105, losses: 0 })
    // Points For is the team's weekly score once a week (135 x 21 weeks), not once per game: counted
    // per game it read five times the real total. Points Against still adds all 105 opponents' scores.
    expect(state.standings[0]!.pointsFor).toBe(135 * 21)
    expect(state.standings.every((row) => row.pointsFor === strength.get(row.rosterId)! * 21)).toBe(true)
    expect(state.standings[0]!.pointsAgainst).toBeGreaterThan(100 * 105 - 1)

    const withMedian = buildCanonicalScheduleRuntimeState({ ...input, gamesPerWeek: 5, medianGame: true })
    // One extra result per week, not one per game: 105 + 21.
    expect(withMedian.standings.every((row) => row.wins + row.losses + row.ties === 126)).toBe(true)
  })
})
