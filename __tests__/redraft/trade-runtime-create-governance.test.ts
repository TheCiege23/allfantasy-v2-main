import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `createNflRedraftTradeProposal` records the LEAGUE's review rule on the proposal.
 *
 * 🛑 It used to take `vetoMode` and `vetoThreshold` from its caller, and `/api/redraft/trade-runtime` passed
 * them straight from the request body — so a direct caller could create a `no_veto` trade that settled on
 * accept. The route now refuses those fields (g44), and this proves the runtime itself resolves governance
 * from `RedraftLeagueExtendedSettings.commissionerTradeReviewType` rather than defaulting.
 *
 * The runtime runs for real against a prisma fixture, so the value asserted is the one written to the row.
 */

const h = vi.hoisted(() => {
  const season = { id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026, currentWeek: 2, status: 'in_season' }
  const rosters = [
    { id: 'alpha', leagueId: 'league-1', seasonId: 'season-1', teamName: 'Alpha', ownerName: 'A', ownerId: 'user-a', faabBalance: 100, waiverPriority: 1, playoffSeed: 1 },
    { id: 'beta', leagueId: 'league-1', seasonId: 'season-1', teamName: 'Beta', ownerName: 'B', ownerId: 'user-b', faabBalance: 100, waiverPriority: 2, playoffSeed: 2 },
  ]
  const player = (rosterId: string, playerId: string, position: string, slotType: string) => ({
    id: `rp-${playerId}`,
    rosterId,
    playerId,
    playerName: playerId,
    position,
    team: 'BUF',
    sport: 'NFL',
    slotType,
    isLocked: false,
    injuryStatus: null,
    byeWeek: null,
    acquisitionType: 'draft',
    addedAt: new Date('2026-08-20T00:00:00.000Z'),
    droppedAt: null,
  })
  const rosterPlayers = [player('alpha', 'alpha-rb', 'RB', 'RB'), player('beta', 'beta-wr', 'WR', 'BENCH')]

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
      name: 'Governance League',
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
    scoring: { templateId: 'nfl_half_ppr', presetId: 'nfl_half_ppr', formatType: 'redraft', sport: 'NFL', activeRuleCount: 0, overriddenRuleCount: 0, activeRules: [] },
    roster: { size: 4, starters: ['QB', 'RB'], irSlots: 0, eligibleReserveStatuses: [], allowPreDraftMoves: true, preventBenchDrops: false, lockAllMoves: false },
    waivers: {},
    trades: { reviewHours: 48, deadlineWeek: 10, draftPickTrading: true },
    playoffs: {},
    schedule: {},
    permissions: { settingsEditableByRoles: ['commissioner', 'co_commissioner'], memberMovesLocked: false, inviteLinksDisabled: false, inviteCapacityOverride: false },
    intelligence: {},
  }

  const proposalCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: args.data.id }))
  const extendedSettings = vi.fn()

  const tx = {
    redraftTradeProposal: { create: proposalCreate, findUnique: async () => ({ id: 'created', assets: [], votes: [], decision: null }) },
    redraftTradeAsset: { createMany: async () => ({ count: 1 }) },
    redraftLeagueTransaction: { create: async () => ({}) },
  }

  const prisma = {
    redraftSeason: { findFirst: async () => season },
    league: { findUnique: async () => ({ settings: {} }) },
    redraftRoster: { findMany: async () => rosters },
    redraftRosterPlayer: { findMany: async () => rosterPlayers.map((p) => ({ ...p })) },
    sportsGame: { findMany: async () => [] },
    redraftTradeProposal: { findMany: async () => [] },
    redraftLeagueTransaction: { findMany: async () => [] },
    redraftLeagueExtendedSettings: { findUnique: extendedSettings },
    leagueEvent: { createMany: async () => ({ count: 0 }) },
    $transaction: async (cb: (client: typeof tx) => unknown) => cb(tx),
  }

  return { rules, prisma, proposalCreate, extendedSettings }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/league-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/league-runtime')>()),
  resolveCanonicalLeagueRules: vi.fn(async () => h.rules),
}))

import { createNflRedraftTradeProposal } from '@/lib/trade-runtime/resolveNflRedraftTradeRuntime'

const propose = () =>
  createNflRedraftTradeProposal({
    seasonId: 'season-1',
    proposerRosterId: 'alpha',
    receiverRosterId: 'beta',
    assets: [{ fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'player', playerId: 'alpha-rb', playerName: 'alpha-rb' }],
    actorUserId: 'user-a',
  })

const written = () => h.proposalCreate.mock.calls[0]![0].data

beforeEach(() => {
  h.proposalCreate.mockClear()
  h.extendedSettings.mockReset()
})

describe('createNflRedraftTradeProposal resolves governance from league settings', () => {
  it("records a league_vote league's rule, not the commissioner default", async () => {
    h.extendedSettings.mockResolvedValue({ commissionerTradeReviewType: 'league_vote' })
    await propose()

    expect(h.extendedSettings).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'league-1' } }))
    expect(written()).toMatchObject({ vetoMode: 'league_vote', vetoThreshold: 4 })
  })

  it('records no_veto only when the league saved an instant review type', async () => {
    h.extendedSettings.mockResolvedValue({ commissionerTradeReviewType: 'instant' })
    await propose()
    expect(written()).toMatchObject({ vetoMode: 'no_veto' })
  })

  it('requires commissioner review when the league has no saved settings row', async () => {
    h.extendedSettings.mockResolvedValue(null)
    await propose()
    expect(h.extendedSettings).toHaveBeenCalledTimes(1)
    expect(written()).toMatchObject({ vetoMode: 'commissioner', vetoThreshold: 4 })
  })
})
