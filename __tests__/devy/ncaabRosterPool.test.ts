import { beforeEach, describe, expect, it, vi } from 'vitest'
import { currentNcaabRosterEvidence, materializeNcaabRosterPool } from '@/lib/devy/ncaabRosterPool'
const now = new Date('2026-10-30T12:00:00Z')
const row = (teamId: string, id = '123') => ({ cacheKey: `espn:ncaab:roster:2027:${teamId}`, expiresAt: new Date('2026-12-01T00:00:00Z'), data: { seasonYear: 2027, teamId, school: `School ${teamId}`, observedAt: now.toISOString(), athletes: [{ id, fullName: 'A Player', position: 'G', jersey: '4' }] } })
const db = { sportsDataCache: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() }, devyPlayer: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() } }
const run = () => materializeNcaabRosterPool(db as never, { now, deadlineAt: Date.now() + 10_000 })
beforeEach(() => { vi.clearAllMocks(); db.sportsDataCache.findMany.mockResolvedValue([row('1')]); db.sportsDataCache.findUnique.mockResolvedValue(null); db.sportsDataCache.upsert.mockResolvedValue({}); db.devyPlayer.findMany.mockResolvedValue([]); db.devyPlayer.createMany.mockResolvedValue({ count: 1 }); db.devyPlayer.updateMany.mockResolvedValue({ count: 1 }) })
describe('ESPN college player materialization', () => {
  it('creates a current player with a stable provider-scoped ID', async () => {
    expect(await run()).toMatchObject({ candidates: 1, created: 1 })
    expect(db.devyPlayer.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true, data: [expect.objectContaining({ id: 'espn:ncaab:123', sport: 'NCAAB', source: 'espn_ncaab_roster', position: 'G', devyEligible: true })] }))
  })
  it('never writes a player appearing on two fresh schools', async () => {
    db.sportsDataCache.findMany.mockResolvedValue([row('1'), row('2')])
    expect(await run()).toMatchObject({ candidates: 0, ambiguous: 1 })
    expect(db.devyPlayer.createMany).not.toHaveBeenCalled()
  })
  it('skips uniqueness collisions instead of overwriting another person', async () => {
    db.devyPlayer.createMany.mockResolvedValue({ count: 0 })
    expect(await run()).toMatchObject({ created: 0, skipped: 1 })
    expect(db.devyPlayer.updateMany).not.toHaveBeenCalled()
  })
  it('updates only an older matching ESPN record and never changes eligibility', async () => {
    db.devyPlayer.findMany.mockResolvedValue([{ id: 'espn:ncaab:123', sport: 'NCAAB', source: 'espn_ncaab_roster', lastSyncedAt: new Date('2026-10-28T00:00:00Z') }])
    expect(await run()).toMatchObject({ updated: 1 })
    const args = db.devyPlayer.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(args.data).not.toHaveProperty('devyEligible')
    expect(args.data).not.toHaveProperty('graduatedToNFL')
  })
  it('moves the checkpoint past a collision so later candidates are not starved', async () => {
    db.sportsDataCache.findUnique.mockResolvedValue({ data: { create: 'espn:ncaab:123', update: '' } })
    db.sportsDataCache.findMany.mockResolvedValue([row('1', '123'), row('2', '456')])
    db.devyPlayer.createMany.mockResolvedValue({ count: 1 })
    await run()
    const args = db.devyPlayer.createMany.mock.calls[0]![0] as { data: Array<{ id: string }> }
    expect(args.data[0]!.id).toBe('espn:ncaab:456')
    expect(db.sportsDataCache.upsert).toHaveBeenCalled()
  })
  it('does not take over an ID owned by another source', async () => {
    db.devyPlayer.findMany.mockResolvedValue([{ id: 'espn:ncaab:123', sport: 'NCAAB', source: 'other', lastSyncedAt: new Date('2026-10-28T00:00:00Z') }])
    await run()
    expect(db.devyPlayer.createMany).not.toHaveBeenCalled()
    expect(db.devyPlayer.updateMany).not.toHaveBeenCalled()
  })
  it('returns no candidates when the provider evidence is absent', async () => {
    db.sportsDataCache.findMany.mockResolvedValue([])
    expect(await currentNcaabRosterEvidence(db as never, now)).toEqual({ athletes: [], ambiguous: [] })
  })
})
