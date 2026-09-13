import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Every redraft read path that reports a player's lineup lock must DERIVE it from the schedule.
 *
 * 🛑 WHY THIS FILE EXISTS. `RedraftRosterPlayer.isLocked` is never written as true — the lock is
 * computed at request time by `hydrateRedraftLineupLocks` (lib/redraft/lineupLock.ts), and
 * production held 62,934 roster rows with 0 locked on 2026-09-12. The roster route hydrated; four
 * other paths read the raw column, so for them no player was ever locked:
 *   - the trade runtime would let a manager trade a player whose game had kicked off
 *   - the waiver runtime would let a manager drop one
 *   - the live-scoring runtime validated lineups against an always-false lock
 *   - the NFL data foundation's "Player is locked" roster warning could never be pushed
 *
 * Every fixture row below is STORED unlocked, and the schedule has kicked off for KC and LV. So a
 * locked player can only come from the derivation, never from the column.
 */

const h = vi.hoisted(() => {
  const NOW = new Date('2026-09-13T18:00:00.000Z')
  const PAST = new Date(NOW.getTime() - 60 * 60 * 1000)
  const FUTURE = new Date(NOW.getTime() + 3 * 60 * 60 * 1000)

  const games = [
    { homeTeam: 'KC', awayTeam: 'LV', startTime: PAST },
    { homeTeam: 'BUF', awayTeam: 'MIA', startTime: FUTURE },
  ]

  const row = (rosterId: string, playerId: string, team: string, position: string, slotType: string) => ({
    id: `rp-${playerId}`,
    rosterId,
    playerId,
    playerName: `${team} ${position}`,
    position,
    team,
    sport: 'NFL',
    slotType,
    isLocked: false,
    injuryStatus: null,
    byeWeek: null,
    acquisitionType: 'draft',
    addedAt: new Date('2026-08-20T00:00:00.000Z'),
    droppedAt: null,
  })

  const rosterPlayers = [
    row('alpha', 'kc-qb', 'KC', 'QB', 'QB'), // game kicked off -> locked
    row('alpha', 'buf-rb', 'BUF', 'RB', 'RB'), // game not started -> unlocked
    row('beta', 'mia-wr', 'MIA', 'WR', 'BENCH'), // game not started -> unlocked
    row('beta', 'lv-te', 'LV', 'TE', 'BENCH'), // game kicked off -> locked
  ]

  const rosters = [
    { id: 'alpha', leagueId: 'league-1', seasonId: 'season-1', teamName: 'Alpha', ownerName: 'A', ownerId: 'user-a', faabBalance: 100, waiverPriority: 1, playoffSeed: 1 },
    { id: 'beta', leagueId: 'league-1', seasonId: 'season-1', teamName: 'Beta', ownerName: 'B', ownerId: 'user-b', faabBalance: 100, waiverPriority: 2, playoffSeed: 2 },
  ]

  const rules = {
    version: 1,
    leagueId: 'league-1',
    generatedAtIso: '2026-09-01T00:00:00.000Z',
    source: {
      commissionerSettings: 'League',
      draftSettings: 'LeagueSettings',
      effectiveResolvers: ['draft', 'draftUi', 'scoring', 'waivers', 'playoffs', 'schedule'],
      settingsSnapshotVersion: 1,
      presetKey: 'af:v2|concept=redraft|sport=NFL',
    },
    general: {
      name: 'Lock Hydration League',
      sport: 'NFL',
      season: 2026,
      format: 'redraft',
      variant: null,
      teamCount: 2,
      rosterSize: 4,
      lifecycleState: 'active',
      status: 'active',
      locked: false,
      emergencyPaused: false,
      timezone: 'America/New_York',
      language: 'en',
    },
    draft: {},
    scoring: {
      templateId: 'nfl_half_ppr',
      presetId: 'nfl_half_ppr',
      formatType: 'redraft',
      sport: 'NFL',
      activeRuleCount: 0,
      overriddenRuleCount: 0,
      activeRules: [],
    },
    roster: {
      size: 4,
      starters: ['QB', 'RB'],
      irSlots: 0,
      eligibleReserveStatuses: [],
      allowPreDraftMoves: true,
      preventBenchDrops: false,
      lockAllMoves: false,
    },
    waivers: {
      type: 'faab',
      continuous: false,
      processingDays: [3],
      processingTimeUtc: '10:00',
      processingTimeLocal: '06:00',
      claimLimitPerPeriod: null,
      maxClaimsPerPeriod: null,
      priorityBehavior: 'rolling',
      gameLockBehavior: 'per_player',
      dropLockBehavior: 'locked_after_kickoff',
      freeAgentUnlockBehavior: 'after_clear',
      sameDayAddDropRules: null,
      faabEnabled: true,
      faabBudget: 100,
      faabMinBid: 1,
      faabResetRules: null,
      tiebreakRule: 'waiver_priority',
      instantFreeAgencyAfterClear: true,
    },
    trades: { reviewHours: 48, deadlineWeek: 10, draftPickTrading: true },
    playoffs: {},
    schedule: {
      unit: 'week',
      regularSeasonLength: 14,
      matchupFrequency: 'weekly',
      matchupCadence: 'weekly',
      generationStrategy: 'round_robin',
      playoffTransitionPoint: 15,
      headToHeadBehavior: 'standard',
      lockTimeBehavior: 'per_player_kickoff',
      lockWindowBehavior: 'nfl_week',
      scoringPeriodBehavior: 'weekly',
      rescheduleHandling: null,
      doubleheaderHandling: null,
    },
    permissions: {
      settingsEditableByRoles: ['commissioner', 'co_commissioner'],
      memberMovesLocked: false,
      inviteLinksDisabled: false,
      inviteCapacityOverride: false,
    },
    intelligence: {},
  }

  const season = { id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026, currentWeek: 2, status: 'in_season' }

  const prisma = {
    redraftSeason: { findFirst: async () => season },
    league: { findUnique: async () => ({ settings: {} }) },
    redraftRoster: { findMany: async () => rosters },
    redraftRosterPlayer: { findMany: async () => rosterPlayers.map((p) => ({ ...p })) },
    sportsGame: { findMany: vi.fn(async () => games) },
    playerWeeklyScore: { findMany: async () => [] },
    redraftMatchup: { findMany: async () => [] },
    redraftTradeProposal: { findMany: async () => [] },
    redraftLeagueTransaction: { findMany: async () => [] },
    redraftWaiverClaim: { findMany: async () => [] },
    sportsPlayer: { findMany: async () => [] },
  }

  return { NOW, games, rosterPlayers, rules, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/league-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/league-runtime')>()),
  resolveCanonicalLeagueRules: vi.fn(async () => h.rules),
}))
vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({ getNormalizedPlayerData: vi.fn(async () => []) }))
vi.mock('@/lib/player-data/serializeUnifiedPlayerForApi', () => ({ serializeUnifiedPlayerForApi: vi.fn((row: unknown) => row) }))
vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({ getResolvedDraftPoolForLeague: vi.fn() }))
vi.mock('@/lib/redraft/lineupValidation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/redraft/lineupValidation')>()
  return { ...actual, validateRedraftLineup: vi.fn(actual.validateRedraftLineup) }
})

import { validateRedraftLineup } from '@/lib/redraft/lineupValidation'
import { resolveNflRedraftLiveScoringRuntime } from '@/lib/scoring-runtime/resolveNflRedraftLiveScoringRuntime'
import { resolveNflRedraftTradeRuntime } from '@/lib/trade-runtime/resolveNflRedraftTradeRuntime'
import { validateNflRedraftTradeProposal } from '@/lib/trade-runtime/canonicalNflRedraftTradeRuntime'
import { resolveNflRedraftWaiverRuntime } from '@/lib/waiver-runtime/resolveNflRedraftWaiverRuntime'
import { validateNflRedraftWaiverClaim } from '@/lib/waiver-runtime/canonicalNflRedraftWaiverRuntime'
import { getCanonicalNflRosterContext } from '@/lib/nfl-data-foundation/nflDataFoundationService'

const LOCKED_WARNING = 'Player is locked for the current scoring period.'

beforeEach(() => {
  vi.mocked(validateRedraftLineup).mockClear()
  h.prisma.sportsGame.findMany.mockClear()
})

describe('fixture guard', () => {
  it('stores every roster player unlocked, so any lock below can only be derived', () => {
    expect(h.rosterPlayers.every((p) => p.isLocked === false)).toBe(true)
  })
})

describe('trade runtime derives the lineup lock', () => {
  it('reports kicked-off players as locked and refuses to trade them', async () => {
    const resolved = await resolveNflRedraftTradeRuntime({ seasonId: 'season-1', now: h.NOW })
    if (!resolved.ok) throw new Error(`trade runtime did not resolve: ${resolved.reason}`)

    const team = (rosterId: string) => resolved.state.teams.find((t) => t.rosterId === rosterId)
    expect(team('alpha')?.lockedPlayerIds).toEqual(['kc-qb'])
    expect(team('beta')?.lockedPlayerIds).toEqual(['lv-te'])
    expect(h.prisma.sportsGame.findMany).toHaveBeenCalledTimes(1)

    const tradeOf = (playerId: string) =>
      validateNflRedraftTradeProposal({
        state: resolved.state,
        proposerRosterId: 'alpha',
        receiverRosterId: 'beta',
        assets: [{ fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'player', playerId, playerName: playerId }],
        now: h.NOW,
      })
    expect(tradeOf('kc-qb')).toMatchObject({ ok: false, code: 'LOCKED_PLAYER' })
    // Control: the refusal is about the lock, not about trading from this roster at all.
    expect(tradeOf('buf-rb')).not.toMatchObject({ code: 'LOCKED_PLAYER' })
  })
})

describe('waiver runtime derives the lineup lock', () => {
  it('reports kicked-off players as locked and refuses to drop them', async () => {
    const resolved = await resolveNflRedraftWaiverRuntime({ seasonId: 'season-1', now: h.NOW })
    if (!resolved.ok) throw new Error(`waiver runtime did not resolve: ${resolved.reason}`)

    const team = (rosterId: string) => resolved.state.teams.find((t) => t.rosterId === rosterId)
    expect(team('alpha')?.lockedPlayerIds).toEqual(['kc-qb'])
    expect(team('beta')?.lockedPlayerIds).toEqual(['lv-te'])
    expect(h.prisma.sportsGame.findMany).toHaveBeenCalledTimes(1)

    const claimDropping = (dropPlayerId: string) =>
      validateNflRedraftWaiverClaim({
        state: resolved.state,
        requireClaimWindow: false,
        claim: {
          claimId: `claim-${dropPlayerId}`,
          rosterId: 'alpha',
          addPlayerId: 'free-agent-1',
          addPlayerName: 'Free Agent',
          addPlayerPosition: 'WR',
          addPlayerTeam: 'NYJ',
          dropPlayerId,
          dropPlayerName: dropPlayerId,
          bidAmount: 1,
          priority: 1,
          conditionalGroupId: null,
          conditionalRank: 1,
          status: 'pending',
          submittedAtIso: h.NOW.toISOString(),
          actorUserId: null,
        },
      })
    expect(claimDropping('kc-qb')).toMatchObject({ ok: false, code: 'LOCKED_PLAYER' })
    // Control: the refusal is about the lock, not about dropping from this roster at all.
    expect(claimDropping('buf-rb')).not.toMatchObject({ code: 'LOCKED_PLAYER' })
  })
})

describe('live scoring runtime derives the lineup lock', () => {
  it('validates each lineup against the derived lock, not the stored column', async () => {
    const resolved = await resolveNflRedraftLiveScoringRuntime({ seasonId: 'season-1', now: h.NOW })
    if (!resolved.ok) throw new Error(`live scoring runtime did not resolve: ${resolved.reason}`)

    // Scoring output carries no lock field, so the lineup validation input is the only place it lands.
    const validated = vi.mocked(validateRedraftLineup).mock.calls.flatMap(([args]) => args.players)
    const lockOf = (playerId: string) => validated.find((p) => p.playerId === playerId)?.isLocked
    expect(lockOf('kc-qb')).toBe(true)
    expect(lockOf('lv-te')).toBe(true)
    expect(lockOf('buf-rb')).toBe(false)
    expect(lockOf('mia-wr')).toBe(false)
    expect(h.prisma.sportsGame.findMany).toHaveBeenCalledTimes(1)
  })
})

describe('NFL data foundation roster context derives the lineup lock', () => {
  /**
   * A client that answers the roster, league, schedule and player reads, and returns empty for every
   * other model the canonical player builder touches, so the test exercises the real module.
   */
  function foundationDb() {
    const players = {
      'kc-qb': { id: 'kc-qb', externalId: 'ext-kc-qb', name: 'KC QB', position: 'QB', team: 'KC', sport: 'NFL', status: 'Active' },
      'buf-rb': { id: 'buf-rb', externalId: 'ext-buf-rb', name: 'BUF RB', position: 'RB', team: 'BUF', sport: 'NFL', status: 'Active' },
    } as Record<string, Record<string, unknown>>
    const overrides: Record<string, Record<string, (args?: any) => Promise<unknown>>> = {
      redraftRoster: {
        findUnique: async () => ({
          id: 'alpha',
          leagueId: 'league-1',
          season: { season: 2026, currentWeek: 2, sport: 'NFL' },
          players: h.rosterPlayers.filter((p) => p.rosterId === 'alpha').map((p) => ({ ...p })),
        }),
      },
      league: { findUnique: async () => ({ settings: {} }) },
      sportsGame: { findMany: async () => h.games },
      sportsPlayer: {
        findMany: async (args?: any) => {
          const ids: string[] = args?.where?.OR?.[0]?.id?.in ?? []
          return ids.map((id) => players[id]).filter(Boolean)
        },
      },
    }
    const emptyFor = (method: string) => {
      if (method === 'findMany' || method === 'groupBy') return []
      if (method === 'count') return 0
      return null
    }
    return new Proxy({} as Record<string, unknown>, {
      get(_t, model) {
        if (model === 'then') return undefined
        if (typeof model !== 'string') return undefined
        if (model.startsWith('$')) return async () => []
        return new Proxy({} as Record<string, unknown>, {
          get(_m, method) {
            if (method === 'then' || typeof method !== 'string') return undefined
            return overrides[model]?.[method] ?? (async () => emptyFor(method))
          },
        })
      },
    })
  }

  it('reports a kicked-off player as locked and pushes the locked warning', async () => {
    const context = await getCanonicalNflRosterContext('alpha', { prismaClient: foundationDb() as never, now: h.NOW })

    const kc = context.find((p) => p.rosterId === 'alpha' && p.team === 'KC')
    const buf = context.find((p) => p.rosterId === 'alpha' && p.team === 'BUF')
    expect(kc, 'the KC player must resolve through the real canonical builder').toBeDefined()
    expect(buf, 'the BUF player must resolve through the real canonical builder').toBeDefined()
    expect(kc?.isLocked).toBe(true)
    expect(kc?.lineupWarnings).toContain(LOCKED_WARNING)
    expect(buf?.isLocked).toBe(false)
    expect(buf?.lineupWarnings).not.toContain(LOCKED_WARNING)
  })
})
