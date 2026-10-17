import { describe, expect, it } from 'vitest'

import { buildWeekKickoffMap, hydrateRedraftLineupLocks, lockTeamLookupKeys } from '@/lib/redraft/lineupLock'
import { cfbdScheduleTeamKeys } from '@/lib/sports-data/collegeTeamNames'

/**
 * 🛑 NCAAF PLAYERS NEVER LOCKED. A college lineup stayed editable all week — a manager could start
 * a player after his game was played. The lock reads each player's kickoff off CFBD's schedule rows.
 *
 * The hard part is names: the roster carries Rolling Insights' formal school name ("University of
 * Mississippi"), CFBD's schedule the short one ("Ole Miss"). The team strings below are real values
 * from both tables (test DB, 2026).
 */

type Game = { homeTeam: string; awayTeam: string; startTime: Date }

/** Answers the two reads the NCAAF branch makes: this week's games, and the season's schools. */
function schedule(week: Game[], seasonOnly: Array<[string, string]> = []) {
  const calls: Array<Record<string, unknown>> = []
  return {
    calls,
    db: {
      sportsGame: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          calls.push(args.where)
          if ('week' in args.where) return week
          return [...week.map((g) => ({ homeTeam: g.homeTeam, awayTeam: g.awayTeam })), ...seasonOnly.map(([homeTeam, awayTeam]) => ({ homeTeam, awayTeam }))]
        },
      },
    } as never,
  }
}

const SAT_NOON = new Date('2026-09-26T16:00:00.000Z')
const SAT_EVENING = new Date('2026-09-26T23:30:00.000Z')
const THU_NIGHT = new Date('2026-09-24T23:30:00.000Z')

const WEEK4: Game[] = [
  { homeTeam: 'Ole Miss', awayTeam: 'Vanderbilt', startTime: SAT_NOON },
  { homeTeam: 'Miami', awayTeam: 'NC State', startTime: SAT_EVENING },
  { homeTeam: 'Miami (OH)', awayTeam: 'Ohio', startTime: THU_NIGHT },
  { homeTeam: 'San José State', awayTeam: 'SMU', startTime: SAT_EVENING },
  { homeTeam: 'Illinois', awayTeam: 'Purdue', startTime: SAT_EVENING },
  // D-III, and earlier: must never lock an Illinois player.
  { homeTeam: 'Illinois College', awayTeam: 'Monmouth', startTime: SAT_NOON },
]

const ROSTER = [
  { playerId: 'qb-olemiss', team: 'University of Mississippi' },
  { playerId: 'wr-vandy', team: 'Vanderbilt University' },
  { playerId: 'rb-miami', team: 'University of Miami' },
  { playerId: 'rb-miamioh', team: 'Miami University' },
  { playerId: 'wr-sjsu', team: 'San Jose State University' },
  { playerId: 'te-smu', team: 'Southern Methodist University' },
  { playerId: 'qb-illinois', team: 'University of Illinois' },
  { playerId: 'k-nofootball', team: 'Jacksonville University' },
]

async function locksAt(now: Date, sport = 'NCAAFB', games = WEEK4, seasonOnly: Array<[string, string]> = []) {
  const s = schedule(games, seasonOnly)
  const { players, warnings } = await hydrateRedraftLineupLocks(s.db, {
    sport, season: 2026, week: 4, rosterId: 'r1', leagueSettings: {}, players: ROSTER, now,
  })
  return { locked: Object.fromEntries(players.map((p) => [p.playerId, p.isLocked])), warnings, calls: s.calls }
}

describe('cfbdScheduleTeamKeys — Rolling Insights names against CFBD schedule names', () => {
  it.each([
    ['University of Mississippi', 'Ole Miss'],
    ['Vanderbilt University', 'Vanderbilt'],
    ['University of Miami', 'Miami'],
    ['Miami University', 'Miami (OH)'],
    ['San Jose State University', 'San José State'],
    ['Southern Methodist University', 'SMU'],
    ['University of Massachusetts', 'Massachusetts'],
    ['University of Louisiana at Monroe', 'UL Monroe'],
    ['Appalachian State University', 'App State'],
    ['University of Illinois', 'Illinois'],
  ])('%s is CFBD’s %s', (ri, cfbd) => {
    const a = cfbdScheduleTeamKeys(ri)
    const b = cfbdScheduleTeamKeys(cfbd)
    expect(a.exact === b.exact || a.loose === b.loose).toBe(true)
  })

  it('keeps the two Miamis apart', () => {
    expect(cfbdScheduleTeamKeys('Miami University').loose).not.toBe(cfbdScheduleTeamKeys('University of Miami').loose)
  })

  it('exact-first lookup keys, and the season key NCAAFB is NCAAF', () => {
    expect(lockTeamLookupKeys('NCAAFB', 'University of Illinois')).toEqual(['x:illinois', 'l:illinois'])
    expect(lockTeamLookupKeys('NFL', 'JAC')).toEqual(['JAX'])
  })
})

describe('NCAAF lineup lock', () => {
  it('🛑 locks each player at HIS game’s kickoff, under the NCAAFB season key', async () => {
    const { locked } = await locksAt(new Date('2026-09-26T17:00:00.000Z')) // Sat 1pm ET
    expect(locked).toMatchObject({
      'qb-olemiss': true, // Ole Miss v Vanderbilt kicked at noon ET
      'wr-vandy': true,
      'rb-miamioh': true, // Thursday night
      'rb-miami': false, // tonight
      'wr-sjsu': false,
      'te-smu': false,
      'qb-illinois': false, // Illinois College kicked at noon; Illinois has not
    })
  })

  it('everyone kicked off by Saturday night is locked', async () => {
    const { locked } = await locksAt(new Date('2026-09-27T00:00:00.000Z'))
    expect(Object.entries(locked).filter(([, v]) => v).map(([k]) => k).sort()).toEqual(
      ['qb-illinois', 'qb-olemiss', 'rb-miami', 'rb-miamioh', 'te-smu', 'wr-sjsu', 'wr-vandy'],
    )
  })

  it('a school with no football program fails open, as a bye does', async () => {
    const { locked } = await locksAt(new Date('2026-09-27T12:00:00.000Z'))
    expect(locked['k-nofootball']).toBe(false)
  })

  it('🛑 Illinois on a BYE: its players stay open even though Illinois College plays — ambiguity is judged over the season', async () => {
    const byeWeek = WEEK4.filter((g) => g.homeTeam !== 'Illinois')
    // Illinois still appears in the season's schools, so "illinois" is known to be shared.
    const { locked } = await locksAt(new Date('2026-09-27T12:00:00.000Z'), 'NCAAFB', byeWeek, [['Illinois', 'Purdue']])
    expect(locked['qb-illinois']).toBe(false)
  })

  it('reads CFBD’s regular-season rows for the week, and the season’s schools', async () => {
    const { calls } = await locksAt(SAT_NOON, 'NCAAF')
    expect(calls).toContainEqual({ sport: 'NCAAF', source: 'cfbd', season: 2026, week: 4, seasonType: 'regular', startTime: { not: null } })
    expect(calls).toContainEqual({ sport: 'NCAAF', source: 'cfbd', season: 2026 })
  })

  it('first_game_of_week locks the whole lineup at the week’s first kickoff', async () => {
    const s = schedule(WEEK4)
    const { players } = await hydrateRedraftLineupLocks(s.db, {
      sport: 'NCAAFB', season: 2026, week: 4, rosterId: 'r1',
      leagueSettings: { sportConfig: { lineupLockType: 'first_game_of_week' } },
      players: ROSTER, now: new Date('2026-09-25T00:00:00.000Z'), // just after Thursday's kickoff
    })
    expect(players.every((p) => p.isLocked)).toBe(true)
  })

  it('no CFBD games for the week: warns and fails open', async () => {
    const map = await buildWeekKickoffMap(schedule([]).db, { sport: 'NCAAFB', season: 2026, week: 4 })
    expect(map.byTeam.size).toBe(0)
    expect(map.warnings[0]).toMatch(/No NCAAF \(CFBD\) games/)
  })
})
