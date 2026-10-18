// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The elimination and Chimmy's context wait for the last ballot of the read. */
const m = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    league: { findUnique: vi.fn() },
    survivorTribalCouncil: { findFirst: vi.fn(), findMany: vi.fn() },
    survivorAuditEntry: { findFirst: vi.fn() },
    survivorPlayer: { findUnique: vi.fn(), update: vi.fn() },
    roster: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
    leagueTeam: { findMany: vi.fn(async () => []) },
  },
  access: vi.fn(), council: vi.fn(), eliminated: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/guillotine/GuillotineRosterReleaseEngine', () => ({ clearReleasedRosterData: vi.fn() }))
vi.mock('@/lib/waiver-wire/roster-utils', () => ({ getRosterPlayerIds: vi.fn(() => []) }))
vi.mock('@/lib/survivor/playerBoundIdolTransfer', () => ({ movePlayerBoundIdolsInTransaction: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorSitOutEngine', () => ({ maybeTriggerSurvivorTribeShuffleRecommendation: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: vi.fn(async () => ({ configId: 'cfg' })) }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ getActiveEffectsForRoster: vi.fn(async () => []) }))
vi.mock('@/lib/survivor/SurvivorTribeService', () => ({ getTribesWithMembers: vi.fn(async () => []) }))
vi.mock('@/lib/survivor/SurvivorTribalCouncilService', () => ({ getCouncil: m.council }))
vi.mock('@/lib/survivor/SurvivorChallengeEngine', () => ({ getChallengesForWeek: vi.fn(async () => []) }))
vi.mock('@/lib/survivor/SurvivorFinaleEngine', () => ({ getFinaleState: vi.fn(async () => ({ open: false, closed: false, finalists: [], votes: [] })) }))
vi.mock('@/lib/survivor/SurvivorJuryEngine', () => ({ getJuryMembers: vi.fn(async () => []) }))
vi.mock('@/lib/survivor/SurvivorExileEngine', () => ({ getExileLeagueId: vi.fn(async () => null) }))
vi.mock('@/lib/survivor/SurvivorTokenEngine', () => ({ getAllTokenStates: vi.fn(async () => []) }))
vi.mock('@/lib/survivor/SurvivorIdolRegistry', () => ({ getActiveIdolsForRoster: vi.fn(async () => []) }))
vi.mock('@/lib/survivor/SurvivorAuditLog', () => ({ getSurvivorAuditLog: vi.fn(async () => []) }))
vi.mock('@/lib/survivor/SurvivorMergeEngine', () => ({ isMergeTriggered: vi.fn(async () => false) }))
vi.mock('@/lib/survivor/SurvivorReturnEngine', () => ({ canReturnToIsland: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorRosterState', () => ({ getCurrentlyEliminatedRosterIds: m.eliminated }))
vi.mock('@/lib/zombie/rosterTeamMap', () => ({ getRosterTeamMap: vi.fn(async () => new Map()) }))
vi.mock('@/lib/survivor/survivorAccessControl', () => ({ resolveSurvivorAccessContext: m.access }))
vi.mock('@/lib/ai/historicalContextBuilder', () => ({ buildHistoricalContext: vi.fn(async () => null) }))
import { resolveElimination } from '@/lib/survivor/survivorEliminationService'
import { buildSurvivorAIContext } from '@/lib/survivor/ai/SurvivorAIContext'

const ballots = [{ targetName: 'Out Manager', status: 'counts' }, { targetName: 'Other', status: 'counts' }, { targetName: 'Out Manager', status: 'counts' }]
const midRead = () => ({ isRevealed: true, revealStartsAt: new Date(Date.now() - 1000), revealStep: 0, revealSequence: ballots })

beforeEach(() => {
  m.db.survivorPlayer.update.mockClear()
  m.db.roster.findFirst.mockResolvedValue(null)
  m.db.roster.findMany.mockResolvedValue([])
  m.db.leagueTeam.findMany.mockResolvedValue([])
  m.db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(m.db))
  m.access.mockResolvedValue({ isLeagueMember: true, decisions: { canSeePrivateVotes: false } })
  m.eliminated.mockResolvedValue(new Set())
})

describe('elimination waits for the read', () => {
  it('refuses to resolve while ballots are still being read', async () => {
    m.db.survivorTribalCouncil.findFirst.mockResolvedValue({ id: 'c1', status: 'revealed', isTie: false, eliminatedUserId: 'u-out', week: 6, phase: 'pre_merge', ...midRead() })
    m.db.league.findUnique.mockResolvedValue({ settings: {}, platform: 'allfantasy', survivorRevealMode: 'dramatic_sequential' })
    expect(await resolveElimination('l1', 'c1')).toMatchObject({ ok: false, code: 'read_in_progress' })
    expect(m.db.survivorPlayer.update).not.toHaveBeenCalled()
  })
})

describe('Chimmy context waits for the read', () => {
  it('names no voted-out manager while the council read is in progress', async () => {
    m.db.league.findUnique.mockResolvedValue({ sport: 'NFL', survivorRevealMode: 'dramatic_sequential' })
    m.council.mockResolvedValue({ id: 'c1', week: 6, phase: 'pre_merge', attendingTribeId: null, voteDeadlineAt: new Date(), closedAt: new Date(), eliminatedRosterId: 'roster-out', eliminatedName: 'Out Manager', isTie: false, ...midRead() })
    m.db.survivorTribalCouncil.findMany.mockResolvedValue([{ eliminatedRosterId: 'roster-out', week: 6, ...midRead() }])
    const ctx = await buildSurvivorAIContext({ leagueId: 'l1', currentWeek: 6, userId: 'me' })
    expect(ctx?.votedOutHistory).toEqual([])
    expect(ctx?.council?.eliminatedRosterId).toBeNull()
    expect(JSON.stringify(ctx)).not.toContain('roster-out')
  })

  it('names them once the read is complete', async () => {
    m.db.league.findUnique.mockResolvedValue({ sport: 'NFL', survivorRevealMode: 'dramatic_sequential' })
    const done = { isRevealed: true, revealStartsAt: new Date(Date.now() - 60_000), revealStep: 0, revealSequence: ballots }
    m.council.mockResolvedValue({ id: 'c1', week: 6, phase: 'pre_merge', attendingTribeId: null, voteDeadlineAt: new Date(), closedAt: new Date(), eliminatedRosterId: 'roster-out', isTie: false, ...done })
    m.db.survivorTribalCouncil.findMany.mockResolvedValue([{ eliminatedRosterId: 'roster-out', week: 6, ...done }])
    const ctx = await buildSurvivorAIContext({ leagueId: 'l1', currentWeek: 6, userId: 'me' })
    expect(ctx?.votedOutHistory).toEqual([{ rosterId: 'roster-out', week: 6 }])
  })
})
