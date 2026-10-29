// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The close-and-lock path (tribal route cron, lock/eliminate actions, automation tick for leagues
 * without a full-season plan) opens the read like the planned path and never names the voted-out
 * manager — in chat, notifications, the elimination or a route response — before the last ballot.
 */
const m = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    league: { findUnique: vi.fn() },
    survivorGameState: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    survivorTribalCouncil: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(async () => []), update: vi.fn(), create: vi.fn() },
    survivorVote: { findMany: vi.fn(async () => []) },
    survivorAuditEntry: { create: vi.fn(), findMany: vi.fn(async () => []), findFirst: vi.fn() },
    survivorNotification: { create: vi.fn() },
    survivorChatChannel: { findFirst: vi.fn() }, survivorChatMessage: { create: vi.fn() },
    survivorPlayer: { findMany: vi.fn(async () => []), findUnique: vi.fn(), update: vi.fn() },
    survivorIdol: { findMany: vi.fn(async () => []) },
    platformNotification: { create: vi.fn() },
  },
  close: vi.fn(), tally: vi.fn(), legacyClose: vi.fn(), session: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@prisma/client', () => ({ Prisma: { JsonNull: null } }))
vi.mock('@/lib/survivor/survivorCouncilService', () => ({ closeVoteWindow: m.close, loadCouncilContext: vi.fn(), openTribalCouncil: vi.fn() }))
vi.mock('@/lib/survivor/survivorShotInTheDark', () => ({ getCouncilShots: vi.fn(async () => []) }))
vi.mock('@/lib/survivor/survivorAutonomousCouncil', () => ({ resolveAutonomousCouncil: vi.fn(async () => null) }))
vi.mock('@/lib/survivor/SurvivorTribalCouncilService', () => ({ createCouncil: vi.fn(), closeCouncil: m.legacyClose }))
vi.mock('@/lib/survivor/SurvivorVoteEngine', () => ({ submitVote: vi.fn(), tallyVotes: vi.fn(), getSeasonPointsFromRosterPerformance: vi.fn() }))
vi.mock('@/lib/survivor/hostEngine', () => ({ postHostMessage: vi.fn(async () => {}) }))
vi.mock('@/lib/survivor/auditEntry', () => ({ logSurvivorAuditEntry: vi.fn(async () => {}) }))
vi.mock('@/lib/survivor/SurvivorCouncilEligibility', () => ({ getEligibleRosterIdsForCouncil: vi.fn(async () => []) }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ getWeeklyEffectState: vi.fn() }))
vi.mock('@/lib/guillotine/GuillotineRosterReleaseEngine', () => ({ clearReleasedRosterData: vi.fn() }))
vi.mock('@/lib/waiver-wire/roster-utils', () => ({ getRosterPlayerIds: vi.fn(() => []) }))
vi.mock('@/lib/survivor/playerBoundIdolTransfer', () => ({ movePlayerBoundIdolsInTransaction: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorSitOutEngine', () => ({ maybeTriggerSurvivorTribeShuffleRecommendation: vi.fn(), applySurvivorSitOutToScoring: vi.fn() }))
// gameStateMachine's unrelated collaborators
vi.mock('@/lib/survivor/tribeEngine', () => ({ assignPlayersToTribes: vi.fn(), executeMerge: vi.fn(), executeTribeSwap: vi.fn() }))
vi.mock('@/lib/survivor/idolEngine', () => ({ seedIdolsAfterDraft: vi.fn(), expireIdolsAtMerge: vi.fn(), playIdol: vi.fn() }))
vi.mock('@/lib/survivor/exileEngine', () => ({ scoreExileWeek: vi.fn() }))
vi.mock('@/lib/survivor/juryEngine', () => ({ openFinale: vi.fn(), openJuryPhase: vi.fn() }))
vi.mock('@/lib/survivor/immunityEngine', () => ({ clearWeeklyImmunity: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: vi.fn() }))
vi.mock('@/lib/survivor/notificationEngine', () => ({ scheduleTribalReminders: vi.fn() }))
vi.mock('@/lib/survivor/survivorRedraftStreamHub', () => ({ publishSurvivorRedraftEvent: vi.fn() }))
vi.mock('@/lib/redraft/scoringEngine', () => ({ scoreRosterForWeek: vi.fn() }))
vi.mock('@/lib/survivor/survivorFullSeasonPlan', () => ({ readSurvivorFullSeasonPlan: vi.fn(() => null) }))
vi.mock('@/lib/survivor/survivorNbaWeeklyScoring', () => ({ scoreNbaSurvivorAllGamesRoster: vi.fn(), scoreNbaSurvivorOneGameRoster: vi.fn() }))
vi.mock('@/lib/survivor/survivorMergeCast', () => ({ applySurvivorMergeCast: vi.fn() }))
// tribal route collaborators
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => false }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueCommissioner: vi.fn(async () => ({ ok: true })), assertLeagueMember: vi.fn() }))
vi.mock('@/lib/survivor/survivorHostGuard', () => ({ survivorHostGuard: vi.fn(async () => null) }))
vi.mock('@/lib/survivor/survivorPrivateVoteCommand', () => ({ submitPrivateVoteCommand: vi.fn() }))
vi.mock('@/lib/survivor/rocksEngine', () => ({ executeRocksDraw: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorChatMembershipService', () => ({ removeRosterFromTribeChat: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorExileEngine', () => ({ enrollInExile: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorJuryEngine', () => ({ enrollJuryMember: vi.fn(), shouldJoinJury: vi.fn() }))
vi.mock('@/lib/survivor/leagueChatPoster', () => ({ postLeagueRevealFollowUp: vi.fn(), postScrollRevealToTribeChat: vi.fn() }))
import { lockVoting } from '@/lib/survivor/votingEngine'
import { processTribalDeadline } from '@/lib/survivor/gameStateMachine'
import { POST } from '@/app/api/survivor/tribal/route'

const ballots = [
  { order: 0, targetUserId: 'u-out', targetName: 'Out Manager', status: 'counts', isExtraVote: false },
  { order: 1, targetUserId: 'u-other', targetName: 'Other Manager', status: 'counts', isExtraVote: false },
  { order: 2, targetUserId: 'u-out', targetName: 'Out Manager', status: 'counts', isExtraVote: false },
]
let council: Record<string, unknown>
let verdictPosted: boolean
const published = () => JSON.stringify([
  m.db.survivorChatMessage.create.mock.calls, m.db.survivorNotification.create.mock.calls, m.db.platformNotification.create.mock.calls,
  m.db.survivorAuditEntry.create.mock.calls.filter(([c]) => c.data.isVisibleToPublic),
])

beforeEach(() => {
  vi.clearAllMocks()
  verdictPosted = false
  council = { id: 'c1', leagueId: 'l1', configId: 'cfg', councilNumber: 1, week: 6, phase: 'pre_merge', status: 'voting_open', isRevealed: false, revealStartsAt: null, revealStep: 0,
    revealSequence: null, isTie: false, tiePhase: null, tiePlayerIds: [], eliminatedName: null, eliminatedUserId: null, eliminatedRosterId: null, attendingTribeId: 't1',
    closedAt: null, voteDeadlineAt: new Date(Date.now() - 60_000), votingDeadline: new Date(Date.now() - 60_000) }
  m.db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(m.db))
  m.db.survivorTribalCouncil.findFirst.mockImplementation(async () => council)
  m.db.survivorTribalCouncil.findUnique.mockImplementation(async () => council)
  m.db.survivorTribalCouncil.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => Object.assign(council, data))
  m.db.survivorGameState.findUnique.mockResolvedValue({ leagueId: 'l1', activeCouncilId: 'c1', pausedSnapshot: null })
  m.db.survivorChatChannel.findFirst.mockResolvedValue({ id: 'chat' })
  m.db.league.findUnique.mockResolvedValue({ survivorRevealMode: 'dramatic_sequential', settings: {}, platform: 'allfantasy' })
  m.db.survivorAuditEntry.findFirst.mockImplementation(async () => verdictPosted ? { id: 'marker' } : null)
  m.db.survivorAuditEntry.create.mockImplementation(async ({ data }: { data: { action: string } }) => { if (data.action === 'council_verdict_published') verdictPosted = true })
  m.close.mockImplementation(async () => { Object.assign(council, { status: 'closed', closedAt: new Date() }); return { ok: true, councilId: 'c1', status: 'closed', lateVotesFlagged: 0 } })
  m.tally.mockReset()
  m.session.mockResolvedValue({ user: { id: 'host' } })
})
// tallyCouncil is the real canonical one but needs council context; emulate its persisted result.
vi.mock('@/lib/survivor/survivorVoteTallyService', async original => {
  const real = await original<typeof import('@/lib/survivor/survivorVoteTallyService')>()
  return { ...real, tallyCouncil: vi.fn(async () => {
    Object.assign(council, { revealSequence: ballots, eliminatedName: 'Out Manager', eliminatedUserId: 'u-out', eliminatedRosterId: 'roster-out' })
    return { ok: true, status: 'closed', tally: {} }
  }) }
})

describe('close-and-lock opens the read; the verdict waits for the last ballot', () => {
  it('lockVoting closes, tallies and opens the read without naming anyone or eliminating', async () => {
    expect(await lockVoting('c1')).toEqual({ ok: true, readOpened: true, complete: false })
    expect(m.close).toHaveBeenCalledWith('l1', 'c1')
    expect(council).toMatchObject({ isRevealed: true, revealSequence: ballots })
    expect(council.revealStartsAt).toBeInstanceOf(Date)
    expect(m.legacyClose).not.toHaveBeenCalled()
    expect(m.db.survivorPlayer.update).not.toHaveBeenCalled()
    expect(published()).not.toMatch(/Out Manager|Other Manager|Ballot|voted (off|out)/)
  })

  it('the no-plan automation tick opens the read, then a later tick finishes it once the read is complete', async () => {
    await processTribalDeadline('l1')
    expect(council.isRevealed).toBe(true)
    expect(published()).not.toMatch(/Out Manager|voted (off|out)/)
    // Still mid-read on the next tick: nothing more.
    await processTribalDeadline('l1')
    expect(published()).not.toMatch(/Out Manager|voted (off|out)/)
    // The read has finished (all three steps out).
    council.revealStartsAt = new Date(Date.now() - 60_000)
    await processTribalDeadline('l1')
    expect(m.db.survivorChatMessage.create.mock.calls.at(-1)?.[0].data.content).toContain('Out Manager has been voted off the main island.')
  })

  it('the eliminate action does not return the eliminated roster mid-read', async () => {
    const res = await POST(new NextRequest('http://localhost/api/survivor/tribal', { method: 'POST', body: JSON.stringify({ leagueId: 'l1', action: 'eliminate', councilId: 'c1' }) }))
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, eliminatedRosterId: null, readInProgress: true })
    expect(JSON.stringify(body)).not.toContain('roster-out')
    expect(m.db.survivorPlayer.update).not.toHaveBeenCalled()
    // Asking again mid-read (already closed) still names nobody.
    const again = await (await POST(new NextRequest('http://localhost/api/survivor/tribal', { method: 'POST', body: JSON.stringify({ leagueId: 'l1', action: 'eliminate', councilId: 'c1' }) }))).json()
    expect(JSON.stringify(again)).not.toContain('roster-out')
  })

  it('the lock action reports a read in progress and publishes no verdict', async () => {
    const res = await POST(new NextRequest('http://localhost/api/survivor/tribal', { method: 'POST', body: JSON.stringify({ leagueId: 'l1', action: 'lock', councilId: 'c1' }) }))
    expect(await res.json()).toEqual({ ok: true, readInProgress: true })
    expect(published()).not.toMatch(/Out Manager|voted (off|out)/)
    expect(m.legacyClose).not.toHaveBeenCalled()
  })
})
