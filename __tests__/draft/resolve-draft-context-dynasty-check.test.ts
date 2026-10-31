/**
 * The draft context's `isDynasty` uses the shared isDynastyLeague check (lib/league/isDynastyLeague.ts).
 *
 * Before, it read only `League.isDynasty`, so a league stored as `leagueType: 'dynasty'` (or a
 * `DYNASTY_IDP` variant) with `isDynasty: false` drafted as a redraft league while every other
 * dynasty surface treated it as dynasty.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const draftSessionFindUnique = vi.fn()
const leagueFindUnique = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findUnique: (...a: unknown[]) => draftSessionFindUnique(...a) },
    league: { findUnique: (...a: unknown[]) => leagueFindUnique(...a) },
  },
}))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: vi.fn(async () => false) }))
vi.mock('@/lib/draft-lottery/lotteryConfigStorage', () => ({
  getDraftOrderModeAndLotteryConfig: vi.fn(async () => ({ draftOrderMode: 'manual', lotteryLastResult: null })),
}))
vi.mock('@/lib/draft-lottery/dynastyYearGuard', () => ({
  checkDynastyLotteryEligibility: vi.fn(async () => ({ eligible: true })),
}))

import { resolveLiveDraftContextByDraftId } from '@/lib/draft/resolve-draft-context'

function session(league: Record<string, unknown>) {
  return {
    id: 'd1',
    leagueId: 'L1',
    status: 'pre_draft',
    draftType: 'snake',
    sportType: 'NFL',
    league: { id: 'L1', name: 'Test', sport: 'NFL', ...league },
  }
}

describe('resolveLiveDraftContextByDraftId — dynasty check', () => {
  beforeEach(() => {
    draftSessionFindUnique.mockReset()
    leagueFindUnique.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('reads leagueType from the league (the select asks for it)', async () => {
    draftSessionFindUnique.mockResolvedValue(session({ isDynasty: true, leagueType: 'dynasty', leagueVariant: null }))
    await resolveLiveDraftContextByDraftId('d1')
    const select = draftSessionFindUnique.mock.calls[0][0].include.league.select
    expect(select).toMatchObject({ isDynasty: true, leagueType: true, leagueVariant: true })
  })

  it.each([
    ['leagueType dynasty', { isDynasty: false, leagueType: 'dynasty', leagueVariant: null }],
    ['leagueType devy', { isDynasty: false, leagueType: 'devy', leagueVariant: null }],
    ['variant DYNASTY_IDP (upper case, as stored)', { isDynasty: false, leagueType: 'redraft', leagueVariant: 'DYNASTY_IDP' }],
    ['isDynasty flag', { isDynasty: true, leagueType: 'redraft', leagueVariant: null }],
  ])('%s → dynasty', async (_label, league) => {
    draftSessionFindUnique.mockResolvedValue(session(league))
    const ctx = await resolveLiveDraftContextByDraftId('d1')
    expect(ctx?.isDynasty).toBe(true)
  })

  it('a plain redraft league stays redraft', async () => {
    draftSessionFindUnique.mockResolvedValue(session({ isDynasty: false, leagueType: 'redraft', leagueVariant: null }))
    const ctx = await resolveLiveDraftContextByDraftId('d1')
    expect(ctx?.isDynasty).toBe(false)
  })

  it('the fallback lookup (null join) also selects leagueType and uses the shared check', async () => {
    draftSessionFindUnique.mockResolvedValue({ ...session({}), league: null })
    leagueFindUnique.mockResolvedValue({ id: 'L1', name: 'Test', sport: 'NFL', isDynasty: false, leagueType: 'c2c', leagueVariant: null })
    const ctx = await resolveLiveDraftContextByDraftId('d1')
    expect(leagueFindUnique.mock.calls[0][0].select).toMatchObject({ leagueType: true })
    expect(ctx?.isDynasty).toBe(true)
  })
})
