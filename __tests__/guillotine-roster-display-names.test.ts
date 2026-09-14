import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * 🛑 A GUILLOTINE NAME IS READ BY THE WHOLE LEAGUE, SO IT MUST NEVER BE AN EMAIL.
 *
 * Danger tiers and survival standings render on the guillotine home and are written into Chimmy's
 * prompts; the elimination engine posts the chopped manager's name into league chat. All three
 * used to resolve names as `displayName || email || id`. These tests pin the replacement: the
 * league's own team name first, then display name, then @username — and `email` never selected.
 *
 * Every fixture user CARRIES an email, so a regression that reads it has something to leak.
 */

const m = vi.hoisted(() => ({
  roster: { findMany: vi.fn() },
  leagueTeam: { findMany: vi.fn() },
  appUser: { findMany: vi.fn() },
  guillotineRosterState: { findMany: vi.fn() },
  guillotinePeriodScore: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: m }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({
  getGuillotineConfig: vi.fn(async () => ({ dangerMarginPoints: 10 })),
}))

import { resolveRosterDisplayNames } from '@/lib/guillotine/rosterDisplayNames'
import { getDangerTiers } from '@/lib/guillotine/GuillotineDangerEngine'
import { getSurvivalStandings } from '@/lib/guillotine/GuillotineStandingsProjectionService'

const LEAK = '@leak.example'

beforeEach(() => {
  for (const d of Object.values(m)) for (const fn of Object.values(d)) (fn as ReturnType<typeof vi.fn>).mockReset()
  m.roster.findMany.mockResolvedValue([
    { id: 'r1', platformUserId: 'sl-1' },
    { id: 'r2', platformUserId: 'u2' },
    { id: 'r3', platformUserId: 'u3' },
    { id: 'r4', platformUserId: 'sl-4' },
    { id: 'r5', platformUserId: 'u5' },
  ])
  m.leagueTeam.findMany.mockResolvedValue([
    { externalId: 'sl-1', ownerName: 'Dre', teamName: 'Dragons' },
    { externalId: 'sl-4', ownerName: '', teamName: 'Iron Reserve' },
  ])
  // Selected fields only would never include email — but a leaky implementation spreading rows would.
  m.appUser.findMany.mockImplementation(async (args: { select: Record<string, boolean> }) => {
    const rows = [
      { id: 'sl-1', displayName: 'Should Not Win', username: 'dre', email: `dre${LEAK}` },
      { id: 'u2', displayName: null, username: 'mikek', email: `mikek${LEAK}` },
      { id: 'u3', displayName: 'Blade', username: 'blade', email: `blade${LEAK}` },
      { id: 'u5', displayName: null, username: null, email: `ghost${LEAK}` },
    ]
    return rows.map((r) => Object.fromEntries(Object.keys(args.select).map((k) => [k, (r as Record<string, unknown>)[k]])))
  })
  m.guillotineRosterState.findMany.mockResolvedValue([])
})

describe('resolveRosterDisplayNames', () => {
  it('prefers the league team name, then display name, then @username', async () => {
    const names = await resolveRosterDisplayNames('L1', ['r1', 'r2', 'r3', 'r4', 'r5'])
    expect(Object.fromEntries(names)).toEqual({
      r1: 'Dre',
      r2: '@mikek',
      r3: 'Blade',
      r4: 'Iron Reserve',
    })
  })

  it('never selects email and scopes the team lookup to the league', async () => {
    await resolveRosterDisplayNames('L1', ['r1', 'r2'])
    expect(Object.keys(m.appUser.findMany.mock.calls[0][0].select)).not.toContain('email')
    expect(m.leagueTeam.findMany.mock.calls[0][0].where.leagueId).toBe('L1')
  })

  it('leaves a manager with no name unresolved instead of reaching for an email', async () => {
    const names = await resolveRosterDisplayNames('L1', ['r5'])
    expect(names.has('r5')).toBe(false)
  })

  it('issues no query for an empty roster list', async () => {
    expect((await resolveRosterDisplayNames('L1', [])).size).toBe(0)
    expect(m.roster.findMany).not.toHaveBeenCalled()
  })
})

describe('guillotine surfaces shown to other managers', () => {
  it('danger tiers render a handle, not an email, for a manager with no display name', async () => {
    m.guillotinePeriodScore.findMany.mockResolvedValue([
      { rosterId: 'r2', periodPoints: 41, seasonPointsCumul: 300 },
      { rosterId: 'r5', periodPoints: 90, seasonPointsCumul: 400 },
    ])
    const rows = await getDangerTiers({ leagueId: 'L1', weekOrPeriod: 3 })
    expect(rows.find((r) => r.rosterId === 'r2')?.displayName).toBe('@mikek')
    expect(JSON.stringify(rows)).not.toContain(LEAK)
    for (const call of m.appUser.findMany.mock.calls) expect(Object.keys(call[0].select)).not.toContain('email')
  })

  it('survival standings render a handle, not an email', async () => {
    m.guillotinePeriodScore.findMany.mockResolvedValue([
      { rosterId: 'r2', weekOrPeriod: 3, periodPoints: 41, seasonPointsCumul: 300 },
      { rosterId: 'r1', weekOrPeriod: 3, periodPoints: 90, seasonPointsCumul: 400 },
    ])
    const rows = await getSurvivalStandings({ leagueId: 'L1' })
    expect(rows.map((r) => [r.rosterId, r.displayName])).toEqual([
      ['r1', 'Dre'],
      ['r2', '@mikek'],
    ])
    expect(JSON.stringify(rows)).not.toContain(LEAK)
  })
})
