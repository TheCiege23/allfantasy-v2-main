/**
 * Player Finder's search-and-leagues subcomponents in Spanish (2026-10-05): the search box and its
 * suggestion chips (PlayerSearchBox, suggestionChip.ts), the compare card (PlayerCompare,
 * playerCompare.ts), the league picker (LeaguePicker), the league strip (LeagueStrip,
 * leagueStrip.ts), the phone's sticky bar (StickyActionBar, leagueViewActions.ts) and "available in
 * your leagues" (FreeAgentBids, freeAgentBids.ts).
 *
 * Every formatter value is REAL output: `suggestionChip`, `comparePlayers`, `buildLeagueStrip`,
 * `leagueViewActions`, and `loadFreeAgentBids` itself (prisma mocked, as player-finder-fa-bids does)
 * — so every note the loader writes reaches the screen the way production writes it. The loader's
 * notes are also held to its source file verbatim: a reworded note fails here rather than silently
 * staying English.
 *
 * Kept English on purpose, and cut out of the scan by root: the AF Pro lock and its "Free until"
 * note (`.af-core-lock`, `.af-core-free-until`) are CoreDepthLock's, shared by every gated surface
 * in the app — Player Finder's own lock (#2051) is English too. Provider text stays as written:
 * player, team and league names, and the platform names.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>
      {children}
    </a>
  ),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

/* The FA loader runs for real against a mocked database (the fixture of player-finder-fa-bids). */
const h = vi.hoisted(() => ({
  leagues: [] as Array<{ id: string; name: string; platform: string; platformLeagueId: string | null; season: number }>,
  facts: new Map<string, unknown>(),
  values: new Map<string, Map<string, { value: number; faabAnchor: number | null }>>(),
  room: [] as Array<{ leagueId: string; claims: number; median: number; p75: number }>,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => h.leagues.filter((l) => where.id.in.includes(l.id))) },
    $queryRaw: vi.fn(async () => h.room),
  },
}))
vi.mock('@/lib/decision-os/waiver/loader', () => ({ loadWaiverWorldFacts: vi.fn(async (_u: string, id: string) => h.facts.get(id) ?? null) }))
vi.mock('@/lib/core-app/playerDepth', () => ({
  loadLeagueValueMap: vi.fn(async (_ids: string[], leagueIds: string[]) => new Map(leagueIds.filter((id) => h.values.has(id)).map((id) => [id, h.values.get(id)!]))),
}))

import { PlayerSearchBox } from '@/components/core-app/player-finder/PlayerSearchBox'
import { PlayerCompare } from '@/components/core-app/player-finder/PlayerCompare'
import { LeaguePicker } from '@/components/core-app/player-finder/LeaguePicker'
import { LeagueStrip } from '@/components/core-app/player-finder/LeagueStrip'
import { StickyActionBar } from '@/components/core-app/player-finder/StickyActionBar'
import { FreeAgentBids } from '@/components/core-app/player-finder/FreeAgentBids'
import { buildLeagueStrip } from '@/lib/core-app/leagueStrip'
import { comparePlayers } from '@/lib/core-app/playerCompare'
import { BID_LEAGUE_CAP, loadFreeAgentBids } from '@/lib/core-app/freeAgentBids'
import { FA_NOTE_KEYS, compareHeadlineText, faNoteText } from '@/lib/core-app/finderSearchCopy'
import type { LeagueSlot, PlayerDetail } from '@/lib/core-app/playerFinder'
import type { LeagueImpact } from '@/lib/core-app/playerImpact'
import type { PlayerLeagueView } from '@/lib/core-app/playerLeagueView'

const EN_DAY = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/
const EN_MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/
/**
 * These components' own English, word by word. League, team and player names in the fixtures avoid
 * every one. Kept in the Spanish on purpose, so absent here: FAAB, p75, IR, TAXI, "best ball", "vs",
 * "Waiver Intel" (the help topic keeps the product name too) and the platform names.
 */
const OWN_EN =
  /\b(Search|Searches|Compare|another player|Suggestions|Players to compare|no team|on file|platform you|connected|One search|covers|Connect a league|slots|matchups|yours in|has him|owned|free in|leagues?|Swap|Clear|beats|priced|biggest|gap|Gap|split|projects?|standard|Standard|Nothing to price|Side by side|Neither|roster|Across|League|even|Start|over|here|Sign in|Points|minus|tile|someone else|unchecked|Proj|AF proj|Pos rank|Snap share|Age|Ready|Questionable|Leagues|All|of|Pick the|Filter|None|selected|Save|Saving|Could not|try again|Saved|device|ticked|Where he is|Yours|available|Available|elsewhere|can't|START|BENCH|FA|Taken|starting|bench|taxi squad|nobody|another manager|Free agent|Not readable|Trade for|Claim|Open in|Bid|left|winning|median|claims?|waiver|market value|bids|at a time|value chart|syncing|The bid|calibrate|engine|the table below|the room|his)\b/

/** The AF Pro lock is CoreDepthLock's, shared across the app; it stays whole English (see the header). */
const SHARED_ENGLISH = ['.af-core-lock', '.af-core-free-until']

/**
 * Visible text plus every title, aria-label and placeholder — the reader meets those too. The text
 * appears twice: as `textContent` (for phrase assertions) and node by node with a space between, since
 * `textContent` glues neighbouring elements together ("DragonesYours") and a glued word has no `\b`.
 */
function ownText(container: HTMLElement): string {
  const root = container.cloneNode(true) as HTMLElement
  for (const sel of SHARED_ENGLISH) root.querySelectorAll(sel).forEach((n) => n.remove())
  const attrs = [...root.querySelectorAll('[title],[aria-label],[placeholder]')].flatMap((n) => [
    n.getAttribute('title') ?? '',
    n.getAttribute('aria-label') ?? '',
    n.getAttribute('placeholder') ?? '',
  ])
  const nodes: string[] = []
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n.textContent ?? '')
  return [root.textContent ?? '', nodes.join(' '), ...attrs].join(' | ')
}

function expectSpanish(out: string, label: string) {
  expect(out, label).not.toMatch(EN_DAY)
  expect(out, label).not.toMatch(EN_MONTH)
  const hit = out.match(OWN_EN)
  expect(hit?.[0] ?? null, `${label}: …${hit ? out.slice(Math.max(0, hit.index! - 60), hit.index! + 60) : ''}…`).toBeNull()
}

afterEach(() => {
  cleanup()
  lang.language = 'en'
})

/* ── PlayerSearchBox ─────────────────────────────────────────────────────────────────────────── */

const hit = (name: string, presence: unknown, over: Record<string, unknown> = {}) => ({
  externalId: `ri-${name}`,
  sleeperId: `s-${name}`,
  name,
  sport: 'NFL',
  position: 'WR',
  team: 'KC',
  imageUrl: null,
  presence,
  ...over,
})
/** One hit per chip the box can show, and one with no team on file. */
const HITS = [
  hit('Rashee Rice', { yours: ['Dragones'], owned: [], free: [], unchecked: 0 }),
  hit('Xavier Worthy', { yours: ['Dragones', 'Oficina FC'], owned: [], free: [], unchecked: 0 }),
  hit('Hollywood Brown', { yours: [], owned: [{ leagueName: 'Oficina FC', ownerName: 'tashaR' }], free: [], unchecked: 0 }),
  hit('Skyy Moore', { yours: [], owned: [{ leagueName: 'Oficina FC', ownerName: null }], free: [], unchecked: 0 }),
  hit('JuJu Smith', { yours: [], owned: [{ leagueName: 'Oficina FC', ownerName: 'a' }, { leagueName: 'Dragones', ownerName: 'b' }], free: [], unchecked: 0 }),
  hit('Justin Watson', { yours: [], owned: [], free: ['Dragones'], unchecked: 0 }),
  hit('Kadarius Toney', { yours: [], owned: [], free: ['Dragones', 'Oficina FC'], unchecked: 1 }, { team: null, sport: 'NBA' }),
]

describe('PlayerSearchBox in Spanish', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => HITS })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function typeInto(name: string | RegExp) {
    fireEvent.change(screen.getByRole('combobox', { name }), { target: { value: 'ra' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350)
    })
  }

  it('the search box, its note and every suggestion chip read Spanish — signed in and out', async () => {
    lang.language = 'es'
    const { container, unmount } = render(<PlayerSearchBox query="" selectedLeagueId={null} signedIn />)
    await typeInto('Buscar cualquier jugador')
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeTruthy()
    expect(screen.getByRole('listbox', { name: 'Sugerencias' })).toBeTruthy()
    const out = ownText(container)
    expect(out).toContain('tuyo en Dragones')
    expect(out).toContain('tuyo en 2 ligas')
    expect(out).toContain('@tashaR lo tiene en Oficina FC')
    expect(out).toContain('con dueño en Oficina FC')
    expect(out).toContain('con dueño en 2 de tus ligas')
    expect(out).toContain('libre en Dragones')
    expect(out).toContain('libre en 2 ligas')
    expect(out).toContain('sin equipo registrado')
    expect(out).toContain('Busca a la vez en todas las plataformas que conectaste')
    expectSpanish(out, 'search box, signed in')
    unmount()

    const signedOut = render(<PlayerSearchBox query="Rashee" selectedLeagueId={null} signedIn={false} />)
    expect(ownText(signedOut.container)).toContain('Conecta una liga')
    expectSpanish(ownText(signedOut.container), 'search box, signed out')
  })

  it('the compare box reads Spanish', async () => {
    lang.language = 'es'
    const { container } = render(<PlayerSearchBox query="Rashee" selectedLeagueId={null} signedIn variant="compare" compareWith="NFL:ri-1" />)
    await typeInto('Comparar con otro jugador')
    expect(screen.getByRole('listbox', { name: 'Jugadores para comparar' })).toBeTruthy()
    expectSpanish(ownText(container), 'compare box')
  })

  it('English is unchanged', async () => {
    const { container } = render(<PlayerSearchBox query="" selectedLeagueId={null} signedIn />)
    await typeInto('Search any player')
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy()
    expect(screen.getByRole('listbox', { name: 'Suggestions' })).toBeTruthy()
    const out = container.textContent ?? ''
    for (const s of ['yours in Dragones', 'yours in 2 leagues', '@tashaR has him in Oficina FC', 'owned in Oficina FC', 'owned in 2 of your leagues', 'free in Dragones', 'free in 2 leagues', 'no team on file', 'Searches every platform you have connected at once — Sleeper, ESPN and Yahoo.']) {
      expect(out).toContain(s)
    }
  })
})

/* ── PlayerCompare ───────────────────────────────────────────────────────────────────────────── */

function impact(over: Partial<LeagueImpact> & Pick<LeagueImpact, 'leagueId' | 'leagueName' | 'platform' | 'slot'>, points: number | null): LeagueImpact {
  return {
    platformLeagueId: null,
    season: 2026,
    exactSlot: null,
    slotConfirmed: true,
    isStarting: over.slot === 'STARTER',
    afPoints: points != null ? { available: true, data: { points, matchedKeys: 4, scoredKeys: 20 } } : { available: false, reason: 'unpriced in fixture' },
    replacements: { available: false, reason: 'none in fixture' },
    startOver: null,
    ...over,
  }
}

const BASE: Omit<PlayerDetail, 'player' | 'leagues' | 'impact'> = {
  identityResolved: true,
  bio: { height: null, weight: null, age: 27, college: null },
  injury: { available: true, data: { status: 'Active', description: null, reportedAt: null } },
  seasonStats: { available: false, reason: 'none' },
  projection: { available: true, data: { points: 13.8, season: '2026', week: 12 } },
  afProjection: { available: true, data: { points: 12.9, week: 12 } },
  snapShare: { available: true, data: { share: 0.78, snaps: 400, teamSnaps: 513, games: 8, basis: 'offense' } },
  positionRank: { available: true, data: { rank: 6, outOf: 118, position: 'TE' } },
  recommendedMoves: { available: false, reason: 'none' },
  freshness: { label: '12m ago', stale: false },
  rosterCoverage: { unmatched: [] },
} as never

const KINCAID: PlayerDetail = {
  ...BASE,
  player: { externalId: 'ri-1', sport: 'NFL', sleeperId: '10236', name: 'Dalton Kincaid', position: 'TE', team: 'Buffalo Bills', imageUrl: null, number: 86, rosteredIn: 2, platforms: ['yahoo', 'sleeper'] },
  leagues: {
    available: true,
    data: [
      { leagueId: 'L-warriors', leagueName: 'Gold Coast', platform: 'yahoo', format: 'Standard', platformLeagueId: '55', season: 2026, slot: 'STARTER', isYours: true, owner: null },
      { leagueId: 'L-dragons', leagueName: 'Dragones', platform: 'sleeper', format: 'Dynasty PPR', platformLeagueId: '123456', season: 2026, slot: 'BENCH', isYours: true, owner: null },
      { leagueId: 'L-cafe', leagueName: 'Cafe Con Chimmy', platform: 'sleeper', format: null, platformLeagueId: '9', season: 2026, slot: 'STARTER', isYours: true, owner: null },
      { leagueId: 'L-gang', leagueName: 'Oficina FC', platform: 'espn', format: '0.5 PPR', platformLeagueId: '888', season: 2026, slot: 'BENCH', isYours: true, owner: null },
    ],
  },
  impact: {
    available: true,
    data: [
      impact({ leagueId: 'L-warriors', leagueName: 'Gold Coast', platform: 'yahoo', slot: 'STARTER' }, 11.1),
      impact({ leagueId: 'L-dragons', leagueName: 'Dragones', platform: 'sleeper', slot: 'BENCH' }, 15.4),
      impact({ leagueId: 'L-cafe', leagueName: 'Cafe Con Chimmy', platform: 'sleeper', slot: 'STARTER' }, 8.0),
      impact({ leagueId: 'L-gang', leagueName: 'Oficina FC', platform: 'espn', slot: 'BENCH' }, null),
    ],
  },
} as never

const FERGUSON: PlayerDetail = {
  ...BASE,
  bio: { height: null, weight: null, age: 26, college: null },
  injury: { available: true, data: { status: 'Questionable', description: 'Knee', reportedAt: null } },
  projection: { available: true, data: { points: 11.2, season: '2026', week: 12 } },
  positionRank: { available: true, data: { rank: 9, outOf: 118, position: 'TE' } },
  player: { externalId: 'ri-2', sport: 'NFL', sleeperId: '8130', name: 'Jake Ferguson', position: 'TE', team: 'Dallas Cowboys', imageUrl: null, number: 87, rosteredIn: 2, platforms: ['sleeper', 'espn'] },
  leagues: {
    available: true,
    data: [
      { leagueId: 'L-dragons', leagueName: 'Dragones', platform: 'sleeper', format: 'Dynasty PPR', platformLeagueId: '123456', season: 2026, slot: 'STARTER', isYours: true, owner: null },
      { leagueId: 'L-cafe', leagueName: 'Cafe Con Chimmy', platform: 'sleeper', format: null, platformLeagueId: '9', season: 2026, slot: 'BENCH', isYours: true, owner: null },
      { leagueId: 'L-gang', leagueName: 'Oficina FC', platform: 'espn', format: '0.5 PPR', platformLeagueId: '888', season: 2026, slot: 'NOT YOURS', isYours: false, owner: { teamName: 'Los Titanes', ownerName: 'tashaR', avatarUrl: null, externalId: '1' } },
    ],
  },
  impact: {
    available: true,
    data: [
      impact({ leagueId: 'L-dragons', leagueName: 'Dragones', platform: 'sleeper', slot: 'STARTER' }, 13.0),
      impact({ leagueId: 'L-cafe', leagueName: 'Cafe Con Chimmy', platform: 'sleeper', slot: 'BENCH' }, 12.0),
    ],
  },
  // A league whose rosters we cannot read: the "unchecked" cell.
  rosterCoverage: { unmatched: [{ leagueId: 'L-warriors', leagueName: 'Gold Coast', platform: 'yahoo' }] },
} as never

const card = (extra: Partial<React.ComponentProps<typeof PlayerCompare>> = {}) => (
  <PlayerCompare a={KINCAID} b={FERGUSON} query="Dalton Kincaid" selectedLeagueId={null} signedIn swapHref="/swap" clearHref="/clear" {...extra} />
)

/** Every branch of the headline, built from real `comparePlayers` output. */
function headlineCases(): Array<[string, PlayerDetail, PlayerDetail]> {
  const d = (name: string, leagues: Array<[string, string, number | null]>, projection: number | null): PlayerDetail =>
    ({
      ...BASE,
      projection: projection == null ? { available: false, reason: 'none' } : { available: true, data: { points: projection, season: '2026', week: 12 } },
      player: { ...KINCAID.player, name, externalId: name },
      leagues: { available: true, data: leagues.map(([id, slot]) => ({ leagueId: id, leagueName: `Liga ${id}`, platform: 'sleeper', format: null, platformLeagueId: id, season: 2026, slot, isYours: true, owner: null })) },
      impact: { available: true, data: leagues.map(([id, slot, pts]) => impact({ leagueId: id, leagueName: `Liga ${id}`, platform: 'sleeper', slot: slot as LeagueImpact['slot'] }, pts)) },
    }) as never
  const A = 'Dalton Kincaid'
  const B = 'Jake Ferguson'
  return [
    ['sweep, one league', d(A, [['1', 'STARTER', 12]], null), d(B, [['1', 'STARTER', 10]], null)],
    ['sweep, two leagues', d(A, [['1', 'STARTER', 12], ['2', 'STARTER', 15]], null), d(B, [['1', 'STARTER', 10], ['2', 'STARTER', 11]], null)],
    ['b sweeps', d(A, [['1', 'STARTER', 10], ['2', 'STARTER', 11]], null), d(B, [['1', 'STARTER', 12], ['2', 'STARTER', 15]], null)],
    ['a majority', d(A, [['1', 'STARTER', 12], ['2', 'STARTER', 9], ['3', 'STARTER', 14]], null), d(B, [['1', 'STARTER', 10], ['2', 'STARTER', 11], ['3', 'STARTER', 13]], null)],
    ['b majority', d(A, [['1', 'STARTER', 10], ['2', 'STARTER', 11], ['3', 'STARTER', 14]], null), d(B, [['1', 'STARTER', 12], ['2', 'STARTER', 13], ['3', 'STARTER', 13]], null)],
    ['split', d(A, [['1', 'STARTER', 12], ['2', 'STARTER', 9]], null), d(B, [['1', 'STARTER', 10], ['2', 'STARTER', 11]], null)],
    ['a dead heat', d(A, [['1', 'STARTER', 10]], null), d(B, [['1', 'STARTER', 10]], null)],
    ['standard, one ahead', d(A, [], 13.8), d(B, [], 11.2)],
    ['standard, level', d(A, [], 11), d(B, [], 11)],
    ['nothing', d(A, [], null), d(B, [], null)],
  ]
}

describe('PlayerCompare in Spanish', () => {
  it('the card — heads, tiles, verdict, table, notes, cells and the compare box — reads Spanish', () => {
    lang.language = 'es'
    const { container } = render(card())
    const out = ownText(container)
    expect(out).toContain('Comparar · Kincaid vs Ferguson')
    expect(out).toContain('Kincaid y Ferguson se reparten las 2 ligas valoradas 1–1')
    expect(out).toContain('Alinea a Kincaid en lugar de Ferguson')
    expect(out).toContain('Alinea a Ferguson en lugar de Kincaid')
    expect(out).toContain('Ferguson es de @tashaR aquí')
    expect(out).toContain('Proy. sem. 12')
    expect(out).toContain('NO ES TUYO')
    expect(out).toContain('Dudoso')
    expect(out).toContain('sin comprobar')
    expectSpanish(out, 'compare card')
  })

  it('signed out, and nobody on a roster we read', () => {
    lang.language = 'es'
    const out = render(card({ signedIn: false }))
    expectSpanish(ownText(out.container), 'compare card, signed out')
    out.unmount()
    const empty = { ...FERGUSON, leagues: { available: true, data: [] }, impact: { available: true, data: [] } } as never
    const solo = { ...KINCAID, leagues: { available: true, data: [] }, impact: { available: true, data: [] }, projection: { available: false, reason: 'x' }, afProjection: { available: false, reason: 'x' }, positionRank: { available: false, reason: 'x' }, snapShare: { available: false, reason: 'x' } } as never
    const none = render(card({ a: solo, b: empty }))
    expect(ownText(none.container)).toContain('Ninguno está en una plantilla')
    expectSpanish(ownText(none.container), 'compare card, no rows')
  })

  it('every headline branch reads Spanish, and its English is the lib’s own', () => {
    for (const [label, a, b] of headlineCases()) {
      const cmp = comparePlayers(a, b)
      expect(compareHeadlineText(cmp, 'en'), label).toBe(cmp.headline)
      const es = compareHeadlineText(cmp, 'es')
      expect(es, label).not.toBe(cmp.headline)
      expectSpanish(es, `headline: ${label}`)
    }
  })

  it('English is unchanged', () => {
    const { container } = render(card())
    const out = container.textContent ?? ''
    expect(out).toContain('Compare · Kincaid vs Ferguson')
    expect(out).toContain('Kincaid and Ferguson split the 2 priced leagues 1–1 — biggest gap in Cafe Con Chimmy (-4.0 for Ferguson).')
    expect(out).toContain('Start Kincaid over Ferguson')
    expect(out).toContain('Ferguson is @tashaR’s here')
    expect(out).toContain('Points in the table are under each league’s own scoring; the gap is Kincaid minus Ferguson. Standard scoring is the tile above.')
    expect(screen.getByRole('table', { name: 'Side by side' })).toBeTruthy()
  })
})

/* ── LeaguePicker ────────────────────────────────────────────────────────────────────────────── */

const PICK = [
  { id: 'L1', name: 'Dragones', platform: 'sleeper' },
  { id: 'L2', name: 'Oficina FC', platform: 'espn' },
  { id: 'L3', name: 'Gold Coast', platform: 'yahoo' },
]

describe('LeaguePicker in Spanish', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('the button, the panel, the save and its error read Spanish', async () => {
    lang.language = 'es'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))
    const { container } = render(<LeaguePicker leagues={PICK} saved={['L1', 'L2']} />)
    expect(ownText(container)).toContain('2 de 3')
    fireEvent.click(container.querySelector('.af-pf-picker-btn')!)
    expect(screen.getByPlaceholderText('Filtrar ligas')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    })
    expect(ownText(container)).toContain('No se pudo guardar')
    expectSpanish(ownText(container), 'picker, some ticked')
    fireEvent.click(screen.getByRole('button', { name: 'Todas' }))
    expectSpanish(ownText(container), 'picker, all ticked')
  })

  it('English is unchanged', () => {
    const { container } = render(<LeaguePicker leagues={PICK} saved={null} />)
    fireEvent.click(container.querySelector('.af-pf-picker-btn')!)
    expect(container.textContent).toContain('All 3 selected')
    expect(screen.getByPlaceholderText('Filter leagues')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Pick the leagues the Player Finder reads' })).toBeTruthy()
  })
})

/* ── LeagueStrip ─────────────────────────────────────────────────────────────────────────────── */

const slot = (leagueId: string, s: string, isYours: boolean, over: Partial<LeagueSlot> = {}): LeagueSlot =>
  ({
    leagueId,
    leagueName: leagueId,
    platform: 'sleeper',
    format: null,
    platformLeagueId: null,
    season: 2026,
    teamExternalId: null,
    slot: s,
    isYours,
    owner: isYours ? null : { teamName: 'Los Titanes', ownerName: 'tasha', avatarUrl: null, externalId: '2' },
    ...over,
  }) as LeagueSlot

const STRIP = {
  leagues: ['Alfa', 'Bravo', 'Carta', 'Delta', 'Eco', 'Foco', 'Gama', 'Hotel'].map((n) => ({ id: n, name: n })),
  scope: null,
  slots: [
    slot('Alfa', 'BENCH', true),
    slot('Bravo', 'STARTER', true),
    slot('Carta', 'NOT YOURS', false),
    slot('Delta', 'IR SLOT', true),
    slot('Gama', 'TAXI', true, { bestBall: true }),
    slot('Hotel', 'NOT YOURS', false, { owner: null }),
  ],
  unmatched: [{ leagueId: 'Foco' }],
  playerName: 'Tank Dell',
  readinessTone: 'bad' as const,
}

describe('LeagueStrip in Spanish', () => {
  it('every chip — badge and the sentence a screen reader hears — and the tally read Spanish', () => {
    lang.language = 'es'
    const { container } = render(<LeagueStrip chips={buildLeagueStrip(STRIP)} leagueHref={(id) => `/core/players?league=${id}`} />)
    const out = ownText(container)
    expect(screen.getByRole('link', { name: 'Bravo: Dell es titular.' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Eco: nadie tiene a Dell; está disponible.' })).toBeTruthy()
    expect(out).toContain('TITULAR')
    expect(out).toContain('BANCA')
    expect(out).toContain('LIBRE')
    expect(out).toContain('Ocupado')
    expectSpanish(out, 'league strip')
  })

  it('English is unchanged', () => {
    render(<LeagueStrip chips={buildLeagueStrip(STRIP)} leagueHref={(id) => `/core/players?league=${id}`} />)
    expect(screen.getByRole('link', { name: 'Bravo: Dell is starting.' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Gama: Dell is on your taxi squad (best ball — the platform sets the lineup).' })).toBeTruthy()
    expect(screen.getByText("Yours in 4 · available in 1 · elsewhere in 2 · can't read 1")).toBeTruthy()
  })
})

/* ── StickyActionBar ─────────────────────────────────────────────────────────────────────────── */

const view = (ownership: PlayerLeagueView['ownership'], platform = 'sleeper'): PlayerLeagueView =>
  ({
    leagueId: 'L1',
    leagueName: 'Dragones',
    platform,
    platformLeagueId: '1180000000000000000',
    season: 2026,
    format: 'dynasty',
    ownership,
    afPoints: { available: false, reason: 'n/a' },
    positionRank: { available: false, reason: 'n/a' },
    yourTeam: { teamName: 'Cafe', externalId: '3' },
    rosterCount: 12,
  }) as unknown as PlayerLeagueView

const OWNER = { teamName: 'Los Titanes', ownerName: 'tasha', externalId: '7', avatarUrl: null, record: '3-0', isCommissioner: false } as never
const BARS: Array<[string, PlayerLeagueView]> = [
  ['yours, bench', view({ kind: 'yours', slot: 'BENCH', exactSlot: null, teamName: 'Cafe' } as never)],
  ['yours, starter at TE', view({ kind: 'yours', slot: 'STARTER', exactSlot: 'TE', teamName: 'Cafe' } as never)],
  ['yours, native league', view({ kind: 'yours', slot: 'IR SLOT', exactSlot: null, teamName: 'Cafe' } as never, 'allfantasy')],
  ['theirs', view({ kind: 'other', slot: 'STARTER', owner: OWNER } as never)],
  ['theirs, no owner', view({ kind: 'other', slot: 'STARTER', owner: null } as never)],
  ['free agent', view({ kind: 'free-agent' } as never)],
  ['free agent, native league', view({ kind: 'free-agent' } as never, 'allfantasy')],
]

describe('StickyActionBar in Spanish', () => {
  it('the context line and the button read Spanish in every state', () => {
    lang.language = 'es'
    for (const [label, v] of BARS) {
      const { container, unmount } = render(<StickyActionBar view={v} playerName="Dalton Kincaid" />)
      expect(container.querySelector('.af-pf-stickybar'), label).not.toBeNull()
      expectSpanish(ownText(container), `sticky bar: ${label}`)
      unmount()
    }
    const { container } = render(<StickyActionBar view={BARS[3]![1]} playerName="Dalton Kincaid" />)
    expect(screen.getByRole('link', { name: 'Intercambiar por Kincaid →' })).toBeTruthy()
    expect(container.textContent).toContain('De Los Titanes')
  })

  it('English is unchanged', () => {
    render(<StickyActionBar view={BARS[3]![1]} playerName="Dalton Kincaid" />)
    expect(screen.getByRole('link', { name: 'Trade for Kincaid →' })).toBeTruthy()
    expect(screen.getByText("Los Titanes's")).toBeTruthy()
    cleanup()
    render(<StickyActionBar view={BARS[5]![1]} playerName="Dalton Kincaid" />)
    expect(screen.getByRole('link', { name: 'Claim Kincaid — on Sleeper' })).toBeTruthy()
    expect(screen.getByText('Free agent')).toBeTruthy()
  })
})

/* ── FreeAgentBids ───────────────────────────────────────────────────────────────────────────── */

const faab = (budget: number, remaining: number | null, over: Record<string, unknown> = {}) => ({
  settings: { waiverType: 'faab', normalizedWaiverType: 'faab', faabBudget: budget },
  settingsKnown: true,
  faabRemaining: remaining,
  ...over,
})

/** One league per note the loader writes, plus a bid with its room. */
function seedEveryNote() {
  const L = (id: string, name: string) => ({ id, name, platform: 'sleeper', platformLeagueId: `11800000000000000${id.slice(-2)}`, season: 2026 })
  h.leagues = [L('A01', 'Alfa'), L('A02', 'Bravo'), L('A03', 'Carta'), L('A04', 'Delta'), L('A05', 'Eco')]
  // Fill to past the cap so the last league is listed without a bid.
  for (let i = 6; i <= BID_LEAGUE_CAP + 1; i++) h.leagues.push(L(`A${String(i).padStart(2, '0')}`, `Zeta ${String(i).padStart(2, '0')}`))
  h.facts = new Map<string, unknown>(h.leagues.map((l) => [l.id, faab(100, 100)]))
  h.facts.set('A01', faab(100, 40))
  h.facts.set('A02', { settings: { waiverType: 'rolling', normalizedWaiverType: 'rolling', faabBudget: 100 }, settingsKnown: true, faabRemaining: null })
  h.facts.set('A03', faab(100, 40, { settingsKnown: false }))
  h.values = new Map(h.leagues.map((l) => [l.id, new Map([['9001', { value: 2400, faabAnchor: 3000 }]])]))
  h.values.delete('A04') // no market value in this format
  h.values.set('A05', new Map([['9001', { value: 2400, faabAnchor: null }]])) // the chart is still syncing
  h.room = [
    { leagueId: 'A01', claims: 48, median: 5, p75: 9 },
    { leagueId: 'A02', claims: 1, median: 3, p75: 3 },
  ]
}

describe('FreeAgentBids in Spanish', () => {
  const access = { depth: 'player_depth', unlocked: false, hasPlan: false, label: 'Player depth', planName: 'AF Pro', preLaunchFree: false, startsAt: '2026-10-15T00:00:00.000Z', upgradePath: '/upgrade' } as never

  it('every row — bid, room, every note and the claim — and the section read Spanish', async () => {
    seedEveryNote()
    const data = await loadFreeAgentBids({ userId: 'u1', sleeperId: '9001', freeLeagueIds: h.leagues.map((l) => l.id), includeBids: true })
    const noBid = await loadFreeAgentBids({ userId: 'u1', sleeperId: null, freeLeagueIds: ['A01'], includeBids: true })
    // Every note the loader can write is in the fixture.
    const notes = new Set([...data.rows, ...noBid.rows].map((r) => r.note).filter(Boolean))
    expect(notes.size).toBe(FA_NOTE_KEYS.length + 1) // + the cap sentence, a pattern

    lang.language = 'es'
    const { container } = render(
      <>
        <FreeAgentBids data={data} playerName="Tank Dell" access={null} />
        <FreeAgentBids data={noBid} playerName="Tank Dell" access={null} />
      </>,
    )
    const out = ownText(container)
    expect(screen.getByRole('heading', { name: `Disponible en ${h.leagues.length} de tus ligas` })).toBeTruthy()
    expect(out).toContain('Puja ~$40 de $100 · quedan $40')
    expect(out).toContain('mediana $5 · p75 $9 (48 reclamos)')
    expect(out).toContain('(1 reclamo)')
    expect(screen.getAllByRole('link', { name: 'Reclamar a Dell en Sleeper' }).length).toBeGreaterThan(0)
    expect(out).toContain(`las pujas se muestran para ${BID_LEAGUE_CAP} ligas a la vez`)
    expectSpanish(out, 'FA bids, AF Pro')
  })

  it('a locked viewer: the leagues and claims read Spanish; the AF Pro lock is the shared one', async () => {
    seedEveryNote()
    const data = await loadFreeAgentBids({ userId: 'u1', sleeperId: '9001', freeLeagueIds: ['A01', 'A02'], includeBids: false })
    lang.language = 'es'
    const { container } = render(<FreeAgentBids data={data} playerName="Tank Dell" access={access} />)
    expect(container.querySelector('.af-core-lock')).not.toBeNull()
    expectSpanish(ownText(container), 'FA bids, locked')
  })

  it('each note it translates is a sentence freeAgentBids.ts writes, verbatim', () => {
    const src = readFileSync(join(process.cwd(), 'lib/core-app/freeAgentBids.ts'), 'utf8')
    for (const key of FA_NOTE_KEYS) {
      expect(src, key).toContain(`'${key}'`)
      expect(faNoteText(key, 'es'), key).not.toBe(key)
    }
    expect(src).toContain('`bids are shown for ${BID_LEAGUE_CAP} leagues at a time`')
    expect(faNoteText('an unknown note', 'es')).toBe('an unknown note')
  })

  it('English is unchanged', async () => {
    seedEveryNote()
    const data = await loadFreeAgentBids({ userId: 'u1', sleeperId: '9001', freeLeagueIds: ['A01', 'A02'], includeBids: true })
    render(<FreeAgentBids data={data} playerName="Tank Dell" access={null} />)
    expect(screen.getByRole('heading', { name: 'Available in 2 of your leagues' })).toBeTruthy()
    expect(screen.getByText(/median \$5 · p75 \$9 \(48 claims\)/)).toBeTruthy()
    expect(screen.getByText('waiver-priority league — no FAAB bid')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Claim Dell in Sleeper' })).toHaveLength(2)
  })
})
