/** The weekly recap run (lib/commissioner-hub/weeklyAutomationRecapService.ts). */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({
  notify: vi.fn(async () => ({})),
  sent: null as null | { id: string },
  lang: 'en' as string | null,
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
      body: 'Esta semana AllFantasy llenó 2 puestos titulares vacíos; y hizo 1 reclamo de waivers para equipos con piloto automático de Chimmy. Cada acción está en el registro de la liga.',
      actionLabel: 'Abrir registro de la liga',
    }))
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
