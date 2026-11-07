/**
 * The flagged manager's reply to a tanking flag (lib/integrity/managerReply.ts): only that manager sees
 * the case, the reply is stored on the flag without disturbing the evidence, and the commissioner hears.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({
  flag: null as null | Record<string, unknown>,
  updates: [] as Array<{ where: { id: string }; data: { evidenceJson: Record<string, unknown> } }>,
  notify: vi.fn(async () => ({})),
  log: vi.fn(async () => ({})),
  owner: 'commish',
}))
vi.mock('@/lib/prisma', () => {
  const findFirst = vi.fn(async ({ where }: { where: { id: string; flagType?: string } }) => {
    if (!m.flag || m.flag.id !== where.id) return null
    if (where.flagType && m.flag.flagType !== where.flagType) return null
    return m.flag
  })
  const update = vi.fn(async (args: (typeof m.updates)[number]) => {
    m.updates.push(args)
    m.flag = { ...m.flag!, evidenceJson: args.data.evidenceJson }
    return m.flag
  })
  return {
    prisma: {
      integrityFlag: { findFirst },
      league: { findUnique: vi.fn(async () => ({ userId: m.owner })) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ integrityFlag: { findFirst, update } })),
    },
  }
})
// The manager of roster 'r1' is user 'pat'; anything else has no manager.
vi.mock('@/lib/integrity/tankingPenaltyService', () => ({
  resolveTankingTeam: vi.fn(async (_l: string, rosterId: string) => ({ rosterId: `gen-${rosterId}`, userId: rosterId === 'r1' ? 'pat' : null })),
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.notify }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.log }))

import { loadFlagForManager, MANAGER_REPLY_MAX, submitManagerReply } from '@/lib/integrity/managerReply'

const tanking = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  leagueId: 'L',
  flagType: 'tanking',
  status: 'open',
  summary: 'Started a player who could not play.',
  createdAt: new Date('2026-11-01T12:00:00Z'),
  affectedRosterIds: ['r1'],
  evidenceJson: {
    weekNumber: 9,
    weeksFlagged: [9],
    detector: 'rules',
    illegalOrSuspiciousStarters: [{ slotPosition: 'QB', startedPlayerName: 'J. Allen', startedPlayerStatus: 'OUT', benchedBetterOption: 'G. Smith', week: 9 }],
  },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.flag = tanking()
  m.updates = []
  m.owner = 'commish'
})

describe('who can see the case', () => {
  it('the manager it names sees what was flagged', async () => {
    const view = await loadFlagForManager('L', 'f1', 'pat')
    expect(view?.starts).toEqual([{ week: 9, slot: 'QB', player: 'J. Allen', status: 'OUT', bench: 'G. Smith' }])
    expect(view?.canReply).toBe(true)
  })

  it('any other member gets nothing — not even that it exists', async () => {
    expect(await loadFlagForManager('L', 'f1', 'sam')).toBeNull()
  })

  it('a collusion flag is never shown to a manager: they were not told, and it would tip them off', async () => {
    m.flag = tanking({ flagType: 'collusion' })
    expect(await loadFlagForManager('L', 'f1', 'pat')).toBeNull()
  })
})

describe('sending a reply', () => {
  it('is stored on the flag beside the evidence, which is left exactly as the scan wrote it', async () => {
    const r = await submitManagerReply('L', 'f1', 'pat', '  My QB was ruled out an hour before kickoff.  ')
    expect(r.ok).toBe(true)
    const ev = m.updates[0]!.data.evidenceJson
    expect(ev.managerReply).toMatchObject({ userId: 'pat', text: 'My QB was ruled out an hour before kickoff.' })
    expect(ev.weeksFlagged).toEqual([9])
    expect(ev.detector).toBe('rules')
  })

  it('tells the commissioner, with a link straight to the flag', async () => {
    await submitManagerReply('L', 'f1', 'pat', 'Late scratch.')
    expect(m.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['commish'], actionHref: '/league/L/commissioner/integrity?flag=f1' }),
    )
  })

  it('refuses an empty reply, an over-long one, a stranger, and a case already ruled on', async () => {
    expect(await submitManagerReply('L', 'f1', 'pat', '   ')).toEqual({ ok: false, error: 'empty' })
    expect(await submitManagerReply('L', 'f1', 'pat', 'x'.repeat(MANAGER_REPLY_MAX + 1))).toEqual({ ok: false, error: 'too_long' })
    expect(await submitManagerReply('L', 'f1', 'sam', 'hi')).toEqual({ ok: false, error: 'not_found' })
    m.flag = tanking({ status: 'escalated' })
    expect(await submitManagerReply('L', 'f1', 'pat', 'hi')).toEqual({ ok: false, error: 'closed' })
    expect(m.updates).toEqual([])
  })
})
