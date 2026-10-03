import { describe, expect, it, vi } from 'vitest'
import { activateImportedMlbSeasons } from '@/lib/season-week/activateImportedMlbSeasons'

function database(year = 2027, mode = 'imported_rosters') {
  const db = {
    redraftSeason: { findMany: vi.fn().mockResolvedValue([{ id: 'season', leagueId: 'native', season: year, league: { settings: { importCarryover: { sourceSeason: 2026 } } } }]), updateMany: vi.fn() },
    league: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    draftSession: { findFirst: vi.fn().mockResolvedValue({ status: mode === 'imported_rosters' ? 'completed' : 'pre_draft', draftModeLabel: mode }) },
    $transaction: vi.fn(),
  }
  db.$transaction.mockImplementation(async callback => callback(db))
  return db
}

describe('imported MLB season activation', () => {
  it('leaves the next season in setup before the opener', async () => {
    const db = database()
    await activateImportedMlbSeasons(db as never, new Date('2026-10-03T12:00:00Z'), 200)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
  it('activates retained rosters at the known opener', async () => {
    const db = database()
    await activateImportedMlbSeasons(db as never, new Date('2027-03-24T12:00:00Z'), 200)
    expect(db.redraftSeason.updateMany).toHaveBeenCalledWith({ where: { id: 'season', status: 'setup' }, data: { status: 'active', currentWeek: 1 } })
  })
  it('does not interrupt a new annual draft or guess an unknown opener', async () => {
    const drafting = database(2027, 'standard')
    await activateImportedMlbSeasons(drafting as never, new Date('2027-03-24T12:00:00Z'), 200)
    expect(drafting.$transaction).not.toHaveBeenCalled()
    const unknown = database(2030)
    await activateImportedMlbSeasons(unknown as never, new Date('2030-07-01T12:00:00Z'), 200)
    expect(unknown.$transaction).not.toHaveBeenCalled()
  })
})
