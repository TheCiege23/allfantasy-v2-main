/**
 * The Sync screen's Guilly card for an imported league (lib/guillotine/importedGuillyHealthLoad.ts →
 * lib/core-app/leagueSync.ts → components/core-app/screens/LeagueSync.tsx): the loader joins the
 * provider's roster ids to team names and roster sizes, and the card says what we read and what is in
 * doubt. The checks themselves are in __tests__/guillotine/imported-guilly-health.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const h = vi.hoisted(() => ({
  league: {} as Record<string, unknown>,
  rows: [] as Array<{ week: number; rosterId: string; pointsFor: number; matchupId: number | null }>,
  weeklyWhere: null as unknown,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueSyncState: { findUnique: vi.fn(async () => null) },
    roster: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => [
        { platformUserId: 'u1', playerData: { players: ['a', 'b'] } },
        { platformUserId: 'u2', playerData: { players: ['c'] } },
        { platformUserId: 'u3', playerData: { players: [] } },
        { platformUserId: 'u4', playerData: { players: [] } },
      ]),
    },
    leagueTeam: {
      findMany: vi.fn(async () => [
        { externalId: '1', teamName: 'Axes', platformUserId: 'u1' },
        { externalId: '2', teamName: 'Blades', platformUserId: 'u2' },
        { externalId: '3', teamName: 'Cleavers', platformUserId: 'u3' },
        { externalId: '4', teamName: 'Daggers', platformUserId: 'u4' },
      ]),
    },
    weeklyMatchup: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async (args: { where: unknown }) => {
        h.weeklyWhere = args.where
        return h.rows
      }),
    },
    matchupFact: { findMany: vi.fn(async () => []) },
    syncJobRun: { findFirst: vi.fn(async () => null) },
  },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/lib/core-app/syncPreferences', () => ({ getPausedSyncKeys: vi.fn(async () => new Set<string>()) }))

import { getLeagueSync } from '@/lib/core-app/leagueSync'
import { LeagueSync } from '@/components/core-app/screens/LeagueSync'
import type { LeagueContext } from '@/lib/core-app/leagueContext'

const NOW = new Date('2026-10-30T12:00:00Z')
const row = (week: number, rosterId: string, pointsFor: number) => ({ week, rosterId, pointsFor, matchupId: null })

function ctx(): LeagueContext {
  return {
    leagueId: 'L', userId: 'U',
    league: vi.fn(async () => ({ id: 'L', name: 'Chop Shop', platformLeagueId: 'SL9', season: 2026, userId: 'U', createdAt: new Date('2026-08-01T00:00:00Z'), ...h.league })),
    claimedTeam: vi.fn(async () => ({ id: 'team-1' })),
    claimedTeams: vi.fn(async () => []),
  } as unknown as LeagueContext
}
async function load() {
  const r = await getLeagueSync('L', 'U', NOW, ctx())
  if (!r.available) throw new Error(r.reason)
  return r
}

beforeEach(() => {
  h.league = {
    platform: 'sleeper', leagueType: 'guillotine', guillotineMode: null, status: 'in_season', lifecycleState: 'in_season',
    settings: { leagueTypeConfirmation: { type: 'guillotine' } }, lastSyncedAt: new Date('2026-10-30T11:30:00Z'),
  }
  // Daggers chopped after week 1, Cleavers after week 2; week 3 in play.
  h.rows = [
    row(1, '1', 110), row(1, '2', 100), row(1, '3', 90), row(1, '4', 80),
    row(2, '1', 105), row(2, '2', 95), row(2, '3', 70), row(2, '4', 0),
    row(3, '1', 50), row(3, '2', 40), row(3, '3', 0), row(3, '4', 0),
  ]
})

describe('the loader', () => {
  it('reads this season’s scores by the provider’s league id, and names the chops by team', async () => {
    const r = await load()
    expect(h.weeklyWhere).toEqual({ leagueId: 'SL9', seasonYear: 2026 })
    expect(r.guilly).toMatchObject({ status: 'ok', teamsAlive: 2, chops: [{ week: 1, rosterIds: ['4'] }, { week: 2, rosterIds: ['3'] }] })
    expect(r.guilly!.teamNames).toMatchObject({ '3': 'Cleavers', '4': 'Daggers' })
  })

  it('joins rosters to teams by owner, so an empty roster the scores do not explain is caught', async () => {
    h.rows = h.rows.filter((x) => x.week === 1) // no chop read yet, but two rosters are already empty
    const r = await load()
    expect(r.guilly!.findings.map((f) => f.code)).toContain('mass_emptying')
  })

  it('no card for a native league, or for an imported league that is not Guilly', async () => {
    h.league = { ...h.league, platform: 'allfantasy' }
    expect((await load()).guilly).toBeNull()
    h.league = { ...h.league, platform: 'sleeper', leagueType: 'redraft', settings: {} }
    expect((await load()).guilly).toBeNull()
  })
})

describe('the card', () => {
  it('says the provider chops it, lists each chop by team, and how many are alive', async () => {
    const html = renderToStaticMarkup(<LeagueSync data={await load()} manageHref="/connections" />)
    expect(html).toContain('data-testid="league-sync-guilly"')
    expect(html).toContain('Chops come from Sleeper')
    expect(html).toContain('Looks right · 2 alive')
    expect(html).toMatch(/league-sync-guilly-chop-1"[^]*Daggers/)
    expect(html).toMatch(/league-sync-guilly-chop-2"[^]*Cleavers/)
  })

  it('a stale read shows as something to check', async () => {
    h.league = { ...h.league, lastSyncedAt: new Date('2026-10-28T12:00:00Z') }
    const html = renderToStaticMarkup(<LeagueSync data={await load()} manageHref="/connections" />)
    expect(html).toContain('Needs a look')
    expect(html).toContain('data-testid="league-sync-guilly-stale_read"')
  })

  it('a league without the card renders none', async () => {
    h.league = { ...h.league, leagueType: 'redraft', settings: {} }
    expect(renderToStaticMarkup(<LeagueSync data={await load()} manageHref="/connections" />)).not.toContain('league-sync-guilly')
  })
})
