import { describe, expect, it, vi } from 'vitest'
import { getOrCreateLeagueFinance } from '@/lib/league-finance/leagueFinanceService'
describe('finance initialization contention', () => {
  it('uses an atomic upsert when simultaneous callers observe no finance record', async () => {
    const row = { id: 'finance', leagueId: 'L', isPaidLeague: false, entryFeeCents: 0 }
    const db = { leagueFinance: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue(row), create: vi.fn().mockRejectedValue(new Error('duplicate league')) }, league: { findUnique: vi.fn().mockResolvedValue({ id: 'L', settings: {} }) } }
    const results = await Promise.all([getOrCreateLeagueFinance('L', db as never), getOrCreateLeagueFinance('L', db as never)])
    expect(results).toEqual([row, row])
    expect(db.leagueFinance.create).not.toHaveBeenCalled()
    expect(db.leagueFinance.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L' }, update: {} }))
  })
  it('preserves existing paid-league configuration', async () => {
    const row = { id: 'finance', leagueId: 'L', isPaidLeague: true, entryFeeCents: 2500 }
    const db = { leagueFinance: { findUnique: vi.fn().mockResolvedValue(row), upsert: vi.fn() } }
    expect(await getOrCreateLeagueFinance('L', db as never)).toBe(row)
    expect(db.leagueFinance.upsert).not.toHaveBeenCalled()
  })
})
