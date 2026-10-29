import { beforeEach, describe, expect, it, vi } from 'vitest'

type P = { id: string; tournamentId: string; userId: string; status: string; queuedAt: Date | null; divisionPreference: number | null; invitedByUserId: string | null; displayName: string }
const { db, tx, dispatch } = vi.hoisted(() => {
  const dispatch = vi.fn(async (..._a: unknown[]) => undefined)
  const db = {
    shell: { id: 't1', format: 'divisions', status: 'registering', maxParticipants: 2, commissionerId: 'owner', updatedAt: new Date(1000), formatSettings: { registration: { closesAt: '2999-01-01T00:00:00.000Z', allowPreference: false, allowGrouping: false } } } as Record<string, unknown>,
    participants: [] as P[],
    audits: [] as Array<{ action: string; targetId?: string }>,
  }
  const match = (p: P, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => k === 'tournamentId_userId' ? p.tournamentId === (v as { tournamentId: string }).tournamentId && p.userId === (v as { userId: string }).userId : (p as Record<string, unknown>)[k] === v)
  const tx = {
    tournamentShell: {
      findUnique: vi.fn(async () => ({ ...db.shell })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => ({})),
    },
    tournamentParticipant: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => db.participants.find(p => match(p, where)) ?? null),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => db.participants.filter(p => match(p, where))),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => db.participants.filter(p => match(p, where)).length),
      create: vi.fn(async ({ data }: { data: Omit<P, 'id'> }) => { const p = { id: 'p' + (db.participants.length + 1), queuedAt: null, divisionPreference: null, invitedByUserId: null, ...data } as P; db.participants.push(p); return p }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<P> }) => { const p = db.participants.find(x => x.id === where.id)!; Object.assign(p, data); return p }),
    },
    appUser: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ displayName: 'User ' + where.id, username: where.id, avatarUrl: null })),
      findFirst: vi.fn(async () => null),
    },
    tournamentAuditLog: { create: vi.fn(async ({ data }: { data: { action: string; targetId?: string } }) => { db.audits.push(data); return data }) },
  }
  return { db, tx, dispatch }
})
vi.mock('server-only', () => ({}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: (...a: unknown[]) => dispatch(...(a as [])) }))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: vi.fn(async () => ({ id: 'm' })) }))

vi.mock('@/lib/prisma', () => ({ prisma: { ...tx, $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }))

import { joinTournament, leaveTournament } from '@/lib/tournament/divisions/lifecycle'

beforeEach(() => {
  db.participants = []; db.audits = []; dispatch.mockClear()
  db.shell.status = 'registering'
})

describe('joining', () => {
  it('fills spots, then queues on the waitlist with a queuedAt timestamp', async () => {
    expect((await joinTournament('u1', 't1', { preference: null, ref: null })).status).toBe('registered')
    expect((await joinTournament('u2', 't1', { preference: null, ref: null })).status).toBe('registered')
    const third = await joinTournament('u3', 't1', { preference: null, ref: null })
    expect(third.status).toBe('waitlisted')
    const p3 = db.participants.find(p => p.userId === 'u3')!
    expect(p3.queuedAt).toBeInstanceOf(Date)
    expect(db.audits.filter(a => a.action === 'divisions_entry_joined')).toHaveLength(3)
  })

  it('is idempotent for someone already in', async () => {
    await joinTournament('u1', 't1', { preference: null, ref: null })
    await joinTournament('u1', 't1', { preference: null, ref: null })
    expect(db.participants).toHaveLength(1)
  })

  it('drops the division preference when the commissioner did not allow it', async () => {
    await joinTournament('u1', 't1', { preference: 1, ref: null })
    expect(db.participants[0]!.divisionPreference).toBeNull()
  })

  it('refuses once registration is closed', async () => {
    db.shell.status = 'placed'
    await expect(joinTournament('u1', 't1', { preference: null, ref: null })).rejects.toThrow(/closed/)
  })
})

describe('leaving promotes the waitlist strictly in join order and notifies', () => {
  it('the earliest queuedAt moves up, not the most recently updated', async () => {
    db.participants.push(
      { id: 'a', tournamentId: 't1', userId: 'ua', status: 'registered', queuedAt: null, divisionPreference: null, invitedByUserId: null, displayName: 'A' },
      { id: 'b', tournamentId: 't1', userId: 'ub', status: 'registered', queuedAt: null, divisionPreference: null, invitedByUserId: null, displayName: 'B' },
      { id: 'late', tournamentId: 't1', userId: 'ulate', status: 'waitlisted', queuedAt: new Date('2026-08-02'), divisionPreference: null, invitedByUserId: null, displayName: 'Late' },
      { id: 'early', tournamentId: 't1', userId: 'uearly', status: 'waitlisted', queuedAt: new Date('2026-08-01'), divisionPreference: null, invitedByUserId: null, displayName: 'Early' },
    )
    await leaveTournament('ua', 't1')
    expect(db.participants.find(p => p.id === 'a')!.status).toBe('withdrawn')
    expect(db.participants.find(p => p.id === 'early')!.status).toBe('registered')
    expect(db.participants.find(p => p.id === 'late')!.status).toBe('waitlisted')
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect((dispatch.mock.calls[0] as unknown as [{ userIds: string[] }])[0].userIds).toEqual(['uearly'])
  })
})
