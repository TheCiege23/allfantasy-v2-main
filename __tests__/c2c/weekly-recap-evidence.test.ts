import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ league: vi.fn(), season: vi.fn(), games: vi.fn(), ai: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: m.league }, redraftSeason: { findUnique: m.season }, redraftMatchup: { findMany: m.games } } }))
vi.mock('@/lib/redraft/ai/requireAfSub', () => ({ requireAfSubUserIdOrThrow: vi.fn(async () => 'user') }))
vi.mock('@/lib/openai-client', () => ({ openaiChatJson: vi.fn(), openaiChatText: m.ai, parseJsonContentFromChatCompletion: vi.fn() }))
import { generateWeeklyC2CRecap } from '@/lib/c2c/ai/c2cChimmy'

beforeEach(() => {
  vi.clearAllMocks()
  m.league.mockResolvedValue({ season: 2026 })
  m.season.mockResolvedValue({ id: 'season' })
  m.games.mockResolvedValue([{ status: 'final', homeScore: 125.5, awayScore: 98.25, homeRoster: { teamName: 'North', ownerName: 'A' }, awayRoster: { teamName: 'South', ownerName: 'B' } }])
})

describe('C2C weekly recap evidence', () => {
  it('reports actual finalized scores without asking a model to invent player facts', async () => {
    const text = await generateWeeklyC2CRecap('league', 3)
    expect(text).toContain('North 125.50 – 98.25 South')
    expect(text).toContain('Player and campus/canton breakdowns are not included')
    expect(m.games).toHaveBeenCalledWith(expect.objectContaining({ where: { seasonId: 'season', week: 3, isMedianMatchup: false } }))
    expect(m.ai).not.toHaveBeenCalled()
  })
  it('does not present partial or unavailable results as a completed recap', async () => {
    m.games.mockResolvedValue([{ status: 'active' }])
    expect(await generateWeeklyC2CRecap('league', 3)).toMatch(/not final/i)
    m.games.mockResolvedValue([])
    expect(await generateWeeklyC2CRecap('league', 3)).toMatch(/not final/i)
  })
  it('reads the current result on each request so corrections are reflected', async () => {
    await generateWeeklyC2CRecap('league', 3)
    m.games.mockResolvedValue([{ status: 'final', homeScore: 130, awayScore: 98.25, homeRoster: { teamName: 'North', ownerName: 'A' }, awayRoster: { teamName: 'South', ownerName: 'B' } }])
    expect(await generateWeeklyC2CRecap('league', 3)).toContain('130.00')
  })
})
