/**
 * "Next man up": the depth-chart card — pure rules, the DB-first loader, and the section.
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type SlotRow = { leagueId: string; slot: string; isYours: boolean; owner: { teamName: string } | null }

const h = vi.hoisted(() => ({
  me: { rollingInsightsId: 'R10' } as { rollingInsightsId: string | null } | null,
  chart: [] as Array<{ team: string; position: string; players: unknown; fetchedAt: Date }>,
  maps: [] as Array<{ rollingInsightsId: string; sleeperId: string | null }>,
  own: [] as Array<{ externalId: string; sleeperId: string; source: string; fetchedAt: Date }>,
  sharing: [] as Array<{ externalId: string; sleeperId: string }>,
  leagues: [] as Array<{ id: string; name: string; platform: string; platformLeagueId: string | null; season: number }>,
  slots: new Map<string, { slots: SlotRow[]; unmatched: Array<{ leagueId: string }> } | 'fail'>(),
  resolve: vi.fn(),
  queryRaw: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: {
      findFirst: vi.fn(async () => h.me),
      findMany: vi.fn(async ({ where }: { where: { rollingInsightsId: { in: string[] } } }) => h.maps.filter((m) => where.rollingInsightsId.in.includes(m.rollingInsightsId))),
    },
    sportsPlayer: {
      // Two reads: by sleeperId (his own rows), then by externalId (everyone who claims that id).
      findMany: vi.fn(async ({ where }: { where: { sleeperId?: { in?: string[] }; externalId?: { in: string[] } } }) =>
        where.externalId ? h.sharing.filter((r) => where.externalId!.in.includes(r.externalId)) : h.own.filter((r) => where.sleeperId!.in!.includes(r.sleeperId)),
      ),
    },
    league: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => h.leagues.filter((l) => where.id.in.includes(l.id))) },
    $queryRaw: h.queryRaw,
  },
}))
vi.mock('@/lib/core-app/playerFinder', () => ({ resolveLeagueSlots: h.resolve }))

import { parseDepthPlayers, pickDepthRow, presenceCells, slotLabel, BACKUP_CAP } from '@/lib/core-app/depthChart'
import { loadDepthChartView } from '@/lib/core-app/depthChartBackups'
import { DepthChartBackups } from '@/components/core-app/player-finder/DepthChartBackups'

const NOW = new Date('2026-09-28T12:00:00Z')
const p = (id: string, player: string) => ({ id, img: 'contact_support', number: 1, player, status: 'INACT', position: 'RB' })

beforeEach(() => {
  vi.clearAllMocks()
  h.me = { rollingInsightsId: 'R10' }
  h.chart = [{ team: 'BUF', position: 'RB', players: [p('R10', 'James Cook'), p('R11', 'Ray Davis'), p('R12', 'Ty Johnson')], fetchedAt: new Date('2026-09-23T04:18:00Z') }]
  h.maps = [
    { rollingInsightsId: 'R10', sleeperId: '8138' },
    { rollingInsightsId: 'R11', sleeperId: '11584' },
    { rollingInsightsId: 'R12', sleeperId: '4000' },
  ]
  h.own = [
    { externalId: 'E11', sleeperId: '11584', source: 'rolling_insights', fetchedAt: new Date('2026-09-20') },
    { externalId: '11584', sleeperId: '11584', source: 'sleeper', fetchedAt: new Date('2026-09-27') },
    { externalId: 'E12', sleeperId: '4000', source: 'rolling_insights', fetchedAt: new Date('2026-09-20') },
  ]
  h.sharing = [
    { externalId: 'E11', sleeperId: '11584' },
    { externalId: 'E12', sleeperId: '4000' },
  ]
  h.leagues = [
    { id: 'L1', name: 'KBFL', platform: 'sleeper', platformLeagueId: '1180000000000000000', season: 2026 },
    { id: 'L2', name: 'Office Pool', platform: 'sleeper', platformLeagueId: '1190000000000000000', season: 2026 },
    { id: 'L3', name: 'Home', platform: 'espn', platformLeagueId: '555', season: 2026 },
  ]
  h.slots = new Map([
    ['11584', { slots: [{ leagueId: 'L1', slot: 'BENCH', isYours: true, owner: null }, { leagueId: 'L2', slot: 'NOT YOURS', isYours: false, owner: { teamName: 'Gridiron Gang' } }], unmatched: [{ leagueId: 'L3' }] }],
    ['4000', { slots: [], unmatched: [] }],
  ])
  h.queryRaw.mockImplementation(async () => h.chart)
  h.resolve.mockImplementation(async (sid: string) => {
    const got = h.slots.get(sid)
    if (got === 'fail') throw new Error('roster read failed')
    return got ?? { slots: [], unmatched: [] }
  })
})

const load = (over: Partial<Parameters<typeof loadDepthChartView>[0]> = {}) =>
  loadDepthChartView({ sleeperId: '8138', sport: 'NFL', userId: 'u1', leagueIds: ['L1', 'L2', 'L3'], now: NOW, ...over })

describe('depth chart rules (pure)', () => {
  it('parses the vendor rows, skipping malformed entries and stringifying numeric ids', () => {
    expect(parseDepthPlayers([p('1', 'A'), { id: 2, player: 'B' }, { id: '3' }, null, { id: '4', player: '  ' }])).toEqual([
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
    ])
    expect(parseDepthPlayers({ not: 'an array' })).toEqual([])
  })

  it('places him where he sits highest, then by the fixed slot order', () => {
    const rows = [
      { position: 'WR3', players: [{ id: 'x', name: 'X' }] },
      { position: 'WR1', players: [{ id: 'a', name: 'A' }, { id: 'x', name: 'X' }] },
      { position: 'WR2', players: [{ id: 'x', name: 'X' }] },
    ]
    expect(pickDepthRow(rows, 'x')).toMatchObject({ position: 'WR2', depth: 1 })
    expect(pickDepthRow(rows, 'nobody')).toBeNull()
  })

  it('names the split receiver rows as spots, not ranks', () => {
    expect(slotLabel('WR2')).toBe('WR spot 2')
    expect(slotLabel('RB')).toBe('RB')
  })

  it('an unreadable league is never free, and only a free league carries a claim link', () => {
    const claim = { href: '/x', external: false, platformLabel: 'Sleeper' } as never
    const cells = presenceCells(
      [{ id: 'A', name: 'Alpha' }, { id: 'B', name: 'Bravo' }, { id: 'C', name: 'Charlie' }, { id: 'D', name: 'Delta' }],
      [{ leagueId: 'A', slot: 'STARTER', isYours: true, owner: null } as never, { leagueId: 'B', slot: 'NOT YOURS', isYours: false, owner: { teamName: 'Rivals' } } as never],
      [{ leagueId: 'C' }],
      () => claim,
    )
    expect(cells.map((c) => [c.leagueName, c.state, c.detail, Boolean(c.claim)])).toEqual([
      ['Alpha', 'yours', 'starting', false],
      ['Bravo', 'other', 'Rivals', false],
      ['Charlie', 'unknown', null, false],
      ['Delta', 'free', null, true],
    ])
  })
})

describe('loadDepthChartView', () => {
  it('orders the chart, marks him, and maps vendor ids to Sleeper ids', async () => {
    const v = await load()
    expect(v).toMatchObject({ team: 'BUF', slot: 'RB', hisDepth: 1 })
    expect(v!.entries.map((e) => [e.depth, e.name, e.sleeperId, e.isHim])).toEqual([
      [1, 'James Cook', '8138', true],
      [2, 'Ray Davis', '11584', false],
      [3, 'Ty Johnson', '4000', false],
    ])
  })

  it('links a backup only through a ref that resolves back to him, preferring the vendor row', async () => {
    h.sharing.push({ externalId: 'E12', sleeperId: '9999' }) // another player also claims E12
    const v = await load()
    expect(v!.entries.find((e) => e.name === 'Ray Davis')!.ref).toBe('NFL:E11')
    expect(v!.entries.find((e) => e.name === 'Ty Johnson')!.ref).toBeNull()
  })

  it('a vendor id the identity map names twice gets no Sleeper id', async () => {
    h.maps.push({ rollingInsightsId: 'R12', sleeperId: '4001' })
    const v = await load()
    expect(v!.entries.find((e) => e.name === 'Ty Johnson')).toMatchObject({ sleeperId: null, ref: null })
  })

  it('reads presence per backup: yours, taken, unreadable, free with a claim link', async () => {
    const v = await load()
    const davis = v!.presence!['11584']
    expect(davis.map((c) => [c.leagueName, c.state, c.detail])).toEqual([
      ['Home', 'unknown', null],
      ['KBFL', 'yours', 'bench'],
      ['Office Pool', 'other', 'Gridiron Gang'],
    ])
    const johnson = v!.presence!['4000']
    expect(johnson.every((c) => c.state === 'free')).toBe(true)
    expect(johnson.find((c) => c.leagueName === 'KBFL')!.claim).not.toBeNull()
    expect(h.resolve).not.toHaveBeenCalledWith('8138', expect.anything(), expect.anything())
  })

  it('a failed roster read leaves that backup out rather than calling him free everywhere', async () => {
    h.slots.set('4000', 'fail')
    const v = await load()
    expect(v!.presence!['4000']).toBeUndefined()
    expect(v!.presence!['11584']).toBeDefined()
  })

  it('signed out: the chart alone, no roster reads', async () => {
    const v = await load({ userId: null, leagueIds: [] })
    expect(v!.entries).toHaveLength(3)
    expect(v!.presence).toBeNull()
    expect(h.resolve).not.toHaveBeenCalled()
  })

  it(`reads presence for at most ${BACKUP_CAP} players`, async () => {
    const ids = ['R10', 'R11', 'R12', 'R13', 'R14', 'R15']
    h.chart[0].players = ids.map((id) => p(id, `Player ${id}`))
    h.maps = ids.map((id, i) => ({ rollingInsightsId: id, sleeperId: i === 0 ? '8138' : `S${id}` }))
    await load()
    expect(h.resolve).toHaveBeenCalledTimes(BACKUP_CAP)
  })

  it('hides a stale chart, a non-NFL player, and a player with no vendor id', async () => {
    h.chart[0].fetchedAt = new Date('2026-09-01T00:00:00Z')
    expect(await load()).toBeNull()
    expect(await load({ sport: 'NBA' })).toBeNull()
    h.chart[0].fetchedAt = new Date('2026-09-23T04:18:00Z')
    h.me = null
    expect(await load()).toBeNull()
  })

  it('he is not on any fantasy chart: nothing', async () => {
    h.chart = []
    expect(await load()).toBeNull()
  })
})

describe('DepthChartBackups', () => {
  it('lists the chart, links the backups, and shows where each one is', async () => {
    const v = await load()
    render(<DepthChartBackups data={v} playerName="James Cook" hrefFor={(ref, name) => `/core/players?q=${name}&player=${ref}`} />)
    expect(screen.getByRole('heading', { name: 'Next man up · BUF RB' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ray Davis' }).getAttribute('href')).toBe('/core/players?q=Ray Davis&player=NFL:E11')
    expect(screen.queryByRole('link', { name: 'James Cook' })).toBeNull()
    expect(screen.getByText('this player')).toBeTruthy()
    expect(screen.getByText(/Taken/).parentElement!.textContent).toContain('Office Pool (Gridiron Gang)')
    expect(screen.getAllByRole('link', { name: /Claim Johnson in/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /Claim Davis/ })).toBeNull()
    expect(screen.getByText(/Depth chart as of Sep 23/)).toBeTruthy()
  })

  it('renders nothing without a chart to show', () => {
    const { container } = render(<DepthChartBackups data={null} playerName="X" hrefFor={() => '/'} />)
    expect(container.innerHTML).toBe('')
  })
})
