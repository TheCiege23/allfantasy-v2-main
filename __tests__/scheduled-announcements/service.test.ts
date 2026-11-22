import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The sweep that posts scheduled announcements, against a fake League.settings store. The send
 * (postLeagueAnnouncement) and the permission rule (broadcastRefusal) are the seams.
 */

const m = vi.hoisted(() => ({
  settings: {} as Record<string, Record<string, unknown>>,
  post: vi.fn(),
  refusal: vi.fn(),
  audit: vi.fn(),
  locks: 0,
}))

vi.mock('@/lib/prisma', () => {
  const league = {
    findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (m.settings[where.id] ? { settings: structuredClone(m.settings[where.id]) } : null)),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (m.settings[where.id] ? { settings: structuredClone(m.settings[where.id]) } : null)),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { settings: Record<string, unknown> } }) => {
      m.settings[where.id] = structuredClone(data.settings)
      return {}
    }),
  }
  const prisma: Record<string, unknown> = {
    league,
    leagueAuditLog: { create: m.audit },
    // Two shapes reach $queryRaw: the row lock, and the sweep's "which leagues hold the key".
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      if (sql.includes('FOR UPDATE')) {
        m.locks += 1
        return []
      }
      return Object.entries(m.settings).filter(([, s]) => 'scheduled_announcements' in s).map(([id]) => ({ id }))
    }),
  }
  // Serialised, as the FOR UPDATE row lock serialises real transactions on one league.
  let chain: Promise<unknown> = Promise.resolve()
  prisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => {
    const run = chain.then(() => fn(prisma))
    chain = run.catch(() => undefined)
    return run
  })
  return { prisma }
})
vi.mock('@/lib/commissioner/postLeagueAnnouncement', () => ({ postLeagueAnnouncement: m.post }))
vi.mock('@/lib/commissioner/broadcastAccess', () => ({ broadcastRefusal: m.refusal }))

import {
  cancelScheduledAnnouncement,
  runScheduledAnnouncements,
  scheduleAnnouncement,
} from '@/lib/commissioner/scheduledAnnouncementService'
import { readScheduledAnnouncements } from '@/lib/commissioner/scheduledAnnouncements'

const T0 = new Date('2026-10-20T12:00:00Z')
const plus = (min: number) => new Date(T0.getTime() + min * 60_000)
const list = (id = 'L') => readScheduledAnnouncements(m.settings[id])

beforeEach(() => {
  vi.clearAllMocks()
  m.settings = { L: { other: 'keep' }, Q: { nothing: true } }
  m.locks = 0
  m.post.mockResolvedValue(true)
  m.refusal.mockResolvedValue(null)
  m.audit.mockResolvedValue({})
})

describe('scheduleAnnouncement / cancel', () => {
  it('saves a pending post under the row lock and audits it', async () => {
    const r = await scheduleAnnouncement('L', 'comm', { message: 'Draft Sunday', sendAt: plus(60).toISOString() }, T0)
    expect(r.ok).toBe(true)
    expect(list()).toMatchObject([{ message: 'Draft Sunday', status: 'pending', byUserId: 'comm', sendAt: plus(60).toISOString() }])
    expect(m.settings.L.other).toBe('keep')
    expect(m.locks).toBe(1)
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actionType: 'announcement_scheduled' }) }))
  })

  it('refuses a bad request and writes nothing', async () => {
    const r = await scheduleAnnouncement('L', 'comm', { message: 'x', sendAt: plus(5).toISOString() }, T0)
    expect(r).toEqual({ ok: false, error: 'too_soon' })
    expect(list()).toEqual([])
  })

  it('cancels only while pending', async () => {
    const r = await scheduleAnnouncement('L', 'comm', { message: 'x', sendAt: plus(60).toISOString() }, T0)
    const id = r.ok ? r.announcement.id : ''
    expect(await cancelScheduledAnnouncement('L', 'comm', id, T0)).toBe(true)
    expect(list()[0].status).toBe('cancelled')
    expect(await cancelScheduledAnnouncement('L', 'comm', id, T0)).toBe(false)
    expect(await cancelScheduledAnnouncement('L', 'comm', 'nope', T0)).toBe(false)
  })
})

describe('runScheduledAnnouncements', () => {
  async function schedule(minutes: number, message = 'hello') {
    const r = await scheduleAnnouncement('L', 'comm', { message, sendAt: plus(minutes).toISOString() }, T0)
    if (!r.ok) throw new Error(r.error)
    return r.announcement.id
  }

  it('posts a due announcement as the person who scheduled it, once', async () => {
    await schedule(20, 'due one')
    await schedule(120, 'later one')
    const first = await runScheduledAnnouncements({ now: plus(25) })
    expect(first).toMatchObject({ sent: 1, failed: 0, refused: 0, leagues: 1 })
    expect(m.post).toHaveBeenCalledTimes(1)
    expect(m.post).toHaveBeenCalledWith('L', 'comm', 'due one')
    expect(list().map((a) => [a.message, a.status])).toEqual([['due one', 'sent'], ['later one', 'pending']])

    // A second sweep (or the other replica) does not post it again.
    const second = await runScheduledAnnouncements({ now: plus(40) })
    expect(second.sent).toBe(0)
    expect(m.post).toHaveBeenCalledTimes(1)
  })

  it('two sweeps at once (two worker replicas) post a due announcement exactly once', async () => {
    await schedule(20)
    m.post.mockImplementation(() => new Promise((r) => setTimeout(() => r(true), 20)))
    const [x, y] = await Promise.all([runScheduledAnnouncements({ now: plus(25) }), runScheduledAnnouncements({ now: plus(25) })])
    expect(x.sent + y.sent).toBe(1)
    expect(m.post).toHaveBeenCalledTimes(1)
  })

  it('re-checks permission at post time: a schedule from someone who lost the role does not post', async () => {
    await schedule(20)
    m.refusal.mockResolvedValue('forbidden')
    const r = await runScheduledAnnouncements({ now: plus(25) })
    expect(r.refused).toBe(1)
    expect(m.post).not.toHaveBeenCalled()
    expect(list()[0]).toMatchObject({ status: 'failed', reason: expect.stringContaining('can no longer send') })
  })

  it('a post chat refuses is marked failed with a reason', async () => {
    await schedule(20)
    m.post.mockResolvedValue(false)
    const r = await runScheduledAnnouncements({ now: plus(25) })
    expect(r.failed).toBe(1)
    expect(list()[0]).toMatchObject({ status: 'failed', reason: 'League chat did not accept the post' })
  })

  it('an interrupted claim is marked failed and NEVER re-sent', async () => {
    await schedule(20)
    // A crash mid-send: the post never returns, so the claim is left behind exactly as a dead worker leaves it.
    m.post.mockImplementationOnce(() => new Promise(() => {}))
    void runScheduledAnnouncements({ now: plus(25) })
    await vi.waitFor(() => expect(list()[0].status).toBe('sending'))
    m.post.mockReset()
    m.post.mockResolvedValue(true)
    const later = await runScheduledAnnouncements({ now: plus(25 + 31) })
    expect(later.staleFailed).toBe(1)
    expect(m.post).not.toHaveBeenCalled()
    expect(list()[0]).toMatchObject({ status: 'failed', reason: expect.stringContaining('not re-sent') })
  })

  it('a dry run counts what is due and changes nothing', async () => {
    await schedule(20)
    const before = structuredClone(m.settings.L)
    const r = await runScheduledAnnouncements({ dryRun: true, now: plus(25) })
    expect(r.sent).toBe(1)
    expect(m.post).not.toHaveBeenCalled()
    expect(m.settings.L).toEqual(before)
  })

  it('leagues without the key are never read', async () => {
    const r = await runScheduledAnnouncements({ now: plus(25) })
    expect(r.leagues).toBe(0)
  })
})
