// @vitest-environment node
/** Confessionals: private while the author plays, quoted when they leave, all revealed after the finale. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; leagueId: string; channelType: string; targetUserId: string; content: string; createdAt: Date }>,
  phase: 'pre_merge',
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  survivorPlayer: {
    findFirst: vi.fn(async ({ where }: any) => (['a', 'b'].includes(where.userId) ? { playerState: 'active' } : null)),
    findMany: vi.fn(async () => [{ userId: 'a', displayName: 'Ava' }, { userId: 'b', displayName: 'Ben' }]),
  },
  survivorGameState: { findUnique: vi.fn(async () => ({ phase: h.phase })) },
  survivorHostMessage: {
    count: vi.fn(async ({ where }: any) => h.rows.filter(r => r.targetUserId === where.targetUserId && r.createdAt >= where.createdAt.gte).length),
    create: vi.fn(async ({ data }: any) => { const row = { id: `m${h.rows.length}`, createdAt: new Date(Date.parse('2026-10-20T12:00:00Z') + h.rows.length * 1000), ...data }; h.rows.push(row); return row }),
    findMany: vi.fn(async ({ where, orderBy }: any) => {
      const list = h.rows.filter(r => r.channelType === where.channelType && (!where.targetUserId || r.targetUserId === where.targetUserId))
      return orderBy.createdAt === 'desc' ? [...list].reverse() : list
    }),
    findFirst: vi.fn(async ({ where }: any) => [...h.rows].reverse().find(r => r.channelType === where.channelType && r.targetUserId === where.targetUserId) ?? null),
  },
} }))

import { latestConfessional, listMyConfessionals, revealedConfessionals, submitConfessional } from '@/lib/survivor/survivorConfessionals'

const now = new Date('2026-10-20T13:00:00Z')
beforeEach(() => { h.rows.length = 0; h.phase = 'pre_merge' })

describe('confessionals', () => {
  it('records a trimmed note for a manager in the cast, and refuses empty, too long and strangers', async () => {
    expect(await submitConfessional('L1', 'a', '  I trust   my tribe  ', now)).toEqual(expect.objectContaining({ ok: true, confessional: expect.objectContaining({ text: 'I trust my tribe' }) }))
    expect(h.rows[0]).toEqual(expect.objectContaining({ channelType: 'confessional', targetUserId: 'a', isPosted: false }))
    expect(await submitConfessional('L1', 'a', '   ', now)).toEqual(expect.objectContaining({ ok: false, status: 400 }))
    expect(await submitConfessional('L1', 'a', 'x'.repeat(281), now)).toEqual(expect.objectContaining({ ok: false, status: 400 }))
    expect(await submitConfessional('L1', 'zed', 'hi', now)).toEqual(expect.objectContaining({ ok: false, status: 403 }))
  })

  it('allows three a day', async () => {
    for (let i = 0; i < 3; i++) expect((await submitConfessional('L1', 'a', `note ${i}`, now)).ok).toBe(true)
    expect(await submitConfessional('L1', 'a', 'one more', now)).toEqual(expect.objectContaining({ ok: false, status: 429 }))
  })

  it('stays private while the season runs, and reveals everyone after the finale', async () => {
    await submitConfessional('L1', 'a', 'Ava early', now)
    await submitConfessional('L1', 'b', 'Ben plots', now)
    await submitConfessional('L1', 'a', 'Ava late', now)
    expect((await listMyConfessionals('L1', 'a')).map(row => row.text)).toEqual(['Ava late', 'Ava early'])
    expect(await latestConfessional('L1', 'a')).toBe('Ava late')
    expect(await revealedConfessionals('L1')).toBeNull()
    h.phase = 'complete'
    expect((await revealedConfessionals('L1'))!.map(row => `${row.author}: ${row.text}`)).toEqual(['Ava: Ava early', 'Ben: Ben plots', 'Ava: Ava late'])
    expect(await submitConfessional('L1', 'a', 'after', now)).toEqual(expect.objectContaining({ ok: false, status: 409 }))
  })
})
