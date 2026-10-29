/** Chimmy knows the league's automations, and why a lineup changed (phase 12, 2026-10-29). */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({
  role: 'member' as string,
  native: true,
  roster: { id: 'r1' } as null | { id: string },
  automated: [] as Array<{ createdAt: Date; message: string }>,
  modes: [] as Array<{ createdAt: Date; actionType: string }>,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findFirst: async () => m.roster },
    automationAuditLog: { findMany: async () => m.automated },
    leagueAuditLog: { findMany: async () => m.modes },
  },
}))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: async () => m.role }))
vi.mock('@/lib/lineup-automation/myTeamAutomationsService', () => ({
  readMyTeamAutomations: async () => ({ available: true, items: [{ key: 'fill_empty_starters', en: 'If you leave a starting spot empty, AllFantasy fills it.', es: 'x' }], takeBack: { key: 'take_back', en: 'Every change is in the league log.', es: 'y' } }),
}))
vi.mock('@/lib/commissioner-hub/automationOverviewService', () => ({
  readAutomationFacts: async () =>
    m.native
      ? { native: true, facts: { leagueId: 'L', settings: {}, dynasty: false, commissionerPlan: false, rookieDraftAutoOpen: false, liveRookieOrderOn: false, tankingMonitorOn: false, tankingPenaltiesOn: false, holdFlaggedTradesMode: 'severe' } }
      : { native: false },
}))

import { buildAutomationContextForChimmy } from '@/lib/commissioner-hub/automationChimmyContextService'

beforeEach(() => {
  m.role = 'member'
  m.native = true
  m.roster = { id: 'r1' }
  m.automated = []
  m.modes = []
})

describe('buildAutomationContextForChimmy', () => {
  it('a manager gets what may act on their team, and that nothing changed it automatically lately', async () => {
    const ctx = await buildAutomationContextForChimmy('L', 'u')
    expect(ctx).toContain('[LEAGUE AUTOMATIONS')
    expect(ctx).toContain('- If you leave a starting spot empty, AllFantasy fills it.')
    expect(ctx).toContain('No automatic change has been recorded on the asker’s team in the last 14 days')
    expect(ctx).not.toContain('Every automation in the league')
  })

  it('lists the recent automatic changes newest first, lineup saves and mode changes together', async () => {
    m.automated = [{ createdAt: new Date('2026-10-20T10:00:00Z'), message: 'Filled an empty starting spot before lock: Bench Back at RB.' }]
    m.modes = [{ createdAt: new Date('2026-10-25T10:00:00Z'), actionType: 'inactive_manager_mode.auto_handover' }]
    const ctx = await buildAutomationContextForChimmy('L', 'u', new Date('2026-10-29T00:00:00Z'))
    const a = ctx.indexOf('2026-10-25: The team had no activity')
    const b = ctx.indexOf('2026-10-20: Filled an empty starting spot before lock: Bench Back at RB.')
    expect(a).toBeGreaterThan(-1)
    expect(b).toBeGreaterThan(a)
  })

  it('a commissioner also gets every automation’s state', async () => {
    m.role = 'commissioner'
    const ctx = await buildAutomationContextForChimmy('L', 'u')
    expect(ctx).toContain('Every automation in the league')
    expect(ctx).toContain('- Anti-tanking monitor: needs AF Commissioner')
    expect(ctx).toContain('- Fill empty starting spots before lock: on (Every hour, from the bench)')
  })

  it('nothing for an imported league', async () => {
    m.native = false
    expect(await buildAutomationContextForChimmy('L', 'u')).toBe('')
  })
})
