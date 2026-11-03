import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ league: vi.fn(), draft: vi.fn(), update: vi.fn(), run: vi.fn(), preview: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: m.league }, draftSession: { findFirst: m.draft, update: m.update } } }))
vi.mock('@/lib/draft/resolve-draft-context', () => ({ assertLiveDraftContext: vi.fn(async () => ({ leagueId: 'L', draftId: 'D' })) }))
vi.mock('@/lib/draft-lottery/lotteryConfigStorage', () => ({ getDraftOrderModeAndLotteryConfig: vi.fn(async () => ({ lotteryConfig: {} })), setDraftOrderModeAndLotteryConfig: vi.fn() }))
vi.mock('@/lib/draft-lottery/WeightedDraftLotteryEngine', () => ({ runWeightedLottery: m.run, previewLotteryOdds: m.preview }))
import { previewDraftLottery, runDraftLottery } from '@/lib/workers/lottery-engine'

beforeEach(() => { vi.clearAllMocks(); m.league.mockResolvedValue({ isDynasty: true, leagueVariant: null }); m.draft.mockResolvedValue({ draftModeLabel: 'startup', status: 'pre_draft' }) })

describe('worker lottery startup protection', () => {
  it('rejects a startup before drawing or writing order', async () => {
    await expect(runDraftLottery('D', { finalize: true })).rejects.toThrow(/startup/i)
    await expect(previewDraftLottery('D')).rejects.toThrow(/startup/i)
    expect(m.run).not.toHaveBeenCalled()
    expect(m.update).not.toHaveBeenCalled()
  })
  it('preserves non-dynasty lottery previews', async () => {
    m.league.mockResolvedValue({ isDynasty: false, leagueVariant: null })
    m.preview.mockResolvedValue({ eligible: [] })
    expect(await previewDraftLottery('D')).toEqual({ eligible: [] })
  })
})
