/**
 * Multi-team (3- and 4-team) native trades, as Chimmy and the commissioner workspace read them.
 *
 * Every reader here used to take proposer + receiver as the whole trade. For a multi-team trade that
 * named two of the teams, hid the offer from the third and fourth, and described one team's half as
 * if the other side were a single team. Each case below is paired with the two-team case it must
 * leave exactly as it was.
 *
 *   - lib/redraft/tradeParticipants.ts           tradeTeamMoves / joinTeamNames / describeTradeTeamMoves
 *   - lib/chimmy-context/providers/LeagueOfficeContextProvider.ts   trades in review
 *   - lib/chimmy/pendingTradeQuestions.ts        suggested questions about a pending offer
 *   - lib/chimmy-trade/pendingTradeDecisionGrounding.ts             pending trades in the prompt
 *   - lib/commissioner-workspace/commissionerFeatureTasks.ts         "trade in review" task
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  role: vi.fn(),
  evaluate: vi.fn(),
  scan: vi.fn(),
  prisma: {
    league: { findUnique: vi.fn() },
    redraftRoster: { findFirst: vi.fn(), findMany: vi.fn() },
    roster: { findFirst: vi.fn() },
    redraftTradeProposal: { findMany: vi.fn() },
    userProfile: { findUnique: vi.fn() },
  },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: m.role }))
vi.mock('@/lib/side-contests/sideContestsService', () => ({ readSideContestsView: vi.fn(async () => null) }))
vi.mock('@/lib/league-log/leagueLogService', () => ({ readLeagueLog: vi.fn(async () => null) }))
vi.mock('@/lib/stat-corrections/statCorrectionService', () => ({ readStatCorrections: vi.fn(async () => ({ latest: null })) }))
vi.mock('@/lib/inactive-manager/inactiveManagerService', () => ({ readInactiveManagerView: vi.fn(async () => ({ native: false, teams: [] })) }))
vi.mock('@/lib/payouts/payoutService', () => ({ readPayoutsView: vi.fn(async () => null), readPayoutOvercommitment: vi.fn(async () => null) }))
vi.mock('@/lib/season-rollover/dynastyRolloverService', () => ({ readDynastyRolloverView: vi.fn(async () => null) }))
vi.mock('@/lib/season-rollover/rolloverService', () => ({ readRolloverDue: vi.fn(async () => null) }))
vi.mock('@/lib/decision-os/trade/evaluateStoredTrade', () => ({ evaluateStoredTrade: m.evaluate }))
vi.mock('@/lib/provider-trades/scanPendingSleeperTrades', () => ({ scanPendingSleeperTrades: m.scan }))

import {
  MULTI_TEAM_GRADE_WITHHELD,
  describeTradeTeamMoves,
  joinTeamNames,
  tradeTeamMoves,
} from '@/lib/redraft/tradeParticipants'
import { LeagueOfficeContextProvider } from '@/lib/chimmy-context/providers/LeagueOfficeContextProvider'
import { pendingTradeQuestions } from '@/lib/chimmy/pendingTradeQuestions'
import { buildPendingTradeDecisionContext } from '@/lib/chimmy-trade/pendingTradeDecisionGrounding'
import { readCommissionerFeatureTasks } from '@/lib/commissioner-workspace/commissionerFeatureTasks'
import type { ChimmyLeagueSnapshot } from '@/lib/chimmy/chimmy-league-snapshot'

const NAMES = [
  { id: 'rA', teamName: 'Aces', ownerName: 'a', ownerId: 'uA' },
  { id: 'rB', teamName: 'Bees', ownerName: 'b', ownerId: 'uB' },
  { id: 'rC', teamName: 'Cats', ownerName: 'c', ownerId: 'uC' },
  { id: 'rD', teamName: 'Dogs', ownerName: 'd', ownerId: 'uD' },
]

/** A → B (Ann), B → C (Bo), C → A (Cy): every team gives one and gets one. */
const THREE_ASSETS = [
  { fromRosterId: 'rA', toRosterId: 'rB', assetType: 'player', playerId: 'p1', playerName: 'Ann', metadata: {} },
  { fromRosterId: 'rB', toRosterId: 'rC', assetType: 'player', playerId: 'p2', playerName: 'Bo', metadata: {} },
  { fromRosterId: 'rC', toRosterId: 'rA', assetType: 'player', playerId: 'p3', playerName: 'Cy', metadata: {} },
]
const TWO_ASSETS = [
  { fromRosterId: 'rA', toRosterId: 'rB', assetType: 'player', playerId: 'p1', playerName: 'Ann', metadata: {} },
  { fromRosterId: 'rB', toRosterId: 'rA', assetType: 'player', playerId: 'p2', playerName: 'Bo', metadata: {} },
]

beforeEach(() => {
  vi.clearAllMocks()
  m.prisma.redraftRoster.findMany.mockImplementation(async (args: { where: { id?: { in: string[] }; ownerId?: string } }) => {
    if (args.where.ownerId) return NAMES.filter((r) => r.ownerId === args.where.ownerId).map((r) => ({ id: r.id }))
    const ids = args.where.id?.in ?? []
    return NAMES.filter((r) => ids.includes(r.id))
  })
})

describe('tradeParticipants: every team and what it gives and gets', () => {
  it('reads each asset’s own direction, for any number of teams', () => {
    const moves = tradeTeamMoves({ proposerRosterId: 'rA', receiverRosterId: 'rB', additionalRosterIds: ['rC'] }, THREE_ASSETS)
    expect(moves.map((x) => [x.rosterId, x.gives.map((a) => a.playerName), x.gets.map((a) => a.playerName)])).toEqual([
      ['rA', ['Ann'], ['Cy']],
      ['rB', ['Bo'], ['Ann']],
      ['rC', ['Cy'], ['Bo']],
    ])
    expect(describeTradeTeamMoves(moves, (id) => id.slice(1), (a) => a.playerName)).toEqual([
      'A gives Ann and gets Cy',
      'B gives Bo and gets Ann',
      'C gives Cy and gets Bo',
    ])
  })

  it('two teams: the proposer’s and the receiver’s halves, in that order', () => {
    const moves = tradeTeamMoves({ proposerRosterId: 'rA', receiverRosterId: 'rB' }, TWO_ASSETS)
    expect(moves.map((x) => x.rosterId)).toEqual(['rA', 'rB'])
    expect(moves[0]!.gives.map((a) => a.playerName)).toEqual(['Ann'])
    expect(moves[0]!.gets.map((a) => a.playerName)).toEqual(['Bo'])
  })

  it('joins names the way two-team copy always read', () => {
    expect(joinTeamNames(['Aces', 'Bees'])).toBe('Aces and Bees')
    expect(joinTeamNames(['Aces', 'Bees', 'Cats'])).toBe('Aces, Bees and Cats')
    expect(joinTeamNames(['Aces'])).toBe('Aces')
    expect(joinTeamNames([])).toBe('')
  })
})

describe('LeagueOfficeContextProvider: trades in review', () => {
  const provider = new LeagueOfficeContextProvider()
  const proposal = (id: string, proposer: string, receiver: string, extra: string[] = []) => ({
    id, status: 'pending', vetoMode: 'commissioner', vetoThreshold: null,
    acceptedAt: new Date('2026-10-24T00:00:00Z'), expiresAt: new Date('2099-10-26T00:00:00Z'),
    proposerRosterId: proposer, receiverRosterId: receiver, additionalRosterIds: extra, votes: [],
  })

  beforeEach(() => {
    m.prisma.league.findUnique.mockResolvedValue({ platform: 'allfantasy', settings: {} })
    m.role.mockResolvedValue('member')
    m.prisma.roster.findFirst.mockResolvedValue(null)
  })

  it('names every team of a multi-team trade, and its third team can see it', async () => {
    m.prisma.redraftRoster.findFirst.mockResolvedValue({ id: 'rC' }) // the viewer is the THIRD team
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([proposal('t3', 'rA', 'rB', ['rC'])])
    const text = (await provider.load({ userId: 'uC', leagueId: 'L' })).data!.summary
    expect(text).toMatch(/Trade between Aces, Bees and Cats: Under commissioner review/)
    expect(m.prisma.redraftTradeProposal.findMany.mock.calls[0]![0].select).toMatchObject({ additionalRosterIds: true })
  })

  it('two teams: worded exactly as before, and a member outside it still does not see it', async () => {
    m.prisma.redraftRoster.findFirst.mockResolvedValue({ id: 'rA' })
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([proposal('t2', 'rA', 'rB'), proposal('t-other', 'rC', 'rD')])
    const text = (await provider.load({ userId: 'uA', leagueId: 'L' })).data!.summary
    expect(text).toMatch(/Trade between Aces and Bees: Under commissioner review/)
    expect(text.match(/Trade between/g)).toHaveLength(1)
  })
})

describe('pendingTradeQuestions: the offers waiting on this user', () => {
  const snapshot = { id: 'L', platform: 'allfantasy', platformLeagueId: 'x', sport: 'NFL' } as ChimmyLeagueSnapshot

  it('finds an offer that waits on the user as a third team, from that team’s side', async () => {
    m.prisma.redraftTradeProposal.findMany
      .mockResolvedValueOnce([]) // nothing as the receiver
      .mockResolvedValueOnce([{ id: 'p3', proposerRosterId: 'rA', receiverRosterId: 'rB', additionalRosterIds: ['rC'], assets: THREE_ASSETS }])
    const out = await pendingTradeQuestions(snapshot, 'uC')
    expect(m.prisma.redraftTradeProposal.findMany.mock.calls[1]![0].where).toEqual({ leagueId: 'L', status: 'pending', additionalRosterIds: { hasSome: ['rC'] } })
    expect(out.offers).toEqual([{ id: 'p3', assetCount: 3, question: 'Should I trade Cy for Bo in this 3-team trade?' }])
  })

  it('the receiver of a multi-team offer is asked about its own half, and told it is multi-team', async () => {
    m.prisma.redraftTradeProposal.findMany.mockResolvedValueOnce([{ id: 'p3', proposerRosterId: 'rA', receiverRosterId: 'rB', additionalRosterIds: ['rC'], assets: THREE_ASSETS }]).mockResolvedValueOnce([])
    const out = await pendingTradeQuestions(snapshot, 'uB')
    expect(out.offers[0]!.question).toBe('Should I trade Bo for Ann in this 3-team trade?')
  })

  it('two teams: the same question as always, and the same offer is never listed twice', async () => {
    const two = { id: 'p2', proposerRosterId: 'rA', receiverRosterId: 'rB', additionalRosterIds: [], assets: TWO_ASSETS }
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([two])
    const out = await pendingTradeQuestions(snapshot, 'uB')
    expect(out.offers).toEqual([{ id: 'p2', assetCount: 2, question: 'Should I trade Bo for Ann?' }])
  })
})

describe('buildPendingTradeDecisionContext: pending trades in Chimmy’s prompt', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 'p3', seasonId: 'S', proposerRosterId: 'rA', receiverRosterId: 'rB', additionalRosterIds: ['rC'], acceptedRosterIds: ['rB'],
    status: 'pending', vetoMode: 'commissioner', expiresAt: null, createdAt: new Date('2026-10-20T00:00:00Z'),
    proposerRoster: { teamName: 'Aces', ownerName: 'a' }, assets: THREE_ASSETS, ...over,
  })

  it('a multi-team offer names every team, the asker’s half, who is left to accept, and is NOT graded', async () => {
    m.prisma.redraftTradeProposal.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([row({})])
    const onGrade = vi.fn()
    const out = (await buildPendingTradeDecisionContext('L', 'uC', { onGrade }))!
    expect(out).toContain('- Proposal p3 from Aces: a 3-team trade between Aces, Bees and Cats. ')
    expect(out).toContain('Aces gives Ann and gets Cy; Bees gives Bo and gets Ann; Cats gives Cy and gets Bo.')
    expect(out).toContain('Your team is Cats: you receive [Bo], you send [Cy].')
    expect(out).toContain('Every team has to accept; still waiting on Cats.')
    expect(out).toContain(`Grade: NOT GRADED — ${MULTI_TEAM_GRADE_WITHHELD} This is a 3-team trade`)
    expect(out).not.toMatch(/you [A-F][+-]? —/)
    expect(m.evaluate).not.toHaveBeenCalled()
    expect(onGrade).not.toHaveBeenCalled()
  })

  it('two teams: still graded through the one engine, worded exactly as before', async () => {
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([row({ id: 'p2', additionalRosterIds: [], acceptedRosterIds: [], proposerRoster: { teamName: 'Rival FC', ownerName: 'r' }, assets: TWO_ASSETS })])
    m.evaluate.mockResolvedValue({ ok: false, refusal: { code: 'not_found', reason: 'gone' } })
    const out = (await buildPendingTradeDecisionContext('L', 'uB'))!
    expect(out).toContain('- Proposal p2 from Rival FC: you receive [Ann], you send [Bo]. Veto mode: commissioner.')
    expect(out).toContain('Grade: NOT AVAILABLE — gone Do not grade it yourself.')
    expect(m.evaluate).toHaveBeenCalledTimes(1)
    expect(out).not.toContain('team trade')
  })
})

describe('readCommissionerFeatureTasks: a trade waiting on the commissioner', () => {
  it('names every team of a multi-team trade', async () => {
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([{ id: 't3', expiresAt: new Date(Date.now() + 5 * 3600_000), proposerRosterId: 'rA', receiverRosterId: 'rB', additionalRosterIds: ['rC', 'rD'] }])
    const tasks = await readCommissionerFeatureTasks('L', new Date())
    expect(tasks.find((t) => t.sourceKey === 'redraft-trade-review:t3:v1')!.description).toMatch(/^Aces, Bees, Cats and Dogs: /)
  })

  it('two teams: "A and B", as before', async () => {
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([{ id: 't2', expiresAt: new Date(Date.now() + 5 * 3600_000), proposerRosterId: 'rA', receiverRosterId: 'rB', additionalRosterIds: [] }])
    const tasks = await readCommissionerFeatureTasks('L', new Date())
    expect(tasks.find((t) => t.sourceKey === 'redraft-trade-review:t2:v1')!.description).toMatch(/^Aces and Bees: /)
  })
})
