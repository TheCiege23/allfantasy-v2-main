import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  context: vi.fn(),
  db: { $transaction: vi.fn(), $queryRaw: vi.fn(), survivorGameState: { findUnique: vi.fn() }, survivorPlayer: { count: vi.fn() },
    survivorIdol: { findFirst: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() }, survivorTribalCouncil: { update: vi.fn(), findUnique: vi.fn() },
    survivorIdolLedgerEntry: { create: vi.fn() }, survivorAuditEntry: { create: vi.fn(), findUnique: vi.fn() }, survivorVote: { findUnique: vi.fn(), count: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/survivor/survivorCouncilService', () => ({ loadCouncilContext: m.context }))
import { getCouncilIdolPreview, idolWindowOpen, playVoteSteal, submitAdditionalIdolVote } from '@/lib/survivor/survivorIdolResolutionService'
import { computeCouncilEligibility } from '@/lib/survivor/survivorBallotEligibility'
import { survivorIdolPlayCutoffText, survivorIdolPlayDeadline } from '@/lib/survivor/survivorIdolExpiry'
import { SURVIVOR_DEFAULT_FOUNDATION_SETTINGS, normalizeSurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'
import { answerSurvivorRules } from '@/lib/survivor/survivorRulesAnswers'

/** Commissioner's idol play cutoff: idols must be in N hours before votes close; votes still run to the close. */
let ctx: any
beforeEach(() => {
  vi.clearAllMocks()
  const scopePlayers = ['owner', 'victim', 'immune'].map(userId => ({ userId, rosterId: `r-${userId}`, displayName: userId, tribeId: 'tribe' }))
  ctx = { council: { id: 'c', week: 4, status: 'voting_open', phase: 'merge', votingOpensAt: new Date(Date.now() - 10000), voteDeadlineAt: new Date(Date.now() + 30 * 60_000), isRevealed: false, idolsPlayed: [] },
    scopePlayers, settings: { ...SURVIVOR_DEFAULT_FOUNDATION_SETTINGS, idolPlayCutoffHours: 0 },
    eligibility: computeCouncilEligibility({ scopePlayers, selfVotesAllowed: false, safeUserIds: ['immune'] }),
    userToRoster: Object.fromEntries(scopePlayers.map(p => [p.userId, p.rosterId])) }
  m.context.mockImplementation(async () => ctx)
  m.db.$transaction.mockImplementation(async (fn: (db: unknown) => unknown) => fn(m.db))
  m.db.survivorGameState.findUnique.mockResolvedValue({ activePlayerCount: 12, immunePlayerId: 'immune', pausedSnapshot: null, phase: 'merge' })
  m.db.survivorIdol.findFirst.mockResolvedValue({ id: 'idol', powerType: 'vote_steal' })
  m.db.survivorIdol.updateMany.mockResolvedValue({ count: 1 })
  m.db.survivorAuditEntry.findUnique.mockResolvedValue(null)
})

describe('idol play cutoff', () => {
  it('is 0 by default and clamps to 0–72 whole hours', () => {
    expect(normalizeSurvivorFoundationSettings({}).idolPlayCutoffHours).toBe(0)
    expect(normalizeSurvivorFoundationSettings({ idolPlayCutoffHours: 6 }).idolPlayCutoffHours).toBe(6)
    expect(normalizeSurvivorFoundationSettings({ idolPlayCutoffHours: 500 }).idolPlayCutoffHours).toBe(72)
    expect(normalizeSurvivorFoundationSettings({ idolPlayCutoffHours: -3 }).idolPlayCutoffHours).toBe(0)
  })

  it('moves the idol deadline earlier by the cutoff, and not at all when there is none', () => {
    const close = new Date('2026-11-01T20:00:00Z')
    expect(survivorIdolPlayDeadline({ voteDeadlineAt: close }, 0)).toEqual(close)
    expect(survivorIdolPlayDeadline({ voteDeadlineAt: close }, 3).toISOString()).toBe('2026-11-01T17:00:00.000Z')
    expect(survivorIdolPlayCutoffText(0)).toBeNull()
    expect(survivorIdolPlayCutoffText(1)).toBe('Idols must be played at least 1 hour before votes close.')
  })

  it('closes the idol window inside the cutoff while voting stays open', () => {
    expect(idolWindowOpen(ctx.council, 'Before votes close')).toBe(true)
    expect(idolWindowOpen(ctx.council, 'Before votes close', new Date(), 1)).toBe(false)
  })

  it('refuses a play inside the cutoff without consuming the idol', async () => {
    ctx.settings.idolPlayCutoffHours = 1
    expect(await playVoteSteal('l', 'owner', 'victim', undefined, 'idol')).toMatchObject({ ok: false, code: 'play_cutoff_passed', error: survivorIdolPlayCutoffText(1) })
    expect(m.db.survivorIdol.updateMany).not.toHaveBeenCalled()
  })

  it('still plays before the cutoff', async () => {
    ctx.council.voteDeadlineAt = new Date(Date.now() + 3 * 3_600_000)
    ctx.settings.idolPlayCutoffHours = 1
    expect(await playVoteSteal('l', 'owner', 'victim', undefined, 'idol')).toMatchObject({ ok: true })
  })

  it('the preview shows the earlier deadline and says why the idol is locked', async () => {
    ctx.settings.idolPlayCutoffHours = 1
    const preview = await getCouncilIdolPreview('l', 'owner', 'idol')
    expect(preview).toMatchObject({ playable: false, reason: survivorIdolPlayCutoffText(1) })
    expect(new Date(preview!.deadline!).getTime()).toBe(ctx.council.voteDeadlineAt.getTime() - 3_600_000)
  })

  it('an Extra Vote ballot still goes in after the cutoff', async () => {
    ctx.settings.idolPlayCutoffHours = 1
    ctx.council.idolsPlayed = [{ idolId: 'idol', powerType: 'vote_steal', playerUserId: 'owner' }]
    expect(await submitAdditionalIdolVote('l', 'owner', 'victim')).toMatchObject({ ok: true })
  })

  it('Chimmy names the cutoff in the idol rules only when one is set', () => {
    const plan = null as never
    expect(answerSurvivorRules('idols', { sport: 'NFL', settings: { ...SURVIVOR_DEFAULT_FOUNDATION_SETTINGS }, plan })).not.toContain('hours before votes close')
    const on = answerSurvivorRules('idols', { sport: 'NFL', settings: { ...SURVIVOR_DEFAULT_FOUNDATION_SETTINGS, idolPlayCutoffHours: 6 }, plan })
    expect(on).toContain('at least 6 hours before votes close')
    expect(on).not.toContain('\n\n')
  })
})
