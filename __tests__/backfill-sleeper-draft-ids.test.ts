import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The distinction this has to hold: a league with NO DRAFT YET upstream is not a failure.
 * Sleeper returns a league object with `draft_id: null` before a draft is created, and
 * treating that as an error would bury the real failures (a 500, a deleted league) in
 * noise from every pre-draft league in the account.
 */
const findManySessions = vi.fn()
const updateSession = vi.fn()
const countSessions = vi.fn()
const countLeagues = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: {
      findMany: (...a: unknown[]) => findManySessions(...a),
      update: (...a: unknown[]) => updateSession(...a),
      count: (...a: unknown[]) => countSessions(...a),
    },
    league: { count: (...a: unknown[]) => countLeagues(...a) },
  },
}))

import { backfillSleeperDraftIds } from '@/lib/sleeper/sync/backfillSleeperDraftIds'

const session = (id: string, platformLeagueId: string | null) => ({
  id, leagueId: `lg-${id}`, league: { platformLeagueId },
})

beforeEach(() => {
  findManySessions.mockReset(); updateSession.mockReset()
  countSessions.mockReset(); countLeagues.mockReset()
  countLeagues.mockResolvedValue(55)
  countSessions.mockResolvedValue(7)
})

describe('draft id backfill', () => {
  it('writes the id when Sleeper returns one', async () => {
    findManySessions.mockResolvedValue([session('s1', '123456')])
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ draft_id: '998877' }) })) as never
    const r = await backfillSleeperDraftIds()
    expect(r.resolved).toBe(1)
    expect(updateSession).toHaveBeenCalledWith({ where: { id: 's1' }, data: { sleeperDraftId: '998877' } })
  })

  it('treats "no draft created yet" as a normal outcome, not a failure', async () => {
    findManySessions.mockResolvedValue([session('s1', '123456')])
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ draft_id: null }) })) as never
    const r = await backfillSleeperDraftIds()
    expect(r.noDraftUpstream).toBe(1)
    expect(r.failed).toBe(0)
    expect(updateSession).not.toHaveBeenCalled()
  })

  it('counts a real upstream error as a failure, with its reason', async () => {
    findManySessions.mockResolvedValue([session('s1', '123456')])
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 })) as never
    const r = await backfillSleeperDraftIds()
    expect(r.failed).toBe(1)
    expect(r.failures[0].reason).toContain('503')
    expect(updateSession).not.toHaveBeenCalled()
  })

  it('one league failing does not stop the rest', async () => {
    findManySessions.mockResolvedValue([session('bad', '111'), session('good', '222')])
    globalThis.fetch = vi.fn(async (url: unknown) =>
      String(url).includes('111')
        ? { ok: false, status: 500 }
        : { ok: true, json: async () => ({ draft_id: 'D2' }) },
    ) as never
    const r = await backfillSleeperDraftIds()
    expect(r.failed).toBe(1)
    expect(r.resolved).toBe(1)
  })

  it('skips a session whose league has a blank platform id rather than calling Sleeper', async () => {
    // platformLeagueId is non-nullable in the schema; blank is the only degenerate value.
    findManySessions.mockResolvedValue([session('s1', '   ')])
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as never
    const r = await backfillSleeperDraftIds()
    expect(r.failed).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reports leagues that have no session at all — it cannot fix those', async () => {
    findManySessions.mockResolvedValue([])
    countLeagues.mockResolvedValue(55)
    countSessions.mockResolvedValue(7)
    const r = await backfillSleeperDraftIds()
    expect(r.leaguesWithoutSession).toBe(48)
  })

  it('only looks at sessions that are missing an id, on Sleeper leagues', async () => {
    findManySessions.mockResolvedValue([])
    await backfillSleeperDraftIds()
    const where = findManySessions.mock.calls[0][0].where
    expect(where.sleeperDraftId).toBeNull()
    expect(where.league.platform).toBe('sleeper')
  })

  it('clamps the batch rather than trusting the caller', async () => {
    findManySessions.mockResolvedValue([])
    await backfillSleeperDraftIds({ maxLeagues: 99999 })
    expect(findManySessions.mock.calls[0][0].take).toBe(500)
  })

  it('trims a padded id and ignores an empty one', async () => {
    findManySessions.mockResolvedValue([session('s1', '1'), session('s2', '2')])
    globalThis.fetch = vi.fn(async (url: unknown) =>
      String(url).endsWith('/1')
        ? { ok: true, json: async () => ({ draft_id: '  777  ' }) }
        : { ok: true, json: async () => ({ draft_id: '   ' }) },
    ) as never
    const r = await backfillSleeperDraftIds()
    expect(r.resolved).toBe(1)
    expect(r.noDraftUpstream).toBe(1)
    expect(updateSession).toHaveBeenCalledWith({ where: { id: 's1' }, data: { sleeperDraftId: '777' } })
  })

  it('accepts a numeric draft_id — Sleeper is inconsistent about the type', async () => {
    findManySessions.mockResolvedValue([session('s1', '1')])
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ draft_id: 4455 }) })) as never
    const r = await backfillSleeperDraftIds()
    expect(r.resolved).toBe(1)
    expect(updateSession).toHaveBeenCalledWith({ where: { id: 's1' }, data: { sleeperDraftId: '4455' } })
  })
})
