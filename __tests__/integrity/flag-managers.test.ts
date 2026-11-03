/**
 * An integrity alert names the managers involved, not only the assets that moved.
 *
 * Flag roster ids come from three stores — a native RedraftRoster, an imported Roster, or a LeagueTeam
 * — so `resolveFlagManagers` is checked against each, plus the name a newer scan stores in evidence.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({
  redraftRoster: { findMany: vi.fn() },
  roster: { findMany: vi.fn() },
  leagueTeam: { findMany: vi.fn() },
  integrityFlag: { findFirst: vi.fn(), update: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const dispatch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: dispatch }))

import { resolveFlagManagers } from '@/lib/integrity/flagManagers'
import { notifyCommissionerOfFlag } from '@/lib/integrity/integrityNotifier'

const flag = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  leagueId: 'L1',
  affectedRosterIds: ['a', 'b'],
  evidenceJson: {},
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.redraftRoster.findMany.mockResolvedValue([])
  db.roster.findMany.mockResolvedValue([])
  db.leagueTeam.findMany.mockResolvedValue([])
})

describe('resolveFlagManagers', () => {
  it('prefers the manager name the scan stored in evidence', async () => {
    const out = await resolveFlagManagers([
      flag({
        evidenceJson: {
          team1: { rosterId: 'a', teamName: 'Punt Gods', managerName: 'Alex Rivera' },
          team2: { rosterId: 'b', teamName: 'Fourth & Long', managerName: 'Pat Vance' },
        },
      }),
    ])
    expect(out.get('f1')?.map((m) => m.managerName)).toEqual(['Alex Rivera', 'Pat Vance'])
  })

  it('reads a native league from RedraftRoster', async () => {
    db.redraftRoster.findMany.mockResolvedValue([
      { id: 'a', ownerName: 'Alex Rivera', teamName: 'Punt Gods' },
      { id: 'b', ownerName: 'Pat Vance', teamName: null },
    ])
    const out = await resolveFlagManagers([flag()])
    expect(out.get('f1')).toEqual([
      { rosterId: 'a', managerName: 'Alex Rivera', teamName: 'Punt Gods' },
      { rosterId: 'b', managerName: 'Pat Vance', teamName: null },
    ])
  })

  it('joins an imported Roster to its LeagueTeam the way the canonical world does', async () => {
    db.roster.findMany.mockResolvedValue([{ id: 'a', leagueId: 'L1', platformUserId: 'sleeper-7', playerData: {} }])
    db.leagueTeam.findMany.mockResolvedValue([
      { id: 't1', leagueId: 'L1', externalId: '1', ownerName: 'Alex Rivera', teamName: 'Punt Gods', platformUserId: 'sleeper-7', claimedByUserId: null },
      { id: 't2', leagueId: 'L1', externalId: 'b', ownerName: 'Pat Vance', teamName: 'Fourth & Long', platformUserId: null, claimedByUserId: null },
    ])
    const out = await resolveFlagManagers([flag()])
    expect(out.get('f1')?.map((m) => m.managerName)).toEqual(['Alex Rivera', 'Pat Vance'])
  })

  it('leaves out an id it cannot resolve rather than guessing', async () => {
    db.redraftRoster.findMany.mockResolvedValue([{ id: 'a', ownerName: 'Alex Rivera', teamName: null }])
    const out = await resolveFlagManagers([flag()])
    expect(out.get('f1')?.map((m) => m.rosterId)).toEqual(['a'])
  })
})

describe('notifyCommissionerOfFlag names the managers', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    ...flag(),
    flagType: 'collusion',
    severity: 'high',
    summary: 'Large value gap.',
    notifiedAt: null,
    league: { userId: 'owner', settings: {} },
    ...over,
  })

  it('leads a collusion alert with both managers', async () => {
    db.integrityFlag.findFirst.mockResolvedValue(row())
    db.redraftRoster.findMany.mockResolvedValue([
      { id: 'a', ownerName: 'Alex Rivera', teamName: null },
      { id: 'b', ownerName: 'Pat Vance', teamName: null },
    ])
    await notifyCommissionerOfFlag('f1')
    const sent = dispatch.mock.calls[0]![0]
    expect(sent.title).toBe('⚠️ Possible collusion · Alex Rivera ↔ Pat Vance')
    expect(sent.body).toBe('Trade between Alex Rivera and Pat Vance. Large value gap.')
    // The alert opens the flag itself, not just the page.
    expect(sent.actionHref).toBe('/league/L1/commissioner/integrity?flag=f1')
    expect(sent.smsBody).toMatch(/^AllFantasy: Possible collusion between Alex Rivera and Pat Vance\. Review: .*\/league\/L1\/commissioner\/integrity\?flag=f1$/)
  })

  it('still sends the alert when the names cannot be looked up', async () => {
    db.integrityFlag.findFirst.mockResolvedValue(row())
    db.redraftRoster.findMany.mockRejectedValue(new Error('db down'))
    await notifyCommissionerOfFlag('f1')
    expect(dispatch.mock.calls[0]![0].body).toBe('Large value gap.')
  })
})
