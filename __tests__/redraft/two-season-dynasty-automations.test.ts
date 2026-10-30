/**
 * A dynasty league across the season boundary with its automations on (phase 11, 2026-10-29).
 *
 * Season one is the full dynasty simulation (`__tests__/helpers/redraftFullSeasonHarness.ts`, dynasty:
 * true): draft, every week, playoffs, champion, rosters carried into season two. On top of it, the
 * league runs the commissioner's choices from phase 10 and checks that they behave as one system across
 * the rollover, through the real services on the in-memory store:
 *
 *   - the opt-in auto-handover, switched on during season one, hands quiet teams over in season two and
 *     leaves the one manager who kept saving lineups alone;
 *   - the handover survives the rollover (it lives on the league and the team, both of which carry);
 *   - a team that changes hands in season two is its new owner's, and the mode ends;
 *   - the Monday recap counts what was done, and the "What runs itself" card reads it.
 *
 * Every number is read back from the store; nothing here re-implements a rule.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', async () => {
  const { inMemoryPrisma } = await import('../helpers/inMemoryPrisma')
  return { prisma: inMemoryPrisma.client, default: inMemoryPrisma.client }
})
vi.mock('@/lib/events', () => ({
  getPlatformEvents: () => ({ emit: async () => undefined }),
  EVENT: new Proxy({}, { get: (_t, key) => String(key) }),
}))
const notes = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: async (n: Record<string, unknown>) => {
    notes.push(n)
    return {}
  },
}))

import { inMemoryPrisma } from '../helpers/inMemoryPrisma'
import { runRedraftFullSeasonSimulation, type FullSeasonSimResult } from '../helpers/redraftFullSeasonHarness'
import { endManagedForNewOwners, runAutoHandovers } from '@/lib/inactive-manager/inactiveManagerService'
import { readManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'
import { runWeeklyAutomationRecaps } from '@/lib/commissioner-hub/weeklyAutomationRecapService'
import { buildAutomationOverview } from '@/lib/commissioner-hub/automationOverview'

const DAY = 86_400_000
let sim: FullSeasonSimResult
const settings = () => inMemoryPrisma.table('league').find((l) => l.id === sim.leagueId)!.settings as Record<string, unknown>

describe('a dynasty league across two seasons, running itself', () => {
  // Season two's first Monday, well after the rule was switched on.
  const ruleOn = new Date('2027-02-01T00:00:00Z')
  const seasonTwo = new Date('2027-03-01T12:00:00Z') // a Monday

  beforeAll(async () => {
    sim = await runRedraftFullSeasonSimulation(inMemoryPrisma, { sport: 'NBA', teamCount: 10, dynasty: true })
    // The commissioner switched auto-handover on during season one (as the "Run it for me" preset does).
    const league = inMemoryPrisma.table('league').find((l) => l.id === sim.leagueId)!
    league.settings = { ...(league.settings as object), inactive_auto_handover: { days: 14, to: 'lineups', since: ruleOn.toISOString(), byUserId: 'user-1' } }
    // One manager kept saving lineups into season two; nobody else did anything of their own.
    await inMemoryPrisma.client.afRosterMoveHistory.create({
      data: { leagueId: sim.leagueId, rosterId: 'generic-2', actorUserId: 'user-2', source: 'user_save', moveSummary: 'roster_playerData_update', createdAt: new Date(seasonTwo.getTime() - 3 * DAY) },
    })
  }, 600_000)

  it('season one ended and its rosters were carried into season two', () => {
    expect(sim.dynastyRollover?.next?.season).toBe(sim.seasonYear + 1)
    expect(sim.dynastyRollover!.next!.playersCarried).toBeGreaterThan(0)
  })

  it('in season two, the quiet teams are handed over and the active manager is left alone', async () => {
    const r = await runAutoHandovers({ now: seasonTwo, leagueIds: [sim.leagueId] })
    const managed = readManagedLineups(settings())
    expect(r.handedOver).toBe(9)
    expect(Object.keys(managed).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `generic-${i + 1}`).filter((id) => id !== 'generic-2').sort())
    expect(managed['generic-3']).toMatchObject({ byUserId: 'user-1', ownerUserId: 'user-3' })
    expect(notes.filter((n) => n.type === 'inactive_auto_handover_owner').map((n) => (n.userIds as string[])[0])).toContain('user-3')
    // Running again the same hour hands nobody over twice.
    expect((await runAutoHandovers({ now: seasonTwo, leagueIds: [sim.leagueId] })).handedOver).toBe(0)
  })

  it('a team that changes hands in season two is its new owner’s, and the mode ends', async () => {
    const roster = inMemoryPrisma.table('roster').find((r) => r.id === 'generic-4')!
    roster.platformUserId = 'new-owner'
    expect(await endManagedForNewOwners(sim.leagueId, 'user-1', 'Sim')).toEqual(['generic-4'])
    expect(readManagedLineups(settings())['generic-4']).toBeUndefined()
    expect(Object.keys(readManagedLineups(settings()))).toHaveLength(8)
  })

  it('the Monday recap counts what was done, and the card reads the same league', async () => {
    // The audit rows carry the real clock (the store stamps createdAt), so the recap is run for the
    // Monday after today: the week it reports is the one these actions were written in.
    const today = new Date()
    const nextMonday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + ((8 - today.getUTCDay()) % 7 || 7), 12))
    const r = await runWeeklyAutomationRecaps({ now: nextMonday })
    expect(r.sent).toBe(1)
    const recap = notes.find((n) => n.type === 'weekly_automation_recap')!
    expect(recap.body).toContain('took over 9 teams with no activity, as you set up')
    expect(recap.body).toContain('handed 1 team back to a new owner')
    const rows = buildAutomationOverview({
      leagueId: sim.leagueId,
      settings: settings(),
      dynasty: true,
      commissionerPlan: false,
      rookieDraftAutoOpen: false,
      liveRookieOrderOn: false,
      tankingMonitorOn: false,
      tankingPenaltiesOn: false,
      holdFlaggedTradesMode: 'severe',
    })
    expect(rows.find((x) => x.key === 'managed_teams')!.detail).toBe('8 teams')
    expect(rows.find((x) => x.key === 'auto_handover')!.detail).toBe('After 14 days, to AllFantasy')
  })
})
