import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ league: vi.fn(), draft: vi.fn(), run: vi.fn(), preview: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: m.league }, draftSession: { findFirst: m.draft } } }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'commish' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: vi.fn(async () => true) }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: vi.fn(async () => true) }))
vi.mock('@/lib/tournament/seasonDraftMutationGate', () => ({ isSeasonTournamentDraft: vi.fn(async () => false), SEASON_DRAFT_MUTATION_BLOCKED: 'blocked' }))
vi.mock('@/lib/draft-lottery/lotteryConfigStorage', () => ({ getDraftOrderModeAndLotteryConfig: vi.fn(async () => ({ lotteryConfig: {} })), setDraftOrderModeAndLotteryConfig: vi.fn() }))
vi.mock('@/lib/draft-lottery/WeightedDraftLotteryEngine', () => ({ runWeightedLottery: m.run, previewLotteryOdds: m.preview }))
vi.mock('@/lib/draft/resolve-draft-context', () => ({ assertLiveDraftContext: vi.fn(async () => ({ leagueId: 'L', draftId: 'startup-draft' })) }))
import { POST as run } from '@/app/api/leagues/[leagueId]/draft/lottery/run/route'
import { POST as preview } from '@/app/api/leagues/[leagueId]/draft/lottery/preview/route'
import { runDraftLottery, previewDraftLottery } from '@/lib/workers/lottery-engine'

const ctx = { params: Promise.resolve({ leagueId: 'L' }) }
const request = () => new Request('http://localhost', { method: 'POST', body: JSON.stringify({ finalize: true }) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  m.league.mockResolvedValue({ isDynasty: true, leagueVariant: null })
  m.draft.mockResolvedValue({ draftModeLabel: 'startup', status: 'pre_draft' })
})

describe('legacy draft lottery startup guard', () => {
  it('rejects a dynasty startup draw before drawing or updating its order', async () => {
    const result = await run(request(), ctx)
    expect(result.status).toBe(403)
    expect((await result.json()).error).toMatch(/startup/i)
    expect(m.run).not.toHaveBeenCalled()
  })

  it('rejects preview for the same startup', async () => {
    const result = await preview(request(), ctx)
    expect(result.status).toBe(403)
    expect(m.preview).not.toHaveBeenCalled()
  })

  it('rejects both worker operations for the specified startup session', async () => {
    await expect(runDraftLottery('startup-draft', { finalize: true })).rejects.toThrow(/startup/i)
    await expect(previewDraftLottery('startup-draft')).rejects.toThrow(/startup/i)
    expect(m.draft).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L', id: 'startup-draft' } }))
    expect(m.run).not.toHaveBeenCalled()
    expect(m.preview).not.toHaveBeenCalled()
  })

  it('continues allowing the legacy lottery for non-dynasty formats', async () => {
    m.league.mockResolvedValue({ isDynasty: false, leagueVariant: null })
    m.preview.mockResolvedValue({ eligible: [], playoffTeamCount: 0, message: 'ok' })
    expect((await preview(request(), ctx)).status).toBe(200)
    expect(m.draft).not.toHaveBeenCalled()
  })

  it('allows an established dynasty rookie draft', async () => {
    m.league.mockResolvedValue({ isDynasty: true, leagueVariant: null, sport: 'NFL', season: 2027, createdAt: new Date('2026-08-01'), settings: {}, redraftSeasons: [{ season: 2026 }] })
    m.draft.mockResolvedValue({ draftModeLabel: 'rookie', status: 'pre_draft' })
    m.preview.mockResolvedValue({ eligible: [], playoffTeamCount: 0, message: 'ok' })
    expect((await preview(request(), ctx)).status).toBe(200)
    expect(m.preview).toHaveBeenCalled()
  })
})
