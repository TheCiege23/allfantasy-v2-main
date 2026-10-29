/**
 * Phase 6 (2026-10-29): a dynasty league's draft — startup or rookie — starts at its scheduled time
 * when the commissioner turned "Autostart Draft" on. The toggle was saved and nothing read it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  due: vi.fn(), session: vi.fn(), finished: vi.fn(), pool: vi.fn(), prewarm: vi.fn(), start: vi.fn(), lock: vi.fn(),
  notifyStart: vi.fn(), buildOrder: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueSettings: { findMany: m.due },
    draftSession: { findFirst: vi.fn((args: { where: { status?: string } }) => (args.where.status === 'completed' ? m.finished(args) : m.session(args))) },
  },
}))
vi.mock('@/lib/draft-notifications', () => ({ notifyDraftStartingSoon: m.notifyStart }))
vi.mock('@/lib/draft-room/ensureDraftPoolReady', () => ({ getDraftPoolReadiness: m.pool, triggerDraftPoolPrewarmBackground: m.prewarm }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ startDraftSession: m.start, buildSlotOrderForLeague: m.buildOrder }))
vi.mock('@/lib/draft/draftLock', () => ({ withControlLock: m.lock }))

import { startScheduledDynastyDrafts } from '@/lib/draft/startScheduledRedraftDrafts'

const NOW = new Date('2027-05-13T00:01:00Z')
const order = (n: number) => Array.from({ length: n }, (_, i) => ({ slot: i + 1, rosterId: `r${i + 1}`, displayName: `T${i + 1}` }))
const row = (league: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  leagueId: 'dyn-1',
  draftDateUtc: new Date('2027-05-13T00:00:00Z'),
  league: { platform: 'manual', sport: 'NFL', survivorMode: false, guillotineMode: false, leagueVariant: null, ...league },
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  m.due.mockResolvedValue([row()])
  m.session.mockResolvedValue({ status: 'pre_draft', sessionKind: 'live', sleeperDraftId: null, teamCount: 4, slotOrder: order(4) })
  m.finished.mockResolvedValue(null)
  m.pool.mockResolvedValue({ ready: true })
  m.start.mockResolvedValue({ ok: true })
  m.buildOrder.mockResolvedValue([])
  m.lock.mockImplementation(async (_id: string, action: () => Promise<unknown>) => ({ acquired: true, value: await action() }))
  m.notifyStart.mockResolvedValue(undefined)
})

describe('scheduled dynasty draft start', () => {
  it('starts a due dynasty draft whose commissioner turned Autostart on, through the Start-button path', async () => {
    expect(await startScheduledDynastyDrafts(NOW)).toMatchObject({ scanned: 1, started: 1, errors: [] })
    expect(m.start).toHaveBeenCalledWith('dyn-1')
    expect(m.notifyStart).toHaveBeenCalledWith('dyn-1')
    const where = m.due.mock.calls[0][0].where
    expect(where.autostart).toBe(true)
    expect(where.league.is.OR).toEqual(expect.arrayContaining([{ isDynasty: true }]))
  })

  it('leaves imported, Survivor and Guillotine leagues alone', async () => {
    m.due.mockResolvedValue([row({ platform: 'sleeper' }), row({ survivorMode: true }), row({ leagueVariant: 'guillotine' })])
    expect(await startScheduledDynastyDrafts(NOW)).toMatchObject({ scanned: 0, started: 0 })
    expect(m.start).not.toHaveBeenCalled()
  })

  it('ignores a date that belonged to a draft already finished since — last year’s, not this one', async () => {
    m.finished.mockResolvedValue({ id: 'old-draft' })
    expect(await startScheduledDynastyDrafts(NOW)).toMatchObject({ started: 0, skipped: 1 })
    expect(m.start).not.toHaveBeenCalled()
  })

  it('waits, with the reason, while the draft order has empty seats', async () => {
    m.session.mockResolvedValue({ status: 'pre_draft', sessionKind: 'live', sleeperDraftId: null, teamCount: 4, slotOrder: [...order(3), { slot: 4, rosterId: 'placeholder-4' }] })
    expect(await startScheduledDynastyDrafts(NOW)).toMatchObject({ started: 0, skips: [{ leagueId: 'dyn-1', reason: 'not_enough_teams' }] })
  })

  it('never starts a draft scheduled in the future', async () => {
    m.due.mockResolvedValue([row({}, { draftDateUtc: new Date('2027-05-14T00:00:00Z') })])
    expect(await startScheduledDynastyDrafts(NOW)).toMatchObject({ started: 0 })
    expect(m.start).not.toHaveBeenCalled()
  })
})
