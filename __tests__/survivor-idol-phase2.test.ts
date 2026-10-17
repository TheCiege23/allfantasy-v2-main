import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  context: vi.fn(),
  db: { $transaction: vi.fn(), $queryRaw: vi.fn(), survivorGameState: { findUnique: vi.fn() }, survivorPlayer: { count: vi.fn() },
    survivorIdol: { findFirst: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() }, survivorTribalCouncil: { update: vi.fn(), findUnique: vi.fn() },
    survivorIdolLedgerEntry: { create: vi.fn() }, survivorAuditEntry: { create: vi.fn() }, survivorVote: { findUnique: vi.fn(), count: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/survivor/survivorCouncilService', () => ({ loadCouncilContext: m.context }))
import { getCouncilIdolPreview, playVoteSteal, playVoteShield, submitAdditionalIdolVote } from '@/lib/survivor/survivorIdolResolutionService'
import { buildTribalCouncilView } from '@/lib/survivor/survivorTribalView'
import { computeCouncilEligibility } from '@/lib/survivor/survivorBallotEligibility'
import { survivorPublicCouncil } from '@/lib/survivor/survivorPublicCouncil'
let ctx: any
beforeEach(() => {
  vi.clearAllMocks()
  const scopePlayers = ['owner', 'victim', 'immune', 'other'].map(userId => ({ userId, rosterId: `r-${userId}`, displayName: userId, tribeId: userId === 'other' ? 'other-tribe' : 'tribe' }))
  ctx = { council: { id: 'c', week: 4, status: 'voting_open', phase: 'merge', votingOpensAt: new Date(Date.now() - 10000), voteDeadlineAt: new Date(Date.now() + 600000), isRevealed: false, idolsPlayed: [] },
    scopePlayers, settings: { idolInvalidRemainingPlayers: 3, voteChangePolicy: 'first_valid_locks' },
    eligibility: computeCouncilEligibility({ scopePlayers, selfVotesAllowed: false, safeUserIds: ['immune'] }),
    userToRoster: Object.fromEntries(scopePlayers.map(p => [p.userId, p.rosterId])) }
  m.context.mockImplementation(async () => ctx)
  m.db.$transaction.mockImplementation(async fn => fn(m.db))
  m.db.survivorGameState.findUnique.mockResolvedValue({ activePlayerCount: 12, immunePlayerId: 'immune', pausedSnapshot: null })
  m.db.survivorIdol.findFirst.mockResolvedValue({ id: 'idol', powerType: 'vote_steal' })
  m.db.survivorIdol.updateMany.mockResolvedValue({ count: 1 })
  m.db.survivorIdol.findMany.mockResolvedValue([])
  m.db.survivorVote.findUnique.mockResolvedValue({ targetUserId: 'other', targetName: 'other', doesNotCount: false, isLateVote: false })
  m.db.survivorVote.count.mockResolvedValue(2)
})
describe('transactional council idols', () => {
  it.each([
    ['wrong tribe', 'other', 'wrong_tribe'], ['not at council', 'absent', 'invalid_stolen_vote'], ['immune', 'immune', 'invalid_stolen_vote'],
  ])('rejects %s before consuming an idol', async (_, victim, code) => {
    expect(await playVoteSteal('l', 'owner', victim, undefined, 'idol')).toMatchObject({ ok: false, code })
    expect(m.db.survivorIdol.updateMany).not.toHaveBeenCalled()
  })
  it('rejects an already used or unheld idol', async () => {
    m.db.survivorIdol.findFirst.mockResolvedValue(null)
    expect(await playVoteSteal('l', 'owner', 'victim', undefined, 'used')).toMatchObject({ ok: false, code: 'no_playable_idol' })
    expect(m.db.survivorIdol.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'used', currentOwnerUserId: 'owner', isUsed: false, status: 'hidden' })
    expect(m.db.survivorIdol.updateMany).not.toHaveBeenCalled()
  })
  it.each(['deadline', 'scheduled', 'closed', 'revote'])('rejects outside window: %s', async state => {
    if (state === 'deadline') ctx.council.voteDeadlineAt = new Date(Date.now() - 1)
    else if (state === 'revote') ctx.council.phase = 'revote'
    else ctx.council.status = state
    expect(await playVoteSteal('l', 'owner', 'victim')).toMatchObject({ ok: false })
    expect(m.db.survivorIdol.updateMany).not.toHaveBeenCalled()
  })
  it('consumes the selected idol and records a secret effect in the same transaction before either ballot', async () => {
    expect(await playVoteSteal('l', 'owner', 'victim', undefined, 'idol')).toMatchObject({ ok: true })
    expect(m.db.$transaction).toHaveBeenCalledTimes(1)
    expect(m.context).toHaveBeenCalledWith('l', undefined, m.db)
    expect(m.db.survivorIdol.updateMany.mock.calls[0][0].data).toMatchObject({ isUsed: true, usedAtCouncilId: 'c' })
    const record = m.db.survivorTribalCouncil.update.mock.calls[0][0].data.idolsPlayed[0]
    expect(record).toMatchObject({ idolId: 'idol', stolenVoterUserId: 'victim', stolenVoterRosterId: 'r-victim' })
    expect(record.extraTargetUserId).toBeUndefined()
    expect(m.db.survivorAuditEntry.create.mock.calls[0][0].data).toMatchObject({ isVisibleToPublic: false, isVisibleToCommissioner: false })
  })
  it('rejects an idol that reaches its expiry week', async () => {
    m.db.survivorIdol.findFirst.mockResolvedValue({ id: 'idol', expiresAtWeek: 4 })
    expect(await playVoteSteal('l', 'owner', 'victim')).toMatchObject({ ok: false, code: 'idol_expired' })
    expect(m.db.survivorIdol.updateMany).not.toHaveBeenCalled()
  })
  it('reports transaction failure without a success response', async () => {
    m.db.survivorTribalCouncil.update.mockRejectedValueOnce(new Error('private database details'))
    const result = await playVoteSteal('l', 'owner', 'victim')
    expect(result).toMatchObject({ ok: false, status: 409 })
    expect(JSON.stringify(result)).not.toContain('private database details')
  })
  it('casts the extra ballot later and locks it under first-valid policy', async () => {
    ctx.council.idolsPlayed = [{ idolId: 'idol', powerType: 'vote_steal', playerUserId: 'owner' }]
    expect(await submitAdditionalIdolVote('l', 'owner', 'victim')).toMatchObject({ ok: true })
    const plays = m.db.survivorTribalCouncil.update.mock.calls[0][0].data.idolsPlayed
    expect(plays[0]).toMatchObject({ extraTargetUserId: 'victim', extraTargetRosterId: 'r-victim' })
    ctx.council.idolsPlayed = plays
    expect(await submitAdditionalIdolVote('l', 'owner', 'other')).toMatchObject({ ok: false })
    expect(m.db.survivorTribalCouncil.update).toHaveBeenCalledTimes(1)
  })
  it('immunity uses self, requires no target and closes at the deadline', async () => {
    expect(await playVoteShield('l', 'owner', 'immunity')).toMatchObject({ ok: true })
    expect(m.db.survivorTribalCouncil.update.mock.calls[0][0].data.idolsPlayed[0]).toMatchObject({ protectedRosterId: 'r-owner', powerType: 'vote_shield' })
    ctx.council.voteDeadlineAt = new Date(Date.now() - 1)
    expect(await playVoteShield('l', 'owner', 'immunity')).toMatchObject({ ok: false, code: 'window_closed' })
  })
  it('preview keeps immune target visible and disabled without exposing existing plays', async () => {
    ctx.council.idolsPlayed = [{ powerType: 'vote_steal', playerUserId: 'other', stolenVoterUserId: 'victim' }]
    const preview = await getCouncilIdolPreview('l', 'owner', 'idol')
    expect(preview?.targets).toEqual([{ userId: 'victim', name: 'victim', disabled: false, reason: null }, { userId: 'immune', name: 'immune', disabled: true, reason: 'Immune this week' }])
    expect(JSON.stringify(preview)).not.toMatch(/stolenVoter|idolsPlayed|vote_steal/)
  })
})
describe('no pre-read trace in non-owner payloads', () => {
  it.each(['victim', 'other', 'commissioner'])('returns byte-identical council and summary projections to %s before and after play', async userId => {
    const access: any = { leagueId: 'l', userId, settings: { voteChangePolicy: 'first_valid_locks', hideIdolsFromCommissioner: true }, decisions: { canSeeVoteTallyBeforeReveal: userId === 'commissioner' } }
    const before = await buildTribalCouncilView(access)
    const beforePublic = survivorPublicCouncil(ctx.council, false)
    ctx.council.idolsPlayed = [{ idolId: 'secret-idol', powerType: 'vote_steal', playerUserId: 'owner', playerRosterId: 'r-owner', stolenVoterUserId: 'victim', extraTargetUserId: 'other' }]
    expect(await buildTribalCouncilView(access)).toEqual(before)
    expect(survivorPublicCouncil(ctx.council, false)).toEqual(beforePublic)
    expect(JSON.stringify(await buildTribalCouncilView(access))).not.toMatch(/secret-idol|vote_steal|stolenVoter|extraTarget/)
  })
})
