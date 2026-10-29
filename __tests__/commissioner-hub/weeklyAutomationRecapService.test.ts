/** The weekly recap run (lib/commissioner-hub/weeklyAutomationRecapService.ts). */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({
  notify: vi.fn(async () => ({})),
  sent: null as null | { id: string },
  lang: 'en' as string | null,
  health: vi.fn(async () => ({ rows: [] as Array<Record<string, unknown>> })),
  prisma: {
    automationAuditLog: {
      findMany: vi.fn(async () => [{ leagueId: 'L' }]),
      groupBy: vi.fn(async () => [{ action: 'fill_empty_starters.applied', _count: { _all: 2 } }]),
    },
    leagueAuditLog: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => [{ actionType: 'chimmy_autopilot.claim', _count: { _all: 1 } }]),
    },
    draftPick: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    league: { findUnique: vi.fn(async () => ({ userId: 'commish', name: 'Dyn', platform: 'allfantasy' })) },
    platformNotification: { findUnique: vi.fn(async () => m.sent) },
    userProfile: { findUnique: vi.fn(async () => ({ preferredLanguage: m.lang })) },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.notify }))
vi.mock('@/lib/commissioner-hub/managerHealth', () => ({ getLeagueManagerHealth: m.health }))

import { runWeeklyAutomationRecaps } from '@/lib/commissioner-hub/weeklyAutomationRecapService'

const MONDAY = new Date('2026-11-02T15:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  m.sent = null
  m.lang = 'en'
})

describe('runWeeklyAutomationRecaps', () => {
  it('on a Monday, sends the commissioner last week\'s recap once', async () => {
    const r = await runWeeklyAutomationRecaps({ now: MONDAY })
    expect(r).toMatchObject({ leagues: 1, sent: 1 })
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({
      userIds: ['commish'],
      type: 'weekly_automation_recap',
      dedupePrefix: 'automation-recap:L:2026-10-26',
      body: 'This week AllFantasy filled 2 empty starting spots; and made 1 waiver claim for teams on Chimmy autopilot. Every action is in the league log.',
    }))
  })

  it('in Spanish for a commissioner who reads Spanish', async () => {
    m.lang = 'es-MX'
    await runWeeklyAutomationRecaps({ now: MONDAY })
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Lo que hizo AllFantasy esta semana · Dyn',
      body: 'Esta semana AllFantasy llenó 2 puestos titulares vacíos; y hizo 1 reclamo para equipos con piloto automático de Chimmy. Cada acción está en el registro de la liga.',
      actionLabel: 'Abrir registro de la liga',
    }))
  })

  it('lists quiet teams nothing covers, and its button opens the card that hands them over', async () => {
    m.health.mockResolvedValueOnce({ rows: [
      { rosterId: 'r1', teamName: 'Ghosts', managerName: null, status: 'inactive' },
      { rosterId: 'r2', teamName: 'Covered', managerName: null, status: 'inactive' },
      { rosterId: 'r3', teamName: 'Busy', managerName: null, status: 'active' },
    ] })
    m.prisma.league.findUnique.mockResolvedValueOnce({ userId: 'commish', name: 'Dyn', platform: 'allfantasy', settings: { af_managed_lineups: { r2: { since: 's', byUserId: 'c' } } } })
    await runWeeklyAutomationRecaps({ now: MONDAY })
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('One team looks inactive: Ghosts. You can hand it to AllFantasy from the Commissioner Hub.'),
      actionHref: '/core/commissioner?league=L#ch-inactive-managers',
      actionLabel: 'Hand to AllFantasy',
    }))
  })

  it('a week where AllFantasy did nothing but a team went quiet still sends the recap', async () => {
    m.prisma.automationAuditLog.groupBy.mockResolvedValueOnce([])
    m.prisma.leagueAuditLog.groupBy.mockResolvedValueOnce([])
    m.health.mockResolvedValueOnce({ rows: [{ rosterId: 'r1', teamName: 'Ghosts', managerName: null, status: 'inactive' }] })
    expect(await runWeeklyAutomationRecaps({ now: MONDAY })).toMatchObject({ sent: 1 })
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ body: 'One team looks inactive: Ghosts. You can hand it to AllFantasy from the Commissioner Hub.' }))
  })

  it('leaves quiet teams out when the league already hands them over by itself', async () => {
    m.health.mockResolvedValueOnce({ rows: [{ rosterId: 'r1', teamName: 'Ghosts', managerName: null, status: 'inactive' }] })
    m.prisma.league.findUnique.mockResolvedValueOnce({ userId: 'commish', name: 'Dyn', platform: 'allfantasy', settings: { inactive_auto_handover: { days: 14, to: 'lineups', since: '2026-10-01T00:00:00.000Z', byUserId: 'c' } } })
    await runWeeklyAutomationRecaps({ now: MONDAY })
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ body: expect.not.stringContaining('inactive'), actionLabel: 'Open league log' }))
  })

  it('does not send it again once it is stored', async () => {
    m.sent = { id: 'n1' }
    expect(await runWeeklyAutomationRecaps({ now: MONDAY })).toMatchObject({ sent: 0, alreadySent: 1 })
    expect(m.notify).not.toHaveBeenCalled()
  })

  it('does nothing on any other day', async () => {
    expect(await runWeeklyAutomationRecaps({ now: new Date('2026-11-04T15:00:00Z') })).toMatchObject({ leagues: 0, sent: 0 })
    expect(m.prisma.automationAuditLog.findMany).not.toHaveBeenCalled()
  })

  it('skips an imported league', async () => {
    m.prisma.league.findUnique.mockResolvedValueOnce({ userId: 'commish', name: 'Dyn', platform: 'sleeper' })
    expect(await runWeeklyAutomationRecaps({ now: MONDAY })).toMatchObject({ sent: 0 })
    expect(m.notify).not.toHaveBeenCalled()
  })
})
