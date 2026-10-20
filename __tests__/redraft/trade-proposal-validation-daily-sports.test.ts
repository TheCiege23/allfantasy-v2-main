import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * NBA / NHL / MLB proposals go through the league-wide runtime: the same validator as NFL redraft, with the
 * lineup lock derived for the league's own sport at the SERVER's week.
 *
 * The lock engine is replaced here by a double that locks whatever the test names and records what it was
 * asked — the daily sports' date-windowed lock itself is `lineupLock.ts`'s own contract and has its own suite.
 * What is asserted is that the runtime asks for the right sport and week, and refuses what comes back locked.
 * An imported league (platform `sleeper`) is used so the week visibly comes from the schedule resolver, not the
 * stored `currentWeek` that nothing maintains for imports.
 */

const h = vi.hoisted(() => {
  const state = {
    sport: 'NBA',
    locked: new Set<string>(),
    storedWeek: 1,
    scheduleWeek: 6,
    deadlineWeek: null as number | null,
  }
  const rosters = [
    { id: 'alpha', leagueId: 'league-1', seasonId: 'season-1', teamName: 'Alpha', ownerName: 'A', ownerId: 'user-a', faabBalance: 100, waiverPriority: 1, playoffSeed: 1 },
    { id: 'beta', leagueId: 'league-1', seasonId: 'season-1', teamName: 'Beta', ownerName: 'B', ownerId: 'user-b', faabBalance: 100, waiverPriority: 2, playoffSeed: 2 },
  ]
  const player = (rosterId: string, playerId: string, position: string, slotType: string) => ({
    id: `rp-${playerId}`, rosterId, playerId, playerName: playerId, position, team: 'BOS', sport: state.sport, slotType,
    isLocked: false, injuryStatus: null, byeWeek: null, acquisitionType: 'draft', addedAt: new Date('2026-10-01T00:00:00.000Z'), droppedAt: null,
  })
  const rosterPlayers = [
    player('alpha', 'alpha-pg', 'PG', 'PG'),
    player('alpha', 'alpha-c', 'C', 'C'),
    player('beta', 'beta-sf', 'SF', 'BENCH'),
    player('beta', 'beta-pf', 'PF', 'BENCH'),
  ]
  const rules = {
    general: { sport: 'NBA', format: 'dynasty', season: 2026 },
    draft: {},
    roster: { size: 4, lockAllMoves: false },
    trades: { reviewHours: 48, deadlineWeek: null as number | null, draftPickTrading: false },
    permissions: { memberMovesLocked: false },
  }
  type Where = { id?: { in?: string[] }; rosterId?: { in?: string[] }; playerId?: { in?: string[] } }
  const prisma = {
    redraftSeason: {
      findFirst: async () => ({ id: 'season-1', leagueId: 'league-1', sport: state.sport, season: 2026, currentWeek: state.storedWeek, status: 'active' }),
    },
    league: {
      findUnique: async () => ({
        id: 'league-1',
        // PG + C starters, no bench: an active limit of 2.
        settings: { roster: { config: { sections: [{ slots: { PG: 1, C: 1, BN: 0 } }] } } },
        platform: 'sleeper',
        tradeDeadlineWeek: state.deadlineWeek,
        lifecycleState: 'in_season',
      }),
    },
    redraftRoster: {
      findMany: async (args?: { where?: Where }) => {
        const ids = args?.where?.id?.in
        return ids ? rosters.filter((r) => ids.includes(r.id)) : rosters
      },
    },
    redraftRosterPlayer: {
      findMany: async (args?: { where?: Where }) => {
        const rosterIds = args?.where?.rosterId?.in
        const playerIds = args?.where?.playerId?.in
        return rosterPlayers
          .filter((p) => !rosterIds || rosterIds.includes(p.rosterId))
          .filter((p) => !playerIds || playerIds.includes(p.playerId))
          .map((p) => ({ ...p }))
      },
    },
    redraftTradeProposal: { findMany: async () => [] },
    redraftLeagueTransaction: { findMany: async () => [] },
  }
  const hydrate = vi.fn(async (_db: unknown, args: { players: Array<{ playerId: string }> }) => ({
    players: args.players.map((p) => ({ ...p, isLocked: state.locked.has(p.playerId) })),
    warnings: [],
  }))
  const scheduleWeek = vi.fn(async () => ({ ok: true, fantasyWeek: state.scheduleWeek }))
  return { state, rules, prisma, hydrate, scheduleWeek }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/league-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/league-runtime')>()),
  resolveCanonicalLeagueRules: vi.fn(async () => ({
    ...h.rules,
    general: { ...h.rules.general, sport: h.state.sport },
    trades: { ...h.rules.trades, deadlineWeek: h.state.deadlineWeek },
  })),
}))
vi.mock('@/lib/redraft/lineupLock', () => ({ hydrateRedraftLineupLocksForRosters: h.hydrate }))
vi.mock('@/lib/redraft/lineupLockCurrentTeam', () => ({ resolveCurrentLockTeams: async () => new Map() }))
vi.mock('@/lib/season-week/seasonWeekService', () => ({ resolveSeasonWeekForRedraftSeason: h.scheduleWeek }))

import { validateRedraftTradeProposalAtCreation } from '@/lib/redraft/tradeProposalValidation'

type Asset = Parameters<typeof validateRedraftTradeProposalAtCreation>[0]['assets'][number]
const player = (playerId: string, from: string, to: string): Asset => ({ fromRosterId: from, toRosterId: to, assetType: 'player', playerId, playerName: playerId })
const validate = (assets: Asset[]) =>
  validateRedraftTradeProposalAtCreation({ leagueId: 'league-1', seasonId: 'season-1', proposerRosterId: 'alpha', receiverRosterId: 'beta', assets })

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(h.state, { locked: new Set<string>(), storedWeek: 1, scheduleWeek: 6, deadlineWeek: null })
})

describe.each(['NBA', 'NHL', 'MLB'])('%s league: the league-wide runtime decides', (sport) => {
  beforeEach(() => {
    h.state.sport = sport
  })

  it('allows a valid 1-for-1, and derives the lock for this sport at the schedule week, not the stored week 1', async () => {
    await expect(validate([player('alpha-pg', 'alpha', 'beta'), player('beta-sf', 'beta', 'alpha')])).resolves.toMatchObject({
      ok: true,
      source: 'league_runtime',
    })
    expect(h.hydrate).toHaveBeenCalledTimes(1)
    expect(h.hydrate.mock.calls[0][1]).toMatchObject({ sport, week: 6 })
  })

  it('🛑 refuses a player whose game has started (lineup lock)', async () => {
    h.state.locked = new Set(['alpha-pg'])
    await expect(validate([player('alpha-pg', 'alpha', 'beta')])).resolves.toMatchObject({
      ok: false,
      code: 'LOCKED_PLAYER',
      source: 'league_runtime',
    })
  })

  it('🛑 refuses a trade that leaves a roster over the limit', async () => {
    // alpha is already at the limit of 2 and receives two more: 4 against a limit of 2.
    await expect(
      validate([player('beta-sf', 'beta', 'alpha'), player('beta-pf', 'beta', 'alpha')]),
    ).resolves.toMatchObject({ ok: false, code: 'ROSTER_LIMIT', source: 'league_runtime' })
  })

  it('🛑 refuses after the deadline, with the date-windowed week from the schedule (6 > 5)', async () => {
    h.state.deadlineWeek = 5
    await expect(validate([player('alpha-pg', 'alpha', 'beta')])).resolves.toMatchObject({
      ok: false,
      code: 'TRADE_DEADLINE_PASSED',
      source: 'league_runtime',
    })
  })

  it('before the deadline by the schedule week (4, deadline 5) the same trade is allowed', async () => {
    h.state.deadlineWeek = 5
    h.state.scheduleWeek = 4
    await expect(validate([player('alpha-pg', 'alpha', 'beta'), player('beta-sf', 'beta', 'alpha')])).resolves.toMatchObject({
      ok: true,
      source: 'league_runtime',
    })
  })
})
