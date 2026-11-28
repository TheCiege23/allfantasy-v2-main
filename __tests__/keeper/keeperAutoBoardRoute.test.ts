import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  evaluate: vi.fn(),
  commish: vi.fn(),
  league: vi.fn(),
  draft: vi.fn(),
  window: vi.fn(),
  records: vi.fn(),
  seasonRosters: vi.fn(),
  rosters: vi.fn(),
  update: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'commish' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/commissionerAccess', () => ({ assertCommissionerAccess: m.commish }))
vi.mock('@/lib/tournament/seasonDraftMutationGate', () => ({ isSeasonTournamentDraft: vi.fn(async () => false), SEASON_DRAFT_MUTATION_BLOCKED: 'blocked' }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ buildSessionSnapshot: vi.fn(async () => ({ keeper: { locks: [] } })) }))
vi.mock('@/lib/live-draft-engine/createNextLeagueDraft', () => ({
  draftRosterIdForOwner: (ownerId: string) => ({ u1: 'A', u2: 'B' } as Record<string, string>)[ownerId] ?? null,
}))
vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: class {
    evaluateUserFeatureAccess = m.evaluate
  },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: m.league },
    draftSession: { findFirst: m.draft, updateMany: m.update },
    keeperSelectionSession: { findFirst: m.window },
    keeperRecord: { findMany: m.records },
    redraftRoster: { findMany: m.seasonRosters },
    roster: { findMany: m.rosters },
  },
}))

import { GET, POST } from '@/app/api/leagues/[leagueId]/draft/keepers/auto-place/route'
import { autoPlaceKeepersIfEnabled } from '@/lib/keeper/keeperAutoBoard'

const ctx = { params: Promise.resolve({ leagueId: 'L' }) }
const post = () => POST(new NextRequest('http://x/api/leagues/L/draft/keepers/auto-place', { method: 'POST' }), ctx)

const league = (settings: Record<string, unknown> = {}) => ({
  id: 'L', userId: 'commish', settings, keeperCostSystem: 'round_based', keeperRoundPenalty: 1, keeperInflationRate: 1, keeperConflictRule: 'player_chooses', keeperCount: 2,
})
const slotOrder = [{ slot: 1, rosterId: 'A', displayName: 'Alpha' }, { slot: 2, rosterId: 'B', displayName: 'Bravo' }]

beforeEach(() => {
  vi.clearAllMocks()
  m.commish.mockResolvedValue(undefined)
  m.league.mockResolvedValue(league({ keeper_auto_place_board: true }))
  m.draft.mockResolvedValue({
    id: 'D', status: 'pre_draft', draftType: 'snake', rounds: 6, version: 3, slotOrder,
    tradedPicks: [{ round: 4, originalRosterId: 'A', previousOwnerName: 'Alpha', newRosterId: 'B', newOwnerName: 'Bravo' }],
    keeperSelections: [], keeperConfig: { maxKeepers: 2 },
  })
  m.window.mockResolvedValue({ seasonId: 'S2' })
  m.records.mockResolvedValue([
    { rosterId: 'r1', playerId: 'p1', playerName: 'Ace', position: 'RB', team: 'KC', costRound: 4 },
    { rosterId: 'r2', playerId: 'p2', playerName: 'Bo', position: 'WR', team: 'SF', costRound: 2 },
  ])
  m.seasonRosters.mockResolvedValue([{ id: 'r1', ownerId: 'u1' }, { id: 'r2', ownerId: 'u2' }])
  m.rosters.mockResolvedValue([])
  m.update.mockResolvedValue({ count: 1 })
})

describe('automatic keeper placement — gate', () => {
  it('free / AF Pro commissioner: 403 in the shared paywall shape, the board is untouched', async () => {
    m.evaluate.mockResolvedValue({ allowed: false })
    const res = await post()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'feature_not_entitled', requiredPlan: 'AF Commissioner', featureId: 'commissioner_automation' })
    expect(m.update).not.toHaveBeenCalled()
  })

  it('not the commissioner: 403 before anything is read', async () => {
    m.commish.mockRejectedValue(new Error('no'))
    expect((await post()).status).toBe(403)
    expect(m.league).not.toHaveBeenCalled()
  })

  it('GET reports the switch and the lock for the upgrade card', async () => {
    m.evaluate.mockResolvedValue({ allowed: false })
    const body = await (await GET(new NextRequest('http://x'), ctx)).json()
    expect(body).toMatchObject({ enabled: true, entitled: false, locked: { code: 'feature_not_entitled' } })
  })
})

describe('automatic keeper placement — AF Commissioner / Supreme', () => {
  beforeEach(() => m.evaluate.mockResolvedValue({ allowed: true }))

  it('places every locked keeper on his team’s pick, moving one whose pick was traded', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.summary).toMatchObject({ placed: 2, moved: 1, flagged: [] })
    const data = m.update.mock.calls[0][0]
    expect(data.where).toEqual({ id: 'D', version: 3, status: 'pre_draft' })
    expect(data.data.keeperSelections).toEqual([
      expect.objectContaining({ rosterId: 'B', playerName: 'Bo', roundCost: 2, autoPlaced: true }),
      expect.objectContaining({ rosterId: 'A', playerName: 'Ace', roundCost: 3, placementNote: 'Round 3 (moved from Round 4: Round 4 pick was traded)' }),
    ])
    expect(data.data.keeperConfig.autoPlacement).toMatchObject({ placed: 2, moved: 1 })
  })

  it('a keeper the commissioner placed by hand stays, and his round is not reused', async () => {
    m.draft.mockResolvedValue({
      id: 'D', status: 'pre_draft', draftType: 'snake', rounds: 6, version: 3, slotOrder, tradedPicks: [],
      keeperSelections: [{ rosterId: 'A', roundCost: 4, playerName: 'Manual Guy', position: 'QB', team: null, playerId: null, commissionerOverride: true }],
      keeperConfig: { maxKeepers: 2 },
    })
    await post()
    const sel = m.update.mock.calls[0][0].data.keeperSelections
    expect(sel).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerName: 'Manual Guy', roundCost: 4 }),
      expect.objectContaining({ playerName: 'Ace', roundCost: 3 }),
    ]))
  })

  it('no team match → flagged for the commissioner, never dropped', async () => {
    m.seasonRosters.mockResolvedValue([{ id: 'r1', ownerId: 'nobody' }, { id: 'r2', ownerId: 'u2' }])
    const body = await (await post()).json()
    expect(body.summary.flagged).toEqual([expect.objectContaining({ playerName: 'Ace' })])
  })

  it('the automatic hook does nothing while the switch is off', async () => {
    m.league.mockResolvedValue(league({}))
    expect(await autoPlaceKeepersIfEnabled('L')).toMatchObject({ ok: false, code: 'NOT_ENABLED' })
    expect(m.update).not.toHaveBeenCalled()
  })

  it('the automatic hook stops when the commissioner’s plan lapsed, even with the switch on', async () => {
    m.evaluate.mockResolvedValue({ allowed: false })
    expect(await autoPlaceKeepersIfEnabled('L')).toMatchObject({ ok: false, code: 'NOT_ENTITLED' })
    expect(m.update).not.toHaveBeenCalled()
  })

  it('no board once the draft has started', async () => {
    m.draft.mockResolvedValue({ id: 'D', status: 'in_progress', draftType: 'snake', rounds: 6, version: 1, slotOrder })
    expect((await post()).status).toBe(409)
  })
})
