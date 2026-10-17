import { describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn(), update: vi.fn() },
  leagueScoringOverride: { deleteMany: vi.fn(), createMany: vi.fn() },
  leagueRosterConfig: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
import { saveLeagueMlbScoringConfig } from '@/lib/mlb-scoring/MlbScoringConfigService'
import { saveLeagueMlbRosterConfig } from '@/lib/mlb-roster/MlbRosterConfigService'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'

describe('commissioner scoring edits after native MLB conversion', () => {
  it('updates the live roster layout after the commissioner changes imported slots', async () => {
    db.league.findUnique.mockResolvedValue({ settings: { importCarryover: { sourceLeagueId: 'source' }, roster: { config: { sections: [{ slots: { OF: 5, BN: 8 } }] } } } })
    db.leagueRosterConfig.findUnique.mockResolvedValue(null)
    await saveLeagueMlbRosterConfig('native', { templateKey: 'custom', slots: { OF: 3, BN: 4 }, isCustom: true, userId: 'commissioner' })
    const settings = db.league.update.mock.calls.at(-1)![0].data.settings
    const roster = resolveRedraftRosterConfig('MLB', settings)
    expect(roster.starterCapacities.get('OF')).toBe(3)
    expect(roster.benchSlots).toBe(4)
  })
  it('updates the canonical engine and template overrides rather than leaving imported weights frozen', async () => {
    db.league.findUnique.mockResolvedValue({ settings: { importCarryover: { sourceLeagueId: 'source' }, sportConfig: { categoryPoints: { hr: 1 } } } })
    db.$transaction.mockImplementation(async callback => callback(db))
    await saveLeagueMlbScoringConfig('native', { presetKey: 'custom', rules: { home_runs: 4 }, userId: 'commissioner' })
    expect(db.league.update).toHaveBeenCalledWith(expect.objectContaining({ data: { settings: expect.objectContaining({ sportConfig: expect.objectContaining({ categoryPoints: expect.objectContaining({ hr: 4, hld: 0 }) }) }) } }))
    expect(db.leagueScoringOverride.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([expect.objectContaining({ statKey: 'home_run', pointsValue: 4 }), expect.objectContaining({ statKey: 'hold', pointsValue: 0 })]) })
  })
})
