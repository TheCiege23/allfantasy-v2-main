import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findUnique, findMany, resolveLeagueMembership } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  resolveLeagueMembership: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findUnique, findMany } },
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership }))

import { resolveTradeEvaluatorInternalLeagueId } from '@/lib/trades/resolveTradeEvaluatorInternalLeagueId'

describe('resolveTradeEvaluatorInternalLeagueId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findUnique.mockResolvedValue(null)
    findMany.mockResolvedValue([])
  })

  it('accepts an authorized native league id', async () => {
    findUnique.mockResolvedValue({ id: 'native-1' })
    resolveLeagueMembership.mockResolvedValue({ ok: true })

    await expect(resolveTradeEvaluatorInternalLeagueId(' native-1 ', 'user-1')).resolves.toBe('native-1')
    expect(resolveLeagueMembership).toHaveBeenCalledWith('native-1', 'user-1')
    expect(findMany).not.toHaveBeenCalled()
  })

  it('rejects a direct id when the viewer is not a member', async () => {
    findUnique.mockResolvedValue({ id: 'private-1' })
    resolveLeagueMembership.mockResolvedValue({ ok: false })

    await expect(resolveTradeEvaluatorInternalLeagueId('private-1', 'user-1')).resolves.toBeNull()
    expect(findMany).not.toHaveBeenCalled()
  })

  it('finds a claimed Fantrax league even if a newer duplicate import is inaccessible', async () => {
    findMany.mockResolvedValue([{ id: 'newer' }, { id: 'claimed' }])
    resolveLeagueMembership.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true })

    await expect(resolveTradeEvaluatorInternalLeagueId('fantrax-123', 'user-1')).resolves.toBe('claimed')
    expect(findMany).toHaveBeenCalledWith({
      where: { platformLeagueId: 'fantrax-123' },
      orderBy: { season: 'desc' },
      select: { id: true },
    })
    expect(resolveLeagueMembership).toHaveBeenNthCalledWith(2, 'claimed', 'user-1')
  })

  it('returns null when no imported league candidate is accessible', async () => {
    findMany.mockResolvedValue([{ id: 'espn-1' }])
    resolveLeagueMembership.mockResolvedValue({ ok: false })

    await expect(resolveTradeEvaluatorInternalLeagueId('espn-external', 'user-1')).resolves.toBeNull()
  })
})
