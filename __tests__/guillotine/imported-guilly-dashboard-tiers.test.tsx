/**
 * The league dashboard's Guilly standings for an IMPORTED league (lib/league/league-dashboard-view.ts):
 * the tiers come from the provider's scores (lib/guillotine/importedGuillyView.ts `importedGuillyTiers`),
 * keyed back to our LeagueTeam ids, with the chopped teams marked and listed last
 * (app/league/[leagueId]/components/LeagueManagersStandingsSection.tsx).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const h = vi.hoisted(() => ({
  tab: null as unknown,
  nativeTiers: vi.fn(async () => ({ rows: [] as unknown[] })),
  tabLoads: 0,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: {
      findMany: vi.fn(async () => [
        { id: 'team-a', externalId: '1' },
        { id: 'team-b', externalId: '2' },
        { id: 'team-c', externalId: '3' },
        { id: 'team-d', externalId: '4' },
      ]),
      count: vi.fn(async () => 0),
    },
  },
}))
vi.mock('@/lib/guillotine/importedGuillyHealthLoad', () => ({
  loadImportedGuillyTab: vi.fn(async () => {
    h.tabLoads += 1
    return h.tab
  }),
}))
vi.mock('@/lib/guillotine/chopWatchLoad', () => ({ getLiveDangerTiers: h.nativeTiers }))
vi.mock('@/lib/zombie/rosterTeamMap', () => ({ getRosterTeamMap: vi.fn(async () => ({ rosterIdToTeamId: new Map() })) }))
vi.mock('@/lib/promotion-relegation/DivisionResolver', () => ({ listDivisionsByLeague: vi.fn(async () => []) }))
vi.mock('@/lib/scoring-defaults/LeagueScoringConfigResolver', () => ({ getLeagueScoringConfig: vi.fn(async () => null) }))

import { buildLeagueDashboardView } from '@/lib/league/league-dashboard-view'
import { buildImportedGuillyView } from '@/lib/guillotine/importedGuillyView'
import { LeagueManagersStandingsSection } from '@/app/league/[leagueId]/components/LeagueManagersStandingsSection'
import type { League } from '@prisma/client'

const row = (week: number, rosterId: string, pointsFor: number) => ({ week, rosterId, pointsFor, matchupId: null })
const TEAMS = [{ rosterId: '1', name: 'Axes' }, { rosterId: '2', name: 'Blades' }, { rosterId: '3', name: 'Cleavers' }, { rosterId: '4', name: 'Daggers' }]
/** Daggers chopped after week 1, Cleavers after week 2; week 3: Axes 50, Blades 40. */
const ROWS = [
  row(1, '1', 110), row(1, '2', 100), row(1, '3', 90), row(1, '4', 80),
  row(2, '1', 105), row(2, '2', 95), row(2, '3', 70), row(2, '4', 0),
  row(3, '1', 50), row(3, '2', 40), row(3, '3', 0), row(3, '4', 0),
]

const league = (over: Partial<League> = {}) =>
  ({
    id: 'L', platform: 'sleeper', leagueType: 'guillotine', guillotineMode: null, leagueVariant: null,
    settings: { leagueTypeConfirmation: { type: 'guillotine' } }, sport: 'NFL', ...over,
  }) as unknown as League

beforeEach(() => {
  h.tab = { platform: 'sleeper', view: buildImportedGuillyView({ rows: ROWS, teams: TEAMS }), check: { status: 'ok', attention: 0, format: 'confirmed' }, lastReadAt: null }
  h.nativeTiers.mockClear()
  h.tabLoads = 0
})

describe('the dashboard view', () => {
  it('an imported Guilly league gets Guilly standings, tiered from the provider’s scores by our team ids', async () => {
    const view = await buildLeagueDashboardView(league())
    expect(view.standings).toEqual({
      mode: 'guillotine',
      dangerByTeamId: { 'team-a': 'danger', 'team-b': 'chop_zone', 'team-c': 'chopped', 'team-d': 'chopped' },
    })
    expect(h.nativeTiers).not.toHaveBeenCalled()
  })

  it('an older import still flagged guillotineMode takes the imported read, not the native engine', async () => {
    const view = await buildLeagueDashboardView(league({ guillotineMode: true, leagueType: 'redraft', settings: {} }))
    expect(view.standings).toMatchObject({ mode: 'guillotine', dangerByTeamId: { 'team-b': 'chop_zone' } })
    expect(h.nativeTiers).not.toHaveBeenCalled()
  })

  it('a failed read still shows Guilly standings, untiered', async () => {
    h.tab = null
    expect((await buildLeagueDashboardView(league())).standings).toEqual({ mode: 'guillotine', dangerByTeamId: {} })
  })

  it('a native Guilly league keeps the native engine; an imported redraft league is untouched', async () => {
    await buildLeagueDashboardView(league({ platform: 'allfantasy', guillotineMode: true }))
    expect(h.nativeTiers).toHaveBeenCalledTimes(1)
    expect(h.tabLoads).toBe(0)
    expect((await buildLeagueDashboardView(league({ leagueType: 'redraft', settings: {} }))).standings).toEqual({ mode: 'standard' })
    expect(h.tabLoads).toBe(0)
  })
})

describe('the standings card', () => {
  const slot = (id: string, teamName: string) => ({
    id, teamName, ownerName: teamName, avatarUrl: null, wins: 0, losses: 0, ties: 0, isOrphan: false,
    faabRemaining: null, waiverPriority: null, role: null,
  })
  it('chop zone first, then danger, safe, and the chopped last with their own badge', () => {
    const html = renderToStaticMarkup(
      <LeagueManagersStandingsSection
        league={{ id: 'L', status: 'in_season' } as never}
        leagueId="L"
        teams={[slot('team-c', 'Cleavers'), slot('team-a', 'Axes'), slot('team-d', 'Daggers'), slot('team-b', 'Blades'), slot('team-e', 'Edges')] as never}
        seasonSnapshot={null}
        standingsPresentation={{ mode: 'guillotine', dangerByTeamId: { 'team-a': 'danger', 'team-b': 'chop_zone', 'team-c': 'chopped', 'team-d': 'chopped', 'team-e': 'safe' } }}
      />,
    )
    const order = ['Blades', 'Axes', 'Edges', 'Cleavers', 'Daggers'].map((n) => html.indexOf(`>${n}<`))
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toMatch(/>Blades<[^]*>Chop zone</)
    expect(html).toMatch(/>Axes<[^]*>In danger</)
    expect(html).toMatch(/>Cleavers<[^]*>Chopped</)
    expect(html.split('>Chopped<').length - 1).toBe(2)
  })
})
