import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const resolveLeagueAccessMock = vi.hoisted(() => vi.fn())
const leagueFindUniqueMock = vi.hoisted(() => vi.fn())
const rosterFindManyMock = vi.hoisted(() => vi.fn())
const teamFindManyMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/league-access', () => ({
  resolveLeagueAccess: resolveLeagueAccessMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: leagueFindUniqueMock },
    roster: { findMany: rosterFindManyMock },
    leagueTeam: { findMany: teamFindManyMock },
  },
}))

/*
 * 🛑 THE TEST THE AUDIT NAMED AS MISSING: an authenticated NON-MEMBER sending an arbitrary
 * league ID through the Anthropic branch.
 *
 * lib/agents/anthropic-pipeline.ts proved no membership anywhere. It ran
 * `prisma.league.findUnique({ where: { id: ctx.leagueId } })` on whatever id the request
 * carried, then loaded every roster, every roster-player payload, FAAB and waiver priority,
 * and every team with owner names, records, ranks and strength/risk notes. An authenticated
 * user holding another league's internal id could route that league's private data into an
 * AI prompt.
 *
 * These assert the GATE, not the answer: the question is whether the query happens at all.
 * Asserting on response text would pass for the wrong reason the day a model declines to
 * repeat what it was given.
 */
describe('anthropic pipeline — league authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leagueFindUniqueMock.mockResolvedValue({ id: 'league-victim', sport: 'NFL', name: 'Private League' })
    rosterFindManyMock.mockResolvedValue([])
    teamFindManyMock.mockResolvedValue([])
  })

  describe('resolveAuthorizedLeagueId', () => {
    it('returns null for a non-member, so no id reaches a query', async () => {
      resolveLeagueAccessMock.mockResolvedValue(null)
      const { resolveAuthorizedLeagueId } = await import('@/lib/agents/anthropic-pipeline')
      await expect(
        resolveAuthorizedLeagueId({ userId: 'attacker', leagueId: 'league-victim' } as never),
      ).resolves.toBeNull()
      expect(resolveLeagueAccessMock).toHaveBeenCalledWith('league-victim', 'attacker')
    })

    /* The control: a genuine member must still get their league, or the fix broke the feature. */
    it('returns the id for a member', async () => {
      resolveLeagueAccessMock.mockResolvedValue({ leagueId: 'league-mine', leagueSport: 'NFL' })
      const { resolveAuthorizedLeagueId } = await import('@/lib/agents/anthropic-pipeline')
      await expect(
        resolveAuthorizedLeagueId({ userId: 'owner', leagueId: 'league-mine' } as never),
      ).resolves.toBe('league-mine')
    })

    /*
     * ⚠ FAIL CLOSED. A thrown predicate means "not proven", never "allow". A database blip
     * must not widen access — this is the direction the bug would reappear in.
     */
    it('denies when the membership check itself throws', async () => {
      resolveLeagueAccessMock.mockRejectedValue(new Error('db unreachable'))
      const { resolveAuthorizedLeagueId } = await import('@/lib/agents/anthropic-pipeline')
      await expect(
        resolveAuthorizedLeagueId({ userId: 'u', leagueId: 'league-victim' } as never),
      ).resolves.toBeNull()
    })

    it('denies when no league was requested at all', async () => {
      const { resolveAuthorizedLeagueId } = await import('@/lib/agents/anthropic-pipeline')
      await expect(resolveAuthorizedLeagueId({ userId: 'u' } as never)).resolves.toBeNull()
      expect(resolveLeagueAccessMock).not.toHaveBeenCalled()
    })
  })
})
