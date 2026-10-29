// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ db: {
  $transaction: vi.fn(), $queryRaw: vi.fn(),
  league: { findUnique: vi.fn() },
  survivorGameState: { findUnique: vi.fn(), updateMany: vi.fn() },
  survivorTribalCouncil: { findFirst: vi.fn(), update: vi.fn() },
  survivorVote: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
  survivorAuditEntry: { create: vi.fn(), findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
  survivorNotification: { create: vi.fn() },
  survivorChatChannel: { findFirst: vi.fn() }, survivorChatMessage: { create: vi.fn() },
} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@prisma/client', () => ({ Prisma: { JsonNull: null } }))
import { closeVoteWindow } from '@/lib/survivor/survivorCouncilService'
import { revealCouncil } from '@/lib/survivor/survivorVoteTallyService'
let council: any
const now = new Date('2026-10-15T12:00:00Z')
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now)
  council = { id: 'c', leagueId: 'l', week: 6, phase: 'pre_merge', status: 'voting_open', voteDeadlineAt: new Date(now.getTime() + 3600000), isRevealed: false, revealSequence: [{ targetName: 'B', status: 'counts' }, { targetName: 'C', status: 'counts' }], isTie: false }
  m.db.$transaction.mockImplementation(async fn => fn(m.db))
  m.db.survivorTribalCouncil.findFirst.mockImplementation(async () => council)
  m.db.survivorTribalCouncil.update.mockImplementation(async ({ data }) => Object.assign(council, data))
  m.db.league.findUnique.mockResolvedValue({ settings: { lateVotesAllowed: false } })
  m.db.survivorGameState.findUnique.mockResolvedValue({ pausedSnapshot: null })
  m.db.survivorVote.findMany.mockResolvedValue([{ id: 'late-vote' }])
  m.db.survivorVote.count.mockResolvedValue(1)
  m.db.survivorChatChannel.findFirst.mockResolvedValue({ id: 'chat' })
})
afterEach(() => vi.useRealTimers())

it('closes early at the actual close time, invalidates later ballots and audits atomically once', async () => {
  expect(await closeVoteWindow('l', 'c', 'host')).toMatchObject({ ok: true, status: 'closed', lateVotesFlagged: 1 })
  expect(m.db.$queryRaw).toHaveBeenCalledOnce()
  expect(council).toMatchObject({ closedAt: now, voteDeadlineAt: now, votingDeadline: now })
  expect(m.db.survivorVote.findMany.mock.calls[0][0].where.submittedAt.gt).toEqual(now)
  expect(m.db.survivorVote.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['late-vote'] } }, data: { isLateVote: true, doesNotCount: true } })
  expect(m.db.survivorAuditEntry.create.mock.calls[0][0].data).toMatchObject({ action: 'council_closed', actorUserId: 'host', data: { closedEarly: true } })
  await closeVoteWindow('l', 'c', 'host')
  expect(m.db.survivorAuditEntry.create).toHaveBeenCalledOnce()
})
it('rejects the read before close even if a stale scroll exists', async () => {
  expect(await revealCouncil('l', 'c', 'host')).toMatchObject({ ok: false, status: 409 })
  expect(m.db.survivorTribalCouncil.update).not.toHaveBeenCalled()
  expect(m.db.survivorChatMessage.create).not.toHaveBeenCalled()
})
it('publishes and audits the read once', async () => {
  council.status = 'closed'
  expect(await revealCouncil('l', 'c', 'host')).toMatchObject({ ok: true, alreadyRevealed: false })
  expect(council.isRevealed).toBe(true)
  expect(m.db.survivorChatMessage.create).toHaveBeenCalledOnce()
  // The opener names no ballot: the read is one-at-a-time and has only just started.
  expect(m.db.survivorChatMessage.create.mock.calls[0][0].data.content).not.toMatch(/Ballot|\bB\b|\bC\b|voted off/)
  expect(m.db.survivorNotification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'council_read', recipientRole: 'all', isSpoilerSafe: true, status: 'pending' }) })
  expect(m.db.survivorAuditEntry.create.mock.calls[0][0].data).toMatchObject({ action: 'votes_revealed', actorUserId: 'host' })
  expect(await revealCouncil('l', 'c', 'host')).toMatchObject({ ok: true, alreadyRevealed: true })
  expect(m.db.survivorAuditEntry.create).toHaveBeenCalledOnce()
  expect(m.db.survivorNotification.create).toHaveBeenCalledOnce()
})
it.each(['close', 'read'])('blocks %s while paused', async action => {
  m.db.survivorGameState.findUnique.mockResolvedValue({ pausedSnapshot: { needsTribalLock: true } })
  expect(await (action === 'close' ? closeVoteWindow('l', 'c', 'host') : revealCouncil('l', 'c', 'host'))).toMatchObject({ ok: false, code: 'league_paused' })
  expect(m.db.survivorTribalCouncil.update).not.toHaveBeenCalled()
  expect(m.db.survivorAuditEntry.create).not.toHaveBeenCalled()
})
