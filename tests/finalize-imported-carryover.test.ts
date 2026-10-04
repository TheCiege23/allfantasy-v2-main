import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn(), update: vi.fn() },
  draftSession: { findFirst: vi.fn() },
  redraftSeason: { findFirst: vi.fn(), updateMany: vi.fn() },
  redraftRosterPlayer: { count: vi.fn() },
}))
const finalizeArtifacts = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/live-draft-engine/postDraftFinalizeArtifacts', () => ({ runPostDraftFinalizationArtifacts: finalizeArtifacts }))

import { finalizeImportedCarryover } from '@/lib/league-creation/canonical/finalizeImportedCarryover'

beforeEach(() => {
  vi.clearAllMocks()
  db.league.findUnique.mockResolvedValue({ settings: { importCarryover: { playerCount: 2 } } })
  db.draftSession.findFirst.mockResolvedValue({ id: 'imported-session', status: 'completed', draftModeLabel: 'imported_rosters' })
  db.redraftSeason.findFirst.mockResolvedValue({ id: 'season' })
  finalizeArtifacts.mockResolvedValue(undefined)
})

describe('imported roster materialization recovery', () => {
  it('does not label next-season baseball carryover in season before opening day', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'))
    try {
      db.league.findUnique.mockResolvedValue({ sport: 'MLB', season: 2027, settings: { importCarryover: { playerCount: 2 } } })
      db.redraftRosterPlayer.count.mockResolvedValue(2)
      expect(await finalizeImportedCarryover('baseball')).toMatchObject({ complete: true })
      expect(db.league.update).toHaveBeenCalledWith({ where: { id: 'baseball' }, data: { status: 'active', lifecycleState: 'post_draft' } })
      expect(db.redraftSeason.updateMany).toHaveBeenCalledWith({ where: { id: 'season' }, data: { status: 'setup', currentWeek: 0 } })
    } finally { vi.useRealTimers() }
  })
  it('keeps the league in setup until all imported players are present, then activates it on retry', async () => {
    db.redraftRosterPlayer.count.mockResolvedValueOnce(1).mockResolvedValueOnce(2)

    expect(await finalizeImportedCarryover('native-league')).toMatchObject({ complete: false, expectedPlayers: 2, materializedPlayers: 1 })
    expect(db.league.update).not.toHaveBeenCalled()

    expect(await finalizeImportedCarryover('native-league')).toMatchObject({ complete: true, expectedPlayers: 2, materializedPlayers: 2 })
    expect(db.league.update).toHaveBeenCalledWith({
      where: { id: 'native-league' },
      data: { status: 'active', lifecycleState: 'in_season' },
    })
    expect(finalizeArtifacts).toHaveBeenCalledTimes(2)
  })

  it('rejects leagues without a completed imported roster snapshot', async () => {
    db.draftSession.findFirst.mockResolvedValue(null)
    await expect(finalizeImportedCarryover('native-league')).rejects.toThrow('draft snapshot is missing')
    expect(finalizeArtifacts).not.toHaveBeenCalled()
  })
})
