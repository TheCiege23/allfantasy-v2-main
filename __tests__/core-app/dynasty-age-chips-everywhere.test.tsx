/**
 * Dynasty age chips beyond My Team (2026-11-05): the player card header, the Waivers "Worth adding"
 * board and Player Finder results — plus the violet PROSPECT tag for devy / C2C college prospects.
 *
 * Pins: the builder's prospect rules (tagged without an age row, never also ROOKIE, the devy section
 * and the college-sport rule, a college-only league tags nobody); ONE batched read per screen (one
 * `findMany`, widened by an OR — never a second query); each surface draws chips in a dynasty league
 * and nothing in any other, in English and Spanish.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: lang.language, t: (k: string) => k, tInterpolate: (k: string) => k }),
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/players',
}))
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>
      {children}
    </a>
  ),
}))
vi.mock('@/components/core-app/highlights/PlayerRecentClips', () => ({ default: () => null }))

import {
  buildDynastyRosterMarkers,
  isCollegeProspect,
  isDevyFormatLeague,
  markerKeyFor,
  prospectIdsOf,
  type DynastyRosterMarker,
  type MarkerRow,
} from '@/lib/core-app/dynastyRosterMarkers'
import { readDynastyMarkers, readFinderDynastyMarkers } from '@/lib/core-app/dynastyMarkerRead'
import { DynastyAgeKey, DynastyMarkersScope, DynastyRowMarkers } from '@/components/core-app/screens/DynastyRosterMarkers'
import { WaiverLineupBoard } from '@/components/core-app/WaiverLineupBoard'
import PlayerFinder from '@/components/core-app/screens/PlayerFinder'
import PlayerCardSheet from '@/components/core-app/player-card/PlayerCardSheet'
import type { PlayerCardData } from '@/lib/core-app/playerCard'
import type { PlayerMatch } from '@/lib/core-app/playerFinder'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  lang.language = 'en'
})

const row = (over: Partial<MarkerRow>): MarkerRow => ({ sleeperId: '1', name: 'Jalen Example', position: 'WR', age: 25, yearsExp: 3, ...over })
const chips = (c: HTMLElement) => c.querySelectorAll('[data-testid=dynasty-row-markers]')

/* ── the builder ─────────────────────────────────────────────────────────── */

describe('prospects in the builder', () => {
  it('tags a devy prospect even with no age row, and never also ROOKIE', () => {
    const out = buildDynastyRosterMarkers(
      [{ sleeperId: 'p1', name: 'College Star', position: 'QB' }, { sleeperId: 'p2', name: 'Campus Back', position: 'RB' }],
      [row({ sleeperId: 'p2', name: 'Campus Back', position: 'RB', age: 20, yearsExp: 0 })],
      'NFL',
      { prospectIds: new Set(['p1', 'p2']) },
    )
    expect(out.p1).toEqual({ age: null, tone: null, agingFrom: 34, rookie: false, prospect: true })
    expect(out.p2).toMatchObject({ age: 20, tone: 'rising', rookie: false, prospect: true })
  })

  it('a pro marker keeps its old shape — no `prospect` key at all', () => {
    const out = buildDynastyRosterMarkers([{ sleeperId: '1', name: 'Jalen Example', position: 'WR' }], [row({})], 'NFL', { prospectIds: new Set(['x']) })
    expect(out['1']).toEqual({ age: 25, tone: 'prime', agingFrom: 29, rookie: false })
  })

  it('still refuses a same-id row under another name, prospect or not', () => {
    const out = buildDynastyRosterMarkers([{ sleeperId: 'p1', name: 'College Star', position: 'QB' }], [row({ sleeperId: 'p1', name: 'Someone Else', age: 33 })], 'NFL', {
      prospectIds: new Set(['p1']),
    })
    expect(out.p1).toMatchObject({ age: null, prospect: true })
  })

  it('reads the devy section from both places a roster stores it', () => {
    expect([...prospectIdsOf({ devy: ['a', 7, { id: 'b' }], players: ['a', 'b', 'c'] })].sort()).toEqual(['7', 'a', 'b'])
    expect([...prospectIdsOf({ lineup_sections: { devy: [{ id: 'd' }, 'e'] } })].sort()).toEqual(['d', 'e'])
    expect(prospectIdsOf(null).size).toBe(0)
  })

  it('a college player is a prospect only in a pro league; a college-only league tags nobody', () => {
    expect(isCollegeProspect('NCAAF', 'NFL')).toBe(true)
    expect(isCollegeProspect('ncaab', 'NBA')).toBe(true)
    expect(isCollegeProspect('NCAAF', 'NCAAF')).toBe(false)
    expect(isCollegeProspect('NFL', 'NFL')).toBe(false)
    expect(isDevyFormatLeague({ leagueVariant: 'devy_dynasty' })).toBe(true)
    expect(isDevyFormatLeague({ leagueType: 'C2C' })).toBe(true)
    expect(isDevyFormatLeague({ leagueVariant: 'dynasty', leagueType: 'dynasty' })).toBe(false)
    expect(markerKeyFor({ sleeperId: null, sport: 'ncaaf', externalId: '42' })).toBe('NCAAF:42')
    expect(markerKeyFor({ sleeperId: '9', sport: 'NFL', externalId: '42' })).toBe('9')
  })
})

/* ── one batched read per screen ─────────────────────────────────────────── */

describe('the batched read', () => {
  it('My Team / Waivers: ONE findMany for every player, widened by an OR for prospects', async () => {
    const findMany = vi.fn(async () => [
      { sleeperId: '1', name: 'Jalen Example', position: 'WR', age: 22, yearsExp: 0 },
      { sleeperId: 'p1', name: 'College Star', position: 'QB', age: 20, yearsExp: null },
    ])
    const out = await readDynastyMarkers({ sportsPlayer: { findMany } } as never, {
      sport: 'nfl',
      players: [{ sleeperId: '1', name: 'Jalen Example', position: 'WR' }, { sleeperId: 'p1', name: 'College Star', position: 'QB' }, { sleeperId: '1', name: 'Jalen Example', position: 'WR' }],
      prospectIds: new Set(['p1']),
    })
    expect(findMany).toHaveBeenCalledTimes(1)
    const where = (findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where
    expect(where).toEqual({ OR: [{ sport: 'NFL', sleeperId: { in: ['1', 'p1'] } }, { sport: 'NCAAF', sleeperId: { in: ['p1'] } }] })
    expect(out?.['1']).toMatchObject({ age: 22, rookie: true })
    expect(out?.p1).toMatchObject({ age: 20, prospect: true })
  })

  it('no prospects: the plain one-sport query; nobody to mark: no query at all', async () => {
    const findMany = vi.fn(async () => [])
    await readDynastyMarkers({ sportsPlayer: { findMany } } as never, { sport: 'NFL', players: [{ sleeperId: '1', name: 'A B', position: 'WR' }] })
    expect((findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toEqual({ sport: 'NFL', sleeperId: { in: ['1'] } })
    findMany.mockClear()
    expect(await readDynastyMarkers({ sportsPlayer: { findMany } } as never, { sport: 'NFL', players: [] })).toBeNull()
    expect(findMany).not.toHaveBeenCalled()
  })

  it('Player Finder: one read; pro matches by Sleeper id, college matches (devy league) by their own id', async () => {
    const findMany = vi.fn(async () => [
      { sleeperId: '1', externalId: 'x1', sport: 'NFL', name: 'Jalen Example', position: 'WR', age: 31, yearsExp: 8 },
      { sleeperId: null, externalId: '77', sport: 'NCAAF', name: 'Campus Star', position: 'QB', age: 19, yearsExp: null },
    ])
    const matches = [
      { sleeperId: '1', externalId: 'x1', sport: 'NFL', name: 'Jalen Example', position: 'WR' },
      { sleeperId: null, externalId: '77', sport: 'NCAAF', name: 'Campus Star', position: 'QB' },
      { sleeperId: null, externalId: '5', sport: 'NBA', name: 'Hoops Guy', position: 'G' },
    ]
    const out = await readFinderDynastyMarkers({ sportsPlayer: { findMany } } as never, { league: { sport: 'NFL', leagueVariant: 'devy_dynasty' }, matches })
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(out?.['1']).toMatchObject({ age: 31, tone: 'aging' })
    expect(out?.['NCAAF:77']).toMatchObject({ age: 19, prospect: true })
    expect(Object.keys(out ?? {})).toHaveLength(2)

    // A plain dynasty league: the college match is not a prospect there, and is not even read.
    findMany.mockClear()
    await readFinderDynastyMarkers({ sportsPlayer: { findMany } } as never, { league: { sport: 'NFL', leagueVariant: 'dynasty' }, matches })
    expect((findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toEqual({ sport: 'NFL', sleeperId: { in: ['1'] } })
  })
})

/* ── the chips ───────────────────────────────────────────────────────────── */

const MARKERS: Record<string, DynastyRosterMarker> = {
  '9493': { age: 22, tone: 'rising', agingFrom: 29, rookie: true },
  '1': { age: 31, tone: 'aging', agingFrom: 27, rookie: false },
  pro: { age: 20, tone: 'rising', agingFrom: 34, rookie: false, prospect: true },
}

describe('PROSPECT tag and key', () => {
  it('draws a violet PROSPECT tab instead of ROOKIE, and the key names it only when one is on screen', () => {
    const { container } = render(
      <DynastyMarkersScope markers={MARKERS}>
        <DynastyAgeKey />
        <DynastyRowMarkers sleeperId="pro" />
      </DynastyMarkersScope>,
    )
    const tag = container.querySelector('[data-testid=dynasty-row-markers] .af-mt-dyn-prospect')
    expect(tag?.textContent).toBe('Prospect')
    expect(container.querySelector('[data-testid=dynasty-row-markers] .af-mt-dyn-rookie')).toBeNull()
    expect(container.querySelector('[data-testid=dynasty-age-key]')?.textContent).toContain('College prospect')
    cleanup()
    const plain = render(
      <DynastyMarkersScope markers={{ '1': MARKERS['1'] }}>
        <DynastyAgeKey />
      </DynastyMarkersScope>,
    )
    expect(plain.container.textContent).not.toContain('College prospect')
  })

  it('speaks Spanish', () => {
    lang.language = 'es'
    const { container } = render(
      <DynastyMarkersScope markers={MARKERS}>
        <DynastyAgeKey />
        <DynastyRowMarkers sleeperId="pro" />
      </DynastyMarkersScope>,
    )
    expect(container.querySelector('.af-mt-dyn-prospect')?.textContent).toBe('Prospecto')
    expect(container.textContent).toContain('Prospecto universitario')
  })
})

/* ── Waivers: the "Worth adding" board ───────────────────────────────────── */

const BOARD = {
  state: 'ok',
  season: '2026',
  week: 9,
  currentLineupPoints: 120,
  candidates: [
    { sleeperId: '9493', name: 'Puka Nacua', position: 'WR', team: 'LAR', projectedPoints: 16, gain: 6.1, displaces: null, basis: 'projection' },
    { sleeperId: '1', name: 'Someone Else', position: 'RB', team: 'SF', projectedPoints: 9, gain: 2, displaces: null, basis: 'projection' },
  ],
  notes: [],
}

function stubBoard(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: String(url).includes('view=waiver-board'), json: async () => payload })) as never)
}

describe('Waivers — Worth adding', () => {
  it('dynasty: an age chip and ROOKIE beside each marked name', async () => {
    stubBoard({ ...BOARD, dynastyMarkers: { '9493': MARKERS['9493'], '1': MARKERS['1'] } })
    const { container } = render(<WaiverLineupBoard leagueId="dyn" />)
    await waitFor(() => expect(chips(container)).toHaveLength(2))
    const first = container.querySelector('[data-wlb-player="9493"]')!
    expect(first.querySelector('.af-dyn-name-line .af-wlb-name')?.textContent).toContain('Puka Nacua')
    expect(first.querySelector('.af-mt-dyn-age')?.textContent).toBe('22')
    expect(first.querySelector('.af-mt-dyn-rookie')?.textContent).toBe('Rookie')
    expect(container.querySelector('[data-wlb-player="1"] .af-mt-dyn-age')?.getAttribute('data-tone')).toBe('aging')
  })

  it('any other league: no chips, and the name is not wrapped', async () => {
    stubBoard(BOARD)
    const { container } = render(<WaiverLineupBoard leagueId="redraft" />)
    await waitFor(() => expect(container.querySelector('[data-testid=waiver-lineup-board]')).not.toBeNull())
    expect(chips(container)).toHaveLength(0)
    expect(container.querySelector('.af-dyn-name-line')).toBeNull()
  })

  it('Spanish', async () => {
    lang.language = 'es'
    stubBoard({ ...BOARD, dynastyMarkers: { '9493': MARKERS['9493'] } })
    const { container } = render(<WaiverLineupBoard leagueId="dyn" />)
    await waitFor(() => expect(chips(container)).toHaveLength(1))
    expect(container.querySelector('.af-mt-dyn-rookie')?.textContent).toBe('Novato')
  })
})

/* ── Player Finder results ───────────────────────────────────────────────── */

const MATCHES: PlayerMatch[] = [
  { externalId: 'x1', sleeperId: '9493', name: 'Puka Nacua', position: 'WR', team: 'LAR', imageUrl: null, number: null, rosteredIn: null, platforms: [], sport: 'NFL' },
  { externalId: '77', sleeperId: null, name: 'Campus Star', position: 'QB', team: 'TEX', imageUrl: null, number: null, rosteredIn: null, platforms: [], sport: 'NCAAF' },
  { externalId: 'x2', sleeperId: '5', name: 'Unmarked Guy', position: 'TE', team: 'KC', imageUrl: null, number: null, rosteredIn: null, platforms: [], sport: 'NFL' },
]

const finder = (markers: Record<string, DynastyRosterMarker> | null) =>
  render(<PlayerFinder query="pu" matches={MATCHES} detail={null} leagueCount={1} selectedLeagueId="dyn" dynastyMarkers={markers} />)

describe('Player Finder results', () => {
  it('held dynasty league: chips on marked matches, PROSPECT on the college one, nothing on the rest', () => {
    const { container } = finder({ '9493': MARKERS['9493'], 'NCAAF:77': MARKERS.pro })
    const items = [...container.querySelectorAll('.af-pf-match-li')]
    expect(items).toHaveLength(3)
    expect(items[0].querySelector('.af-mt-dyn-rookie')?.textContent).toBe('Rookie')
    expect(items[1].querySelector('.af-mt-dyn-prospect')?.textContent).toBe('Prospect')
    expect(items[2].querySelector('[data-testid=dynasty-row-markers]')).toBeNull()
    expect(items[0].querySelector('.af-dyn-name-line .af-pf-match-name')?.textContent).toBe('Puka Nacua')
  })

  it('no dynasty league: no chips, names unwrapped', () => {
    const { container } = finder(null)
    expect(container.querySelectorAll('.af-pf-match-li')).toHaveLength(3)
    expect(chips(container)).toHaveLength(0)
    expect(container.querySelector('.af-dyn-name-line')).toBeNull()
  })

  it('Spanish', () => {
    lang.language = 'es'
    const { container } = finder({ 'NCAAF:77': MARKERS.pro })
    expect(container.querySelector('.af-mt-dyn-prospect')?.textContent).toBe('Prospecto')
  })
})

/* ── the player card ─────────────────────────────────────────────────────── */

const NO = (reason: string) => ({ available: false as const, reason })
function card(over: Partial<PlayerCardData> = {}): PlayerCardData {
  return {
    context: 'league',
    player: { externalId: 'ri:771', sleeperId: '9221', sport: 'NFL', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', number: 26, imageUrl: null },
    bio: { age: 24, height: null, weight: null, yearsExp: 2, college: null },
    market: NO('not priced'),
    ownership: NO('too few leagues'),
    schedule: NO('no fixtures'),
    byeWeek: null,
    trades: NO('no trades'),
    comps: NO('no comps'),
    news: NO('no news'),
    injury: NO('No injury designation reported in the last 14 days.'),
    injuryFeed: NO('No record of when this sport was last checked.'),
    insight: null,
    league: null,
    ...over,
  } as PlayerCardData
}
const mountCard = (data: PlayerCardData) => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })) as never)
  return render(
    <PlayerCardSheet subject={{ sport: 'NFL', sleeperId: '9221', name: 'Jahmyr Gibbs', position: 'RB' }} data={data} status="ready" onClose={() => {}} onOpen={() => {}} />,
  )
}

describe('player card header', () => {
  it('opened in a dynasty league: the age chip and ROOKIE in the meta line', () => {
    const { container } = mountCard(card({ dynastyMarker: { age: 21, tone: 'rising', agingFrom: 27, rookie: true } }))
    const meta = container.querySelector('.af-pc-meta')!
    expect(meta.querySelector('.af-mt-dyn-age')?.textContent).toBe('21')
    expect(meta.querySelector('.af-mt-dyn-rookie')?.textContent).toBe('Rookie')
  })

  it('a devy prospect: PROSPECT, in Spanish too', () => {
    lang.language = 'es'
    const { container } = mountCard(card({ dynastyMarker: { age: 19, tone: 'rising', agingFrom: 27, rookie: false, prospect: true } }))
    expect(container.querySelector('.af-pc-meta .af-mt-dyn-prospect')?.textContent).toBe('Prospecto')
  })

  it('any other league, or the universal card: nothing', () => {
    expect(chips(mountCard(card()).container)).toHaveLength(0)
    cleanup()
    expect(chips(mountCard(card({ dynastyMarker: null })).container)).toHaveLength(0)
  })
})
