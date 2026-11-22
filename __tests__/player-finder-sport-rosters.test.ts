import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The Player Finder home was football-only for a multi-sport manager: every NBA / NHL / college league
 * on Fantrax or AF-native was "on a platform we can't read yet". sportRosterTranslate.ts now reads those
 * rosters through PlayerIdentityMap into catalog players. Pinned here:
 *
 *   - the Fantrax → identity → Rolling Insights chain, and the CFBD fallback college football needs;
 *   - an ambiguous or unknown id is DROPPED AND COUNTED, never read raw;
 *   - a native roster's own catalog ids; a platform with no link stays unsupported;
 *   - the keys carry their sport, so two sports' identical provider numbers never merge.
 *
 * ⚠ The mocks FILTER BY EVERY FIELD ASKED. A mock that ignored `sport` or `source` would let a
 * translator that forgot to scope its reads pass.
 */

const mockIdentityFindMany = vi.hoisted(() => vi.fn())
const mockSportsPlayerFindMany = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: { findMany: mockIdentityFindMany },
    sportsPlayer: { findMany: mockSportsPlayerFindMany },
  },
}))

import { translateSportRosters } from '@/lib/core-app/sportRosterTranslate'
import {
  isSportPlayerKey,
  parseSportPlayerKey,
  rosterIdRouteFor,
  sportPlayerKey,
} from '@/lib/core-app/sportRosterKey'
import { homeSportTabs } from '@/lib/core-app/finderHomeSports'

type Identity = { sport: string; fantraxId?: string | null; espnId?: string | null; rollingInsightsId?: string | null; cfbdId?: string | null; sleeperNbaId?: string | null }
type Catalog = { sport: string; source: string; externalId: string; name: string; position: string | null; team: string | null; imageUrl: string | null; sleeperId?: string | null }

const IDENTITIES: Identity[] = [
  { sport: 'NHL', fantraxId: '04yla', rollingInsightsId: '9001' },
  { sport: 'NHL', fantraxId: '04a9v', rollingInsightsId: '9002' },
  // Two identities under one Fantrax id — ambiguous, must be dropped.
  { sport: 'NHL', fantraxId: 'dupe1', rollingInsightsId: '9100' },
  { sport: 'NHL', fantraxId: 'dupe1', rollingInsightsId: '9101' },
  // College football: CFBD id only.
  { sport: 'NCAAF', fantraxId: '06k5m', cfbdId: 'c-55', rollingInsightsId: null },
  // NBA with the same Rolling Insights number as an NHL player: keys must not merge.
  { sport: 'NBA', fantraxId: '05qu0', rollingInsightsId: '9001' },
]

const CATALOG: Catalog[] = [
  { sport: 'NHL', source: 'rolling_insights', externalId: '9001', name: 'Adrian Kempe', position: 'RW', team: 'LA', imageUrl: 'https://img/kempe.png' },
  { sport: 'NHL', source: 'rolling_insights', externalId: '9002', name: 'Second Skater', position: 'C', team: 'NYR', imageUrl: null },
  { sport: 'NHL', source: 'rolling_insights', externalId: '9100', name: 'Dupe A', position: 'D', team: 'BOS', imageUrl: null },
  { sport: 'NCAAF', source: 'cfbd', externalId: 'c-55', name: 'Anthony Evans III', position: 'WR', team: 'MSST', imageUrl: null },
  { sport: 'NBA', source: 'rolling_insights', externalId: '9001', name: 'Anthony Davis', position: 'F', team: 'DAL', imageUrl: null },
  { sport: 'NBA', source: 'rolling_insights', externalId: '777', name: 'Native Guard', position: 'G', team: 'BOS', imageUrl: null },
  { sport: 'NBA', source: 'sleeper', externalId: 'nba-55', name: 'Sleeper Hooper', position: 'C', team: 'MIA', imageUrl: null, sleeperId: '55' },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockIdentityFindMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    const sport = where.sport as string
    const [column, cond] = Object.entries(where).find(([k]) => k !== 'sport')! as [keyof Identity, { in: string[] }]
    return IDENTITIES.filter((r) => r.sport === sport && cond.in.includes(String(r[column] ?? '')))
  })
  mockSportsPlayerFindMany.mockImplementation(async ({ where }: { where: { sport: string; source?: string; externalId?: { in: string[] }; sleeperId?: { in: string[] } } }) =>
    CATALOG.filter(
      (r) =>
        r.sport === where.sport &&
        (where.source == null || r.source === where.source) &&
        (where.externalId == null || where.externalId.in.includes(r.externalId)) &&
        (where.sleeperId == null || where.sleeperId.in.includes(String(r.sleeperId ?? ''))),
    ),
  )
})

describe('sportRosterKey', () => {
  it('mints a sport-qualified key that cannot be mistaken for a Sleeper id', () => {
    const key = sportPlayerKey('nhl', 'Rolling_Insights', '9001')
    expect(key).toBe('NHL|rolling_insights|9001')
    expect(isSportPlayerKey(key)).toBe(true)
    expect(isSportPlayerKey('4046')).toBe(false)
    expect(isSportPlayerKey('KC')).toBe(false)
    expect(parseSportPlayerKey(key)).toEqual({ sport: 'NHL', source: 'rolling_insights', externalId: '9001' })
    expect(parseSportPlayerKey('nope')).toBeNull()
  })

  it('routes each platform to its id column, and leaves NFL and unlinked platforms alone', () => {
    expect(rosterIdRouteFor('fantrax', 'NHL')).toEqual({ kind: 'identity', column: 'fantraxId' })
    expect(rosterIdRouteFor('manual', 'NBA')).toEqual({ kind: 'catalog' })
    expect(rosterIdRouteFor('sleeper', 'NBA')).toEqual({ kind: 'sleeperCatalog' })
    expect(rosterIdRouteFor('espn', 'NBA')).toEqual({ kind: 'identity', column: 'espnId' })
    expect(rosterIdRouteFor('yahoo', 'NBA')).toBeNull()
    expect(rosterIdRouteFor('fantrax', 'NFL')).toBeNull()
    expect(rosterIdRouteFor('sleeper', null)).toBeNull()
  })
})

describe('translateSportRosters', () => {
  it('reads a Fantrax NHL roster through the identity map, slot by slot', async () => {
    const out = await translateSportRosters(
      [{ id: 'HOCKEY', sport: 'NHL', platform: 'fantrax' }],
      new Map([['HOCKEY', { starters: ['04yla', '0'], players: ['04yla', '04a9v'] }]]),
    )
    const r = out.rosters.get('HOCKEY')!
    expect(r.starters).toEqual(['NHL|rolling_insights|9001'])
    expect(r.players).toEqual(['NHL|rolling_insights|9001', 'NHL|rolling_insights|9002'])
    expect(r.unidentified).toBe(0)
    expect(out.catalog.get('NHL|rolling_insights|9001')).toMatchObject({ name: 'Adrian Kempe', team: 'LA', imageUrl: 'https://img/kempe.png' })
    // Every read was scoped to the league's sport.
    for (const [args] of mockIdentityFindMany.mock.calls) expect(args.where.sport).toBe('NHL')
    for (const [args] of mockSportsPlayerFindMany.mock.calls) expect(args.where.sport).toBe('NHL')
  })

  it('drops an ambiguous or unknown id and counts it — never reads it raw', async () => {
    const out = await translateSportRosters(
      [{ id: 'HOCKEY', sport: 'NHL', platform: 'fantrax' }],
      new Map([['HOCKEY', { starters: ['dupe1', 'zzzzz'], players: ['dupe1', 'zzzzz', '04yla'] }]]),
    )
    const r = out.rosters.get('HOCKEY')!
    expect(r.starters).toEqual([])
    expect(r.players).toEqual(['NHL|rolling_insights|9001'])
    expect(r.unidentified).toBe(2)
    expect(r.total).toBe(3)
    expect(out.catalog.has('NHL|rolling_insights|9100')).toBe(false)
  })

  it('falls back to the CFBD row for college football', async () => {
    const out = await translateSportRosters([{ id: 'CFB', sport: 'NCAAF', platform: 'fantrax' }], new Map([['CFB', { starters: ['06k5m'] }]]))
    expect(out.rosters.get('CFB')!.starters).toEqual(['NCAAF|cfbd|c-55'])
    expect(out.catalog.get('NCAAF|cfbd|c-55')?.name).toBe('Anthony Evans III')
  })

  it('keeps two sports apart when their provider numbers collide', async () => {
    const out = await translateSportRosters(
      [
        { id: 'HOCKEY', sport: 'NHL', platform: 'fantrax' },
        { id: 'HOOPS', sport: 'NBA', platform: 'fantrax' },
      ],
      new Map([
        ['HOCKEY', { starters: ['04yla'] }],
        ['HOOPS', { starters: ['05qu0'] }],
      ]),
    )
    expect(out.rosters.get('HOCKEY')!.starters).toEqual(['NHL|rolling_insights|9001'])
    expect(out.rosters.get('HOOPS')!.starters).toEqual(['NBA|rolling_insights|9001'])
    expect(out.catalog.get('NHL|rolling_insights|9001')?.name).toBe('Adrian Kempe')
    expect(out.catalog.get('NBA|rolling_insights|9001')?.name).toBe('Anthony Davis')
  })

  it('reads a native roster by its own catalog ids, and a Sleeper NBA roster by that sport’s Sleeper numbers', async () => {
    const out = await translateSportRosters(
      [
        { id: 'NATIVE', sport: 'NBA', platform: 'manual' },
        { id: 'SLP', sport: 'NBA', platform: 'sleeper' },
      ],
      new Map([
        ['NATIVE', { starters: ['777', 'not-an-id'] }],
        ['SLP', { starters: ['55'] }],
      ]),
    )
    expect(out.rosters.get('NATIVE')!.starters).toEqual(['NBA|rolling_insights|777'])
    expect(out.rosters.get('NATIVE')!.unidentified).toBe(1)
    expect(out.rosters.get('SLP')!.starters).toEqual(['NBA|sleeper|nba-55'])
    expect(mockIdentityFindMany).not.toHaveBeenCalled()
  })

  it('marks a platform with no id link unsupported, and never touches NFL leagues', async () => {
    const out = await translateSportRosters(
      [
        { id: 'YH', sport: 'NBA', platform: 'yahoo' },
        { id: 'FOOT', sport: 'NFL', platform: 'sleeper' },
      ],
      new Map([
        ['YH', { starters: ['1'] }],
        ['FOOT', { starters: ['4046'] }],
      ]),
    )
    expect([...out.unsupported]).toEqual(['YH'])
    expect(out.rosters.size).toBe(0)
    expect(mockSportsPlayerFindMany).not.toHaveBeenCalled()
  })
})

describe('homeSportTabs', () => {
  it('lists only the sports your leagues are in, in the finder order, with All first', () => {
    const tabs = homeSportTabs(
      [
        { sport: 'NCAAB', leagues: 2 },
        { sport: 'NFL', leagues: 70 },
        { sport: 'NHL', leagues: 1 },
        { sport: 'NBA', leagues: 7 },
      ],
      'nba',
    )
    expect(tabs.map((t) => t.id)).toEqual(['ALL', 'NFL', 'NBA', 'NHL', 'NCAAB'])
    expect(tabs[0]).toMatchObject({ leagues: 80, href: '/core/players', active: false })
    expect(tabs.find((t) => t.id === 'NBA')).toMatchObject({ active: true, href: '/core/players?sport=NBA' })
  })

  it('shows nothing for a single-sport account, and falls back to All for a sport you are not in', () => {
    expect(homeSportTabs([{ sport: 'NFL', leagues: 12 }], null)).toEqual([])
    const tabs = homeSportTabs([{ sport: 'NFL', leagues: 3 }, { sport: 'NBA', leagues: 1 }], 'MLB')
    expect(tabs.find((t) => t.active)?.id).toBe('ALL')
  })

  it('keeps a held league on every tab', () => {
    const tabs = homeSportTabs([{ sport: 'NFL', leagues: 3 }, { sport: 'NHL', leagues: 1 }], null, { leagueId: 'L 1' })
    expect(tabs.map((t) => t.href)).toEqual(['/core/players?league=L+1', '/core/players?sport=NFL&league=L+1', '/core/players?sport=NHL&league=L+1'])
  })
})
