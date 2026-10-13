/**
 * 🛑 The NFL live-scoring runtime read `player_weekly_scores` and the unified player rows by RAW roster
 * id. The score sync now writes a foreign (ESPN / Fleaflicker) league's scores under the crosswalked
 * SLEEPER id, so the raw read found nothing for such a league — and, where the digits collide, a
 * stranger's week: Fleaflicker 13761 (Josh Allen, QB) is a Sleeper DL.
 *
 * The weekly-score fake evaluates `playerId IN (...)`, so a read asked with the raw roster id gets the
 * stranger's row back — exactly as production would.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const h = vi.hoisted(() => {
  const state = {
    platform: 'fleaflicker' as string | null,
    identity: [] as Row[],
    scores: [] as Row[],
    rosterPlayers: [] as Row[],
    unifiedAskedWith: [] as string[][],
    settings: {} as Row,
  }
  const inFilter = (rows: () => Row[]) => async (args: { where?: Row } = {}) =>
    rows().filter((r) =>
      Object.entries(args.where ?? {}).every(([k, cond]) =>
        cond && typeof cond === 'object' && 'in' in (cond as object) ? (cond as { in: unknown[] }).in.includes(r[k]) : true,
      ),
    )
  const prisma = {
    redraftSeason: { findFirst: async () => ({ id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026, currentWeek: 2, status: 'in_season' }) },
    league: {
      findUnique: async () => ({ settings: state.settings, platform: state.platform }),
      update: vi.fn(async (args: { data: { settings: Row } }) => {
        state.settings = args.data.settings
        return {}
      }),
    },
    redraftRoster: { findMany: async () => [{ id: 'alpha', leagueId: 'league-1', seasonId: 'season-1', teamName: 'Alpha', ownerName: 'A' }] },
    redraftRosterPlayer: {
      findMany: async () => state.rosterPlayers.map((p) => ({ ...p })),
      findFirst: async (args: { where: { playerId: string } }) => state.rosterPlayers.find((p) => p.playerId === args.where.playerId) ?? null,
    },
    playerIdentityMap: { findMany: vi.fn(inFilter(() => state.identity)) },
    playerWeeklyScore: {
      findMany: vi.fn(inFilter(() => state.scores)),
      findUnique: vi.fn(async (args: { where: { playerId_week_season_sport: { playerId: string } } }) =>
        state.scores.find((r) => r.playerId === args.where.playerId_week_season_sport.playerId) ?? null,
      ),
      upsert: vi.fn(async () => ({})),
    },
    adminAuditLog: { create: vi.fn(async () => ({})) },
    redraftMatchup: { findMany: async () => [] },
    sportsGame: { findMany: async () => [] },
  }
  return { state, prisma }
})

const rules = {
  version: 1,
  leagueId: 'league-1',
  generatedAtIso: '2026-09-01T00:00:00.000Z',
  source: { commissionerSettings: 'League', draftSettings: 'LeagueSettings', effectiveResolvers: [], settingsSnapshotVersion: 1, presetKey: 'af:v2|concept=redraft|sport=NFL' },
  general: { name: 'Foreign', sport: 'NFL', season: 2026, format: 'redraft', variant: null, teamCount: 1, rosterSize: 1, lifecycleState: 'active', status: 'active', locked: false, emergencyPaused: false, timezone: 'America/New_York', language: 'en' },
  draft: {},
  scoring: { templateId: 'nfl_half_ppr', presetId: 'nfl_half_ppr', formatType: 'redraft', sport: 'NFL', activeRuleCount: 0, overriddenRuleCount: 0, activeRules: [] },
  roster: { size: 1, starters: ['QB'], irSlots: 0, eligibleReserveStatuses: [], allowPreDraftMoves: true, preventBenchDrops: false, lockAllMoves: false },
  waivers: {},
  trades: { reviewHours: 48, deadlineWeek: 10, draftPickTrading: true },
  playoffs: {},
  schedule: {},
  permissions: {},
  intelligence: {},
}

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/league-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/league-runtime')>()),
  resolveCanonicalLeagueRules: vi.fn(async () => rules),
}))
vi.mock('@/lib/redraft/lineupLock', () => ({
  hydrateRedraftLineupLocksForRosters: vi.fn(async (_db: unknown, args: { players: unknown[] }) => ({ players: args.players })),
}))
vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({
  getNormalizedPlayerData: vi.fn(async (args: { playerIds: string[] }) => {
    h.state.unifiedAskedWith.push([...args.playerIds])
    return []
  }),
}))
vi.mock('@/lib/player-data/serializeUnifiedPlayerForApi', () => ({ serializeUnifiedPlayerForApi: vi.fn((row: unknown) => row) }))
vi.mock('@/lib/redraft/standingsEngine', () => ({ updateStandings: vi.fn(async () => []) }))

import {
  applyNflRedraftStatCorrectionToSeason,
  ingestNflRedraftStatPayload,
  resolveNflRedraftLiveScoringRuntime,
} from '@/lib/scoring-runtime/resolveNflRedraftLiveScoringRuntime'

const qb = (playerId: string) => ({
  id: `rp-${playerId}`, rosterId: 'alpha', playerId, playerName: 'Josh Allen', position: 'QB', team: 'BUF', sport: 'NFL',
  slotType: 'QB', isLocked: false, injuryStatus: null, byeWeek: null, acquisitionType: 'draft', addedAt: new Date('2026-08-20'), droppedAt: null,
})
const weekRow = (playerId: string, stats: Record<string, number>) => ({
  playerId, sport: 'NFL', season: 2026, week: 2, stats, fantasyPts: 0, isFinalized: false, updatedAt: new Date('2026-09-15T00:00:00Z'),
})

async function starter(playerId: string) {
  const resolved = await resolveNflRedraftLiveScoringRuntime({ seasonId: 'season-1', week: 2 })
  if (!resolved.ok) throw new Error(`runtime did not resolve: ${resolved.reason}`)
  const p = resolved.state.teams[0]!.starters.find((s) => s.playerId === playerId)
  if (!p) throw new Error(`starter ${playerId} missing`)
  return p
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.platform = 'fleaflicker'
  h.state.identity = []
  h.state.scores = []
  h.state.rosterPlayers = [qb('13761')]
  h.state.unifiedAskedWith = []
  h.state.settings = {}
})

describe('NFL live-scoring runtime — foreign roster ids read through the crosswalk', () => {
  it('🛑 Fleaflicker 13761 (Josh Allen), unmapped: no stats from Sleeper 13761 (a DL), no unified read by it', async () => {
    h.state.scores = [weekRow('13761', { def_tkl: 7 })]

    const p = await starter('13761')
    expect(p.hasStats).toBe(false)
    expect(p.stats).toEqual({})
    expect(h.prisma.playerWeeklyScore.findMany).not.toHaveBeenCalled()
    expect(h.state.unifiedAskedWith.flat()).not.toContain('13761')
  })

  it('Fleaflicker 13761 mapped to Sleeper 4984 reads ALLEN\'s row (written there by the score sync), on the roster id', async () => {
    h.state.identity = [{ sport: 'NFL', fleaflickerId: '13761', espnId: null, mflId: null, sleeperId: '4984' }]
    h.state.scores = [weekRow('13761', { def_tkl: 7 }), weekRow('4984', { pass_yds: 300 })]

    const p = await starter('13761')
    expect(p.hasStats).toBe(true)
    expect(p.stats.pass_yds).toBe(300)
    expect(p.stats.def_tkl).toBeUndefined()
    expect(h.state.unifiedAskedWith).toEqual([['4984']])
  })

  it('a native league reads its own ids, with no crosswalk read', async () => {
    h.state.platform = 'sleeper'
    h.state.rosterPlayers = [qb('4984')]
    h.state.scores = [weekRow('4984', { pass_yds: 250 })]

    const p = await starter('4984')
    expect(p.hasStats).toBe(true)
    expect(p.stats.pass_yds).toBe(250)
    expect(h.prisma.playerIdentityMap.findMany).not.toHaveBeenCalled()
  })
})

const upsertedIds = () =>
  h.prisma.playerWeeklyScore.upsert.mock.calls.map(
    ([a]) => (a as { where: { playerId_week_season_sport: { playerId: string } } }).where.playerId_week_season_sport.playerId,
  )

describe('NFL stat-payload ingest — writes under the Sleeper id, never a raw foreign id', () => {
  it('🛑 Fleaflicker 13761 unmapped: skipped and counted, nothing written under 13761 (a Sleeper DL)', async () => {
    const result = await ingestNflRedraftStatPayload({ seasonId: 'season-1', week: 2, rows: [{ playerId: '13761', stats: { pass_yds: 300 } }] })

    expect(h.prisma.playerWeeklyScore.upsert).not.toHaveBeenCalled()
    expect(result.synced).toBe(0)
    expect(result.untranslatedForeignPlayerIds).toEqual(['13761'])
    expect(result.skipped).toEqual(['13761'])
  })

  it('Fleaflicker 13761 mapped to 4984: written under 4984', async () => {
    h.state.identity = [{ sport: 'NFL', fleaflickerId: '13761', espnId: null, mflId: null, sleeperId: '4984' }]
    const result = await ingestNflRedraftStatPayload({ seasonId: 'season-1', week: 2, rows: [{ playerId: '13761', stats: { pass_yds: 300 } }] })

    expect(upsertedIds()).toEqual(['4984'])
    expect(result.synced).toBe(1)
    expect(result.untranslatedForeignPlayerIds).toEqual([])
  })

  it('a native league writes under its own ids, as before', async () => {
    h.state.platform = 'sleeper'
    h.state.rosterPlayers = [qb('4984')]
    await ingestNflRedraftStatPayload({ seasonId: 'season-1', week: 2, rows: [{ playerId: '4984', stats: { pass_yds: 300 } }] })
    expect(upsertedIds()).toEqual(['4984'])
  })
})

describe('NFL stat correction — this league only, and never a raw foreign id in Sleeper\'s space', () => {
  // The correction used to be WRITTEN to the shared PlayerWeeklyScore row (under the Sleeper id), which
  // changed the player in every league. It is now stored on this league, keyed by the roster's own id —
  // the id the runtime maps rows back to — and the shared table is only READ, for the "before" line.
  const stored = () => (h.state.settings.stat_overrides as Record<string, Record<string, { stats: Row }>>)['2026:2']

  it('🛑 Fleaflicker 13761 unmapped: nothing read or written under 13761 in the shared table; the line is stored on this league', async () => {
    h.state.scores = [weekRow('13761', { def_tkl: 7 })]

    await applyNflRedraftStatCorrectionToSeason({ seasonId: 'season-1', week: 2, playerId: '13761', correctedStats: { pass_yds: 280 } })
    expect(h.prisma.playerWeeklyScore.upsert).not.toHaveBeenCalled()
    expect(h.prisma.playerWeeklyScore.findUnique).not.toHaveBeenCalled()
    expect(stored()['13761']!.stats).toMatchObject({ pass_yds: 280 })
  })

  it('Fleaflicker 13761 mapped to 4984: the before line is ALLEN\'s row under 4984; nothing shared is written', async () => {
    h.state.identity = [{ sport: 'NFL', fleaflickerId: '13761', espnId: null, mflId: null, sleeperId: '4984' }]
    h.state.scores = [weekRow('13761', { def_tkl: 7 }), weekRow('4984', { pass_yds: 250 })]

    await applyNflRedraftStatCorrectionToSeason({ seasonId: 'season-1', week: 2, playerId: '13761', correctedStats: { pass_yds: 280 } })

    const read = h.prisma.playerWeeklyScore.findUnique.mock.calls[0]![0] as { where: { playerId_week_season_sport: { playerId: string } } }
    expect(read.where.playerId_week_season_sport.playerId).toBe('4984')
    expect(h.prisma.playerWeeklyScore.upsert).not.toHaveBeenCalled()
    expect(stored()['13761']!.stats).toMatchObject({ pass_yds: 280 })
  })

  it('the stored line is what this league\'s runtime scores, on the roster id', async () => {
    h.state.scores = [weekRow('13761', { def_tkl: 7 })]
    await applyNflRedraftStatCorrectionToSeason({ seasonId: 'season-1', week: 2, playerId: '13761', correctedStats: { pass_yds: 280 } })
    const p = await starter('13761')
    expect(p.stats).toMatchObject({ pass_yds: 280 })
  })
})
