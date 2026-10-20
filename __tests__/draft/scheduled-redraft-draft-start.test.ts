/**
 * Scheduled redraft drafts (NFL / NBA / NHL / MLB) start at the commissioner's draft date and time,
 * through the same `startDraftSession` the commissioner's Start button uses. Before this, only
 * Survivor and Guillotine leagues honoured "Autostart Draft" (`startScheduledSurvivorDrafts`); a
 * redraft league with the toggle on sat in pre_draft until someone pressed Start by hand.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  due: vi.fn(), session: vi.fn(), pool: vi.fn(), prewarm: vi.fn(), start: vi.fn(), lock: vi.fn(),
  notifyStart: vi.fn(), buildOrder: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { leagueSettings: { findMany: m.due }, draftSession: { findFirst: m.session } },
}))
vi.mock('@/lib/draft-notifications', () => ({ notifyDraftStartingSoon: m.notifyStart }))
vi.mock('@/lib/draft-room/ensureDraftPoolReady', () => ({
  getDraftPoolReadiness: m.pool, triggerDraftPoolPrewarmBackground: m.prewarm,
}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  startDraftSession: m.start, buildSlotOrderForLeague: m.buildOrder,
}))
vi.mock('@/lib/draft/draftLock', () => ({ withControlLock: m.lock }))

import { startScheduledRedraftDrafts } from '@/lib/draft/startScheduledRedraftDrafts'

const NOW = new Date('2026-10-20T19:00:00Z')
const order = (n: number) => Array.from({ length: n }, (_, i) => ({ slot: i + 1, rosterId: `r${i + 1}`, displayName: `T${i + 1}` }))
const row = (over: Record<string, unknown> = {}, league: Record<string, unknown> = {}) => ({
  leagueId: 'league-1',
  draftDateUtc: new Date('2026-10-20T18:59:00Z'),
  league: { platform: 'allfantasy', sport: 'NFL', survivorMode: false, guillotineMode: false, leagueVariant: null, ...league },
  ...over,
})
const preDraft = (over: Record<string, unknown> = {}) => ({
  id: 's1', status: 'pre_draft', sessionKind: 'live', sleeperDraftId: null, teamCount: 4, slotOrder: order(4), ...over,
})

describe('scheduled redraft draft start', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    m.due.mockResolvedValue([row()])
    m.session.mockResolvedValue(preDraft())
    m.pool.mockResolvedValue({ ready: true })
    m.start.mockResolvedValue({ ok: true })
    m.buildOrder.mockResolvedValue([])
    m.lock.mockImplementation(async (_leagueId: string, action: () => Promise<unknown>) =>
      ({ acquired: true, value: await action() }))
    m.notifyStart.mockResolvedValue(undefined)
  })

  it('starts a due scheduled redraft draft once, through the manual start path, and notifies the league', async () => {
    expect(await startScheduledRedraftDrafts(NOW)).toMatchObject({ scanned: 1, started: 1, errors: [] })
    expect(m.lock).toHaveBeenCalledWith('league-1', expect.any(Function))
    expect(m.start).toHaveBeenCalledOnce()
    expect(m.start).toHaveBeenCalledWith('league-1')
    expect(m.notifyStart).toHaveBeenCalledWith('league-1')
  })

  it('scans redraft leagues in NFL, NBA, NHL and MLB whose draft time has passed, whatever the Autostart toggle says', async () => {
    await startScheduledRedraftDrafts(NOW)
    const where = m.due.mock.calls[0][0].where
    expect(where).not.toHaveProperty('autostart')
    expect(where.draftDateUtc).toEqual({ lte: NOW, gte: expect.any(Date) })
    expect(where.league.is).toMatchObject({ leagueType: 'redraft', isDynasty: false })
    expect([...where.league.is.sport.in].sort()).toEqual(['MLB', 'NBA', 'NFL', 'NHL'])
  })

  it.each(['NBA', 'NHL', 'MLB'])('starts a %s redraft draft', async (sport) => {
    m.due.mockResolvedValue([row({}, { sport })])
    expect((await startScheduledRedraftDrafts(NOW)).started).toBe(1)
  })

  it('does not start a draft scheduled in the future', async () => {
    m.due.mockResolvedValue([row({ draftDateUtc: new Date('2026-10-20T19:30:00Z') })])
    expect(await startScheduledRedraftDrafts(NOW)).toMatchObject({ started: 0 })
    expect(m.start).not.toHaveBeenCalled()
  })

  it('does not restart a draft that already started, including one started between the scan and the lock', async () => {
    m.session.mockResolvedValue(preDraft({ status: 'in_progress' }))
    expect((await startScheduledRedraftDrafts(NOW)).started).toBe(0)
    // Overlapping tick: the first read sees pre_draft, the re-read under the lock sees it started.
    m.session.mockResolvedValueOnce(preDraft()).mockResolvedValueOnce(preDraft({ status: 'in_progress' }))
    expect((await startScheduledRedraftDrafts(NOW)).started).toBe(0)
    // A start that loses the conditional claim inside startDraftSession is a skip, not an error.
    m.session.mockResolvedValue(preDraft())
    m.start.mockResolvedValueOnce({ ok: false, reason: 'session_not_ready' })
    expect(await startScheduledRedraftDrafts(NOW)).toMatchObject({ started: 0, errors: [] })
    m.lock.mockResolvedValueOnce({ acquired: false, reason: 'busy' })
    expect((await startScheduledRedraftDrafts(NOW)).started).toBe(0)
    expect(m.start).toHaveBeenCalledOnce()
    expect(m.notifyStart).not.toHaveBeenCalled()
  })

  it('skips a league missing required setup and says why', async () => {
    m.session.mockResolvedValue(preDraft({ teamCount: 1, slotOrder: order(1) }))
    expect((await startScheduledRedraftDrafts(NOW)).skips).toEqual([{ leagueId: 'league-1', reason: 'not_enough_teams' }])

    m.session.mockResolvedValue(preDraft({ slotOrder: [] }))
    expect((await startScheduledRedraftDrafts(NOW)).skips).toEqual([{ leagueId: 'league-1', reason: 'no_draft_order' }])

    const withOpenSeat = [...order(3), { slot: 4, rosterId: 'placeholder-4', displayName: 'Team 4' }]
    m.session.mockResolvedValue(preDraft({ slotOrder: withOpenSeat }))
    expect((await startScheduledRedraftDrafts(NOW)).skips).toEqual([{ leagueId: 'league-1', reason: 'not_enough_teams' }])

    m.session.mockResolvedValue(null)
    expect((await startScheduledRedraftDrafts(NOW)).skips).toEqual([{ leagueId: 'league-1', reason: 'no_draft_session' }])

    m.session.mockResolvedValue(preDraft())
    m.start.mockResolvedValueOnce({ ok: false, reason: 'ROSTER_CONFIGURATION_INCOMPLETE' })
    expect(await startScheduledRedraftDrafts(NOW)).toMatchObject({
      started: 0, errors: [], skips: [{ leagueId: 'league-1', reason: 'ROSTER_CONFIGURATION_INCOMPLETE' }],
    })
    expect(m.notifyStart).not.toHaveBeenCalled()
  })

  it('starts when the stored order is missing but the league can build a complete one, as a manual start would', async () => {
    m.session.mockResolvedValue(preDraft({ slotOrder: [] }))
    m.buildOrder.mockResolvedValue(order(4))
    expect((await startScheduledRedraftDrafts(NOW)).started).toBe(1)
  })

  it('leaves provider leagues, mocks and a cold player pool alone', async () => {
    m.due.mockResolvedValueOnce([row({}, { platform: 'sleeper' })])
    expect((await startScheduledRedraftDrafts(NOW)).started).toBe(0)
    m.session.mockResolvedValueOnce(preDraft({ sessionKind: 'mock' }))
    expect((await startScheduledRedraftDrafts(NOW)).started).toBe(0)
    m.pool.mockResolvedValueOnce({ ready: false })
    expect((await startScheduledRedraftDrafts(NOW)).started).toBe(0)
    expect(m.prewarm).toHaveBeenCalledWith('league-1')
    expect(m.start).not.toHaveBeenCalled()
  })

  it('leaves survivor and guillotine leagues to startScheduledSurvivorDrafts', async () => {
    m.due.mockResolvedValue([
      row({ leagueId: 'surv' }, { survivorMode: true }),
      row({ leagueId: 'guil' }, { guillotineMode: true }),
      row({ leagueId: 'guil-variant' }, { leagueVariant: 'guillotine' }),
    ])
    expect(await startScheduledRedraftDrafts(NOW)).toMatchObject({ scanned: 0, started: 0 })
    expect(m.session).not.toHaveBeenCalled()
    expect(m.start).not.toHaveBeenCalled()
  })

  it('reports a failed start as an error without stopping the scan', async () => {
    m.due.mockResolvedValue([row({ leagueId: 'a' }), row({ leagueId: 'b' })])
    m.start.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ ok: true })
    expect(await startScheduledRedraftDrafts(NOW)).toMatchObject({ started: 1, errors: [{ leagueId: 'a', error: 'boom' }] })
  })
})
