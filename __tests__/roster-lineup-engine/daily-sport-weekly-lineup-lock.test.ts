/**
 * A native NBA / MLB / NHL lineup must not let a manager bench a player after his first game of the
 * fantasy week — the week is scored from the slot he holds at scoring time, so that would erase the
 * game. Drives the REAL `resolveFullLineupLockContext` and the REAL redraft weekly-lock derivation
 * (`hydrateRedraftLineupLocks`); only the database and the week's game list are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  redraftRosterId: 'rr-1' as string | null,
  players: [] as Array<{ playerId: string; team: string | null }>,
  games: [] as Array<{ homeTeam: string; awayTeam: string; startTime: Date | null; status: string | null; day?: string }>,
  nflGames: [] as Array<{ homeTeam: string; awayTeam: string; startTime: Date | null; seasonType?: string | null }>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findUnique: async () => ({ redraftRosterId: h.redraftRosterId, platformUserId: 'u1' }) },
    redraftRosterPlayer: { findMany: async () => h.players },
    sportsGame: { findMany: async () => h.nflGames },
  },
}))
vi.mock('@/lib/specialty-league/registry', () => ({ getSpecialtySpecByVariant: () => null }))
vi.mock('@/lib/redraft/weekGames', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/redraft/weekGames')>()),
  readWeekGames: async () => h.games,
}))

import { resolveFullLineupLockContext } from '@/lib/roster-lineup-engine/lineupLockService'
import { movedLockedLineupPlayer } from '@/lib/roster-lineup-engine/lineupService'

// NBA 2026 week 1 opens 2026-10-20 (curated). 14:00Z is 10 AM ET — the whole-lineup 6 PM lock is OFF.
const NOW = new Date('2026-10-22T14:00:00.000Z')
// gameTime '—' is what a save stores when the UI had no kickoff: the old heuristic never locks it.
const lineup = (starters: string[], bench: string[]) => ({
  lineup_sections: {
    starters: starters.map((id) => ({ id, gameTime: '—' })),
    bench: bench.map((id) => ({ id, gameTime: '—' })),
  },
})
const playerData = lineup(['tatum', 'brunson'], ['bench-guy'])

function args(overrides: Record<string, unknown> = {}) {
  return {
    leagueId: 'L1', rosterId: 'R1', sport: 'NBA', leagueVariant: null, settings: {},
    leagueWeek: 1, editingWeek: 1, season: 2026, now: NOW, playerData, ...overrides,
  }
}

describe('daily-sport weekly lineup locks on the roster-engine save path', () => {
  beforeEach(() => {
    h.redraftRosterId = 'rr-1'
    h.players = [
      { playerId: 'tatum', team: 'Boston Celtics' },
      { playerId: 'brunson', team: 'New York Knicks' },
      { playerId: 'bench-guy', team: 'Miami Heat' },
    ]
    h.games = [
      // Celtics played last night; Knicks and Heat have not played yet this week.
      { homeTeam: 'Boston Celtics', awayTeam: 'Orlando Magic', startTime: new Date('2026-10-21T23:30:00.000Z'), status: 'final' },
      { homeTeam: 'New York Knicks', awayTeam: 'Miami Heat', startTime: new Date('2026-10-24T23:30:00.000Z'), status: 'scheduled' },
    ]
  })

  it('locks a starter whose first game of the week has started, even with the lineup otherwise open', async () => {
    const ctx = await resolveFullLineupLockContext(args())
    expect(ctx.locked).toBe(false)
    expect(ctx.lockedPlayerIds).toEqual(['tatum'])
    expect(ctx.perPlayerReasons.tatum).toMatch(/first game of the fantasy week/)
  })

  it('refuses benching him the morning after, and still allows moving players who have not played', async () => {
    const ctx = await resolveFullLineupLockContext(args())
    const benchTatum = lineup(['bench-guy', 'brunson'], ['tatum'])
    expect(movedLockedLineupPlayer(playerData, benchTatum, ctx.lockedPlayerIds)).toBe('tatum')
    const swapOthers = lineup(['tatum', 'bench-guy'], ['brunson'])
    expect(movedLockedLineupPlayer(playerData, swapOthers, ctx.lockedPlayerIds)).toBeNull()
  })

  it('applies to NHL too (curated 2026 opener 2026-09-29)', async () => {
    h.players = [{ playerId: 'mcdavid', team: 'Edmonton Oilers' }, { playerId: 'makar', team: 'Colorado Avalanche' }]
    h.games = [
      { homeTeam: 'Edmonton Oilers', awayTeam: 'Calgary Flames', startTime: new Date('2026-09-30T01:00:00.000Z'), status: 'final' },
      { homeTeam: 'Colorado Avalanche', awayTeam: 'Dallas Stars', startTime: new Date('2026-10-03T01:00:00.000Z'), status: 'scheduled' },
    ]
    const ctx = await resolveFullLineupLockContext(args({ sport: 'NHL', now: new Date('2026-10-01T14:00:00.000Z') }))
    expect(ctx.lockedPlayerIds).toEqual(['mcdavid'])
  })

  it('leaves a past week to the view-only lock, and a league with no native redraft roster alone', async () => {
    expect((await resolveFullLineupLockContext(args({ leagueWeek: 2, editingWeek: 1 }))).locked).toBe(true)
    h.redraftRosterId = null
    expect((await resolveFullLineupLockContext(args())).lockedPlayerIds).toEqual([])
  })

  /*
   * 🛑 A FUTURE WEEK USED TO SKIP EVERY LOCK. The save still writes the roster's CURRENT slots, so asking
   * for week 2 moved a week-1 starter who had already played.
   */
  it('locks a save for a FUTURE week by this week\'s schedule, since it writes the current lineup', async () => {
    expect((await resolveFullLineupLockContext(args({ editingWeek: 2 }))).lockedPlayerIds).toEqual(['tatum'])
  })

  it('honours a commissioner emergency unlock for the player', async () => {
    const ctx = await resolveFullLineupLockContext(
      args({ settings: { sportConfig: { lineupLockOverrides: [{ week: 1, playerId: 'tatum' }] } } }),
    )
    expect(ctx.lockedPlayerIds).toEqual([])
  })
})

describe('a daily-lineup league on the roster-engine save path', () => {
  const DAILY = { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } }
  // 2026-10-22 23:45Z is 7:45 PM ET: the weekly path's whole-lineup 6 PM lock is ON.
  const EVENING = new Date('2026-10-22T23:45:00.000Z')

  beforeEach(() => {
    h.redraftRosterId = 'rr-1'
    h.players = [
      { playerId: 'tatum', team: 'Boston Celtics' },
      { playerId: 'brunson', team: 'New York Knicks' },
      { playerId: 'bench-guy', team: 'Miami Heat' },
    ]
    h.games = [
      // Celtics played last night; tonight the Knicks tipped at 7:30 PM ET; the Heat play at 10:30 PM ET.
      { homeTeam: 'Boston Celtics', awayTeam: 'Orlando Magic', startTime: new Date('2026-10-21T23:30:00.000Z'), status: 'final' },
      { homeTeam: 'New York Knicks', awayTeam: 'Toronto Raptors', startTime: new Date('2026-10-22T23:30:00.000Z'), status: 'in_progress' },
      { homeTeam: 'Miami Heat', awayTeam: 'Utah Jazz', startTime: new Date('2026-10-23T02:30:00.000Z'), status: 'scheduled' },
    ]
  })

  it('has no 6 PM whole-lineup lock: only the player whose game has started today is locked', async () => {
    const ctx = await resolveFullLineupLockContext(args({ settings: DAILY, now: EVENING }))
    expect(ctx.locked).toBe(false)
    expect(ctx.policy).toBe('daily_per_player')
    // Tatum played YESTERDAY, so he is free again today; Brunson is mid-game.
    expect(ctx.lockedPlayerIds).toEqual(['brunson'])
    expect(ctx.perPlayerReasons.brunson).toMatch(/game today has started/)
  })

  /*
   * 🛑 THE 6 PM WHOLE-LINEUP GUESS IS GONE ONCE THE SCHEDULE IS KNOWN (owner's rule 2026-11-23: only a
   * player whose game has started is locked). It froze the Heat player at 7:45 PM before his 10:30 tip.
   */
  it('a weekly league at the same moment locks per player, not the whole lineup', async () => {
    const ctx = await resolveFullLineupLockContext(args({ now: EVENING }))
    expect(ctx.locked).toBe(false)
    expect(ctx.policy).toBe('per_player_schedule')
    expect([...ctx.lockedPlayerIds].sort()).toEqual(['brunson', 'tatum'])
  })

  it('fails CLOSED when the schedule cannot be read, since per-player locks are its only lock', async () => {
    h.games = null as never // readWeekGames returning null makes the lock derivation throw
    const ctx = await resolveFullLineupLockContext(args({ settings: DAILY, now: EVENING }))
    expect(ctx.locked).toBe(true)
    expect(ctx.policy).toBe('schedule_lock_unavailable')
  })
})

/*
 * 🛑 NFL, NCAAF AND SOCCER HAD NO SCHEDULE LOCK ON THIS PATH (2026-11-23). The football time window's
 * Thursday branch sat below a Wed–Sat "unlocked" return and never ran, so a Thursday-night starter could be
 * benched on Friday and his points erased; and from Sunday 1 PM ET it locked EVERY player, so a Sunday- or
 * Monday-night starter could not be swapped before his own game.
 */
describe('NFL on the roster-engine save path', () => {
  // NFL 2026 week 12: KC plays Thursday night, SF on Sunday night.
  const TNF = new Date('2026-11-27T01:20:00.000Z')
  const SNF = new Date('2026-11-30T01:20:00.000Z')
  const nfl = (now: string) => args({ sport: 'NFL', season: 2026, leagueWeek: 12, editingWeek: 12, now: new Date(now) })

  beforeEach(() => {
    h.redraftRosterId = 'rr-1'
    h.players = [
      { playerId: 'kc-rb', team: 'KC' },
      { playerId: 'sf-rb', team: 'SF' },
    ]
    h.nflGames = [
      { homeTeam: 'KC', awayTeam: 'DAL', startTime: TNF, seasonType: 'regular' },
      { homeTeam: 'SF', awayTeam: 'SEA', startTime: SNF, seasonType: 'regular' },
    ]
  })

  it('locks the Thursday-night starter from his kickoff through Friday', async () => {
    const friday = await resolveFullLineupLockContext(nfl('2026-11-27T18:00:00.000Z'))
    expect(friday.lockedPlayerIds).toEqual(['kc-rb'])
    expect(movedLockedLineupPlayer(
      { lineup_sections: { starters: [{ id: 'kc-rb' }], bench: [{ id: 'sf-rb' }] } },
      { lineup_sections: { starters: [{ id: 'sf-rb' }], bench: [{ id: 'kc-rb' }] } },
      friday.lockedPlayerIds,
    )).toBe('kc-rb')
  })

  it('lets a Sunday-night player be swapped on Sunday afternoon: no whole-lineup lock', async () => {
    const ctx = await resolveFullLineupLockContext(nfl('2026-11-29T19:00:00.000Z'))
    expect(ctx.locked).toBe(false)
    expect(ctx.policy).toBe('per_player_schedule')
    expect(ctx.lockedPlayerIds).toEqual(['kc-rb'])
  })

  it('[control] with no games stored for the week it keeps the time-window fallback', async () => {
    h.nflGames = []
    const ctx = await resolveFullLineupLockContext(nfl('2026-11-29T19:00:00.000Z'))
    expect(ctx.locked).toBe(true)
    expect(ctx.policy).toBe('football_weekly')
  })
})
