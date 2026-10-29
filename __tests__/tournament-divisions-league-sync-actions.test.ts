import { beforeEach, describe, expect, it, vi } from 'vitest'

const { db, tx, syncDraft, syncCo } = vi.hoisted(() => {
  const db = {
    shell: { id: 't1', format: 'divisions', status: 'placed', commissionerId: 'owner', name: 'Cup' } as Record<string, unknown>,
    grants: [] as Array<{ tournamentId: string; userId: string; canEditSettings: boolean; canBroadcast: boolean; canAdvance: boolean; role: string }>,
    leagueRow: { id: 'tl1', tournamentId: 't1', name: 'North Gold', leagueId: 'L1', participants: [{ userId: 'u1' }], division: { name: 'Gold' } } as Record<string, unknown>,
    audits: [] as Array<{ action: string }>,
  }
  const tx = {
    tournamentShell: { findUnique: vi.fn(async () => ({ ...db.shell })) },
    tournamentShellGrant: {
      findUnique: vi.fn(async ({ where }: { where: { tournamentId_userId: { userId: string } } }) => db.grants.find(g => g.userId === where.tournamentId_userId.userId) ?? null),
      upsert: vi.fn(async ({ create }: { create: (typeof db.grants)[number] }) => { db.grants = db.grants.filter(g => g.userId !== create.userId); db.grants.push(create) }),
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => { const n = db.grants.length; db.grants = db.grants.filter(g => g.userId !== where.userId); return { count: n - db.grants.length } }),
    },
    tournamentLeague: {
      findFirst: vi.fn(async () => ({ ...db.leagueRow })),
      update: vi.fn(async () => ({})),
    },
    appUser: { findFirst: vi.fn(async ({ where }: { where: { username: { equals: string } } }) => (where.username.equals.toLowerCase() === 'cohost' ? { id: 'co1' } : null)) },
    tournamentAuditLog: { create: vi.fn(async ({ data }: { data: { action: string } }) => { db.audits.push(data); return data }) },
  }
  const syncDraft = vi.fn(async (..._a: unknown[]) => [{ tournamentLeagueId: 'tl1', name: 'North Gold', leagueId: 'L1', outcome: 'skipped_started' }])
  const syncCo = vi.fn(async (..._a: unknown[]) => [{ tournamentLeagueId: 'tl1', name: 'North Gold', leagueId: 'L1', outcome: 'updated', added: 1, removed: 0 }])
  return { db, tx, syncDraft, syncCo }
})
vi.mock('server-only', () => ({}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn(async () => undefined) }))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: vi.fn(async () => ({ id: 'm' })) }))
vi.mock('@/lib/prisma', () => ({ prisma: { ...tx, $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }))
vi.mock('@/lib/tournament/divisions/conferenceLeagueSync', () => ({ syncConferenceDraftTimes: (...a: unknown[]) => syncDraft(...a), syncConferenceCoCommissioners: (...a: unknown[]) => syncCo(...a) }))

import { addCoCommissioner, removeCoCommissioner, setDraftTime } from '@/lib/tournament/divisions/lifecycle'

beforeEach(() => {
  db.grants = []; db.audits = []; syncDraft.mockClear(); syncCo.mockClear()
})

describe('setting a tournament draft time schedules the conference league', () => {
  it('syncs exactly that conference and reports each league outcome', async () => {
    const at = new Date(Date.now() + 86_400_000).toISOString()
    const r = await setDraftTime('owner', 't1', 'tl1', at)
    expect(syncDraft).toHaveBeenCalledWith('t1', 'owner', { tournamentLeagueIds: ['tl1'] })
    expect(r.leagues[0]!.outcome).toBe('skipped_started')
    expect(tx.tournamentLeague.update).toHaveBeenCalledWith({ where: { id: 'tl1' }, data: { draftScheduledAt: new Date(at) } })
  })
})

describe('managing tournament co-commissioners keeps the leagues in step', () => {
  it('adding one writes a settings grant (no broadcast, no advance) and syncs every league', async () => {
    const r = await addCoCommissioner('owner', 't1', 'CoHost')
    expect(db.grants).toEqual([expect.objectContaining({ userId: 'co1', role: 'co_commissioner', canEditSettings: true, canBroadcast: false, canAdvance: false })])
    expect(syncCo).toHaveBeenCalledWith('t1', 'owner')
    expect(r.leagues[0]!.outcome).toBe('updated')
    expect(db.audits.map(a => a.action)).toContain('divisions_co_commissioner_added')
  })

  it('removing one deletes the grant and syncs every league', async () => {
    db.grants = [{ tournamentId: 't1', userId: 'co1', canEditSettings: true, canBroadcast: false, canAdvance: false, role: 'co_commissioner' }]
    await removeCoCommissioner('owner', 't1', 'co1')
    expect(db.grants).toEqual([])
    expect(syncCo).toHaveBeenCalledWith('t1', 'owner')
  })

  it('only the owner can grant or remove, so a co-commissioner cannot promote anyone', async () => {
    db.grants = [{ tournamentId: 't1', userId: 'co1', canEditSettings: true, canBroadcast: false, canAdvance: false, role: 'co_commissioner' }]
    await expect(addCoCommissioner('co1', 't1', 'CoHost')).rejects.toThrow(/owner/)
    await expect(removeCoCommissioner('co1', 't1', 'co1')).rejects.toThrow(/owner/)
    expect(syncCo).not.toHaveBeenCalled()
  })

  it('refuses an unknown username and the owner themselves', async () => {
    await expect(addCoCommissioner('owner', 't1', 'nobody')).rejects.toThrow(/not found/)
    await expect(removeCoCommissioner('owner', 't1', 'owner')).rejects.toThrow(/cannot be removed/)
  })
})
