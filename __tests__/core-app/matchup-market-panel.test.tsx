// @vitest-environment jsdom
/**
 * The odds "scoring environment" panel, back on a live screen (2026-10-06).
 *
 * It was built 2026-09-10 inside `MatchupPrepModal` — a modal nothing had mounted since July — so it
 * never rendered for anyone, and it was deleted with `components/ai-tools` (f6a1405cd). It now lives
 * on /core Matchup, reading stored odds through `/api/core/matchup-market`.
 *
 * 🛑 WHAT THIS SUITE PROTECTS IS THE WORDING, IN BOTH LANGUAGES. AllFantasy reads the betting market
 * as a FORECAST and is not a gambling product. The read layer already refuses prices and sportsbook
 * names (__tests__/odds/game-odds-reads-forecast-only.test.ts); nothing but this file stops the
 * formatting drifting back into betting notation — "-3.5" for "favored by 3.5" is one character.
 *
 * ⚠ AND THE EMPTY / PARTIAL STATES ARE REAL ASSERTIONS. Only fixtures inside about two days of kickoff
 * carry a read, so for most of a week some or all starters have none. That reads as "not yet", and a
 * starter without a read is counted — never rendered as "0.0" or "—".
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k }),
}))
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}))

import Matchup from '@/components/core-app/screens/Matchup'
import {
  MarketEnvironmentView,
  MatchupMarketPanel,
  type MarketPanelState,
} from '@/components/core-app/MatchupMarketPanel'
import {
  buildMarketRows,
  pickMarketForTeams,
  type MarketRow,
  type MatchupMarketTeam,
} from '@/lib/core-app/matchupMarket'
import type { MatchupData, MatchupPlayerCell, MatchupSlot } from '@/lib/core-app/matchup'

afterEach(() => {
  cleanup()
  h.language = 'en'
  vi.unstubAllGlobals()
})

function row(over: Partial<MarketRow> = {}): MarketRow {
  return {
    key: 'p1',
    name: "Ja'Marr Chase",
    team: 'CIN',
    impliedTeamTotal: 27.5,
    spread: -3.5,
    gameTotal: 48.5,
    opponent: 'TB',
    isHome: true,
    isStale: false,
    ...over,
  }
}

const ready = (rows: MarketRow[], withoutRead = 0): MarketPanelState => ({ status: 'ready', rows, withoutRead })
const text = (state: MarketPanelState) => render(<MarketEnvironmentView state={state} />).container.textContent ?? ''

describe('odds present — the forecast/gambling boundary, in the rendered text', () => {
  it('states the spread as game script, never as betting notation', () => {
    const t = text(ready([row({ spread: -3.5 })]))
    expect(t).toContain('favored by 3.5')
    expect(t).not.toContain('-3.5')
  })

  it('says "underdog by" rather than a plus-line', () => {
    const t = text(ready([row({ spread: 3.5 })]))
    expect(t).toContain('underdog by 3.5')
    expect(t).not.toContain('+3.5')
  })

  it('calls the game total "combined", never an over/under', () => {
    const t = text(ready([row({ gameTotal: 48.5 })])).toLowerCase()
    expect(t).toContain('48.5 combined')
    expect(t).not.toContain('o/u')
    expect(t).not.toContain('over/under')
  })

  it('renders no price-shaped strings and no sportsbook name', () => {
    const t = text(ready([row(), row({ key: 'p2', name: 'Bijan Robinson', team: 'ATL', spread: 2.5 })]))
    expect(t).not.toMatch(/[+-]\d{3}/)
    for (const book of ['Bet365', 'DraftKings', 'FanDuel', 'Pinnacle', 'bookmaker']) expect(t).not.toContain(book)
  })

  it('leads with expected points, home "vs" and road "at"', () => {
    const t = text(ready([row(), row({ key: 'p2', name: 'Bijan Robinson', team: 'ATL', isHome: false, opponent: 'NO', impliedTeamTotal: 21 })]))
    expect(t).toContain("Ja'Marr Chase")
    expect(t).toContain('27.5 expected pts')
    expect(t).toContain('vs TB')
    expect(t).toContain('at NO')
  })

  it('disclaims the two things a reader could wrongly infer', () => {
    const t = text(ready([row()]))
    expect(t).toContain('Not a wager')
    expect(t).toContain('not your matchup win chance')
  })

  it('flags a stale read — and CONTROL: a fresh one carries no warning', () => {
    expect(text(ready([row({ isStale: true })]))).toContain('Past its refresh window')
    cleanup()
    expect(text(ready([row({ isStale: false })]))).not.toContain('Past its refresh window')
  })
})

describe('odds missing — "not yet", not broken', () => {
  it('no read for any starter says lines post closer to kickoff, with no zeros', () => {
    const t = text(ready([], 9))
    expect(t).toContain('No market read yet')
    expect(t).toContain('closer to kickoff')
    expect(t.toLowerCase()).not.toContain('error')
    expect(t.toLowerCase()).not.toContain('unavailable')
    expect(t).not.toContain('0.0')
  })

  it('a failed request says so, distinct from "not yet"', () => {
    const t = text({ status: 'failed' })
    expect(t).toContain('did not load')
    expect(t).not.toContain('No market read yet')
  })
})

describe('odds partial — the rows it has, and a count of the rest', () => {
  it('lists the starters with a read and counts the ones without', () => {
    const t = text(ready([row()], 2))
    expect(t).toContain("Ja'Marr Chase")
    expect(t).toContain('No market read yet for 2 of your starters')
    expect(t).not.toContain('0.0')
  })

  it('CONTROL: a full read carries no partial note', () => {
    expect(text(ready([row()], 0))).not.toContain('No market read yet')
  })
})

describe('Spanish — no English left', () => {
  const ENGLISH = /\b(expected|favored|underdog|even game|combined|starters?|market|scoring|environment|wager|kickoff|refresh|reload|load|not yet|past its|win chance|how to read)\b/i

  it('a full panel (rows, partial note, stale note, tip) reads Spanish', () => {
    h.language = 'es'
    const t = text(
      ready(
        [
          row({ isStale: true }),
          row({ key: 'p2', name: 'Bijan Robinson', team: 'ATL', spread: 2.5, isHome: false, opponent: 'NO' }),
          row({ key: 'p3', name: 'Joe Burrow', spread: 0 }),
        ],
        1,
      ),
    )
    expect(t).toContain('Entorno de anotación')
    expect(t).toContain('27.5 pts esperados')
    expect(t).toContain('favorito por 3.5')
    expect(t).toContain('no favorito por 2.5')
    expect(t).toContain('partido parejo')
    expect(t).toContain('48.5 entre ambos')
    expect(t).toContain('en NO')
    expect(t).toContain('para 1 de tus titulares')
    expect(t).toContain('Fuera de su ventana de actualización')
    expect(t).toContain('No es una apuesta')
    expect(t).not.toMatch(ENGLISH)
    expect(t).not.toContain('-3.5')
  })

  it('the empty and failed states read Spanish', () => {
    h.language = 'es'
    const empty = text(ready([], 4))
    expect(empty).toContain('Aún no hay lectura del mercado')
    expect(empty).not.toMatch(ENGLISH)
    cleanup()
    const failed = text({ status: 'failed' })
    expect(failed).toContain('no se cargó')
    expect(failed).not.toMatch(ENGLISH)
  })
})

describe('the join (pure)', () => {
  const team = (over: Partial<MatchupMarketTeam> = {}): MatchupMarketTeam => ({
    opponent: 'TB',
    isHome: true,
    impliedTeamTotal: 24,
    spread: -1,
    gameTotal: 45,
    isStale: false,
    ...over,
  })

  it('answers a roster alias from the canonical key, keyed as asked', () => {
    const byTeam = new Map([['JAX', team({ impliedTeamTotal: 22.5 })]])
    const out = pickMarketForTeams(byTeam, ['JAC', 'KC'])
    expect(out.teams.JAC?.impliedTeamTotal).toBe(22.5)
    expect(out.teams.KC).toBeNull()
  })

  it('sorts by expected points and counts a null implied total as no read', () => {
    const starters = [
      { key: 'a', name: 'A', team: 'KC' },
      { key: 'b', name: 'B', team: 'BUF' },
      { key: 'c', name: 'C', team: 'NYJ' },
      { key: 'd', name: 'D', team: 'MIA' },
    ]
    const { rows, withoutRead } = buildMarketRows(starters, {
      KC: team({ impliedTeamTotal: 21 }),
      BUF: team({ impliedTeamTotal: 28 }),
      NYJ: team({ impliedTeamTotal: null }),
    })
    expect(rows.map((r) => r.name)).toEqual(['B', 'A'])
    expect(withoutRead).toBe(2)
  })
})

/* ── The live screen ─────────────────────────────────────────────── */

function cell(over: Partial<MatchupPlayerCell> = {}): MatchupPlayerCell {
  return {
    playerId: 'p1',
    sleeperId: 'p1',
    name: "Ja'Marr Chase",
    position: 'WR',
    team: 'CIN',
    sport: 'NFL',
    imageUrl: null,
    projected: 18.2,
    actual: null,
    empty: false,
    unavailable: null,
    gameState: 'upcoming',
    ...over,
  }
}

function data(over: Partial<MatchupData> = {}, slots?: MatchupSlot[]): MatchupData {
  const lineup: MatchupSlot[] = slots ?? [
    { slotLabel: 'WR', you: cell(), opponent: cell({ playerId: 'o1', sleeperId: 'o1', name: 'Mike Evans', team: 'TB' }) },
    { slotLabel: 'RB', you: cell({ playerId: 'p2', sleeperId: 'p2', name: 'Bijan Robinson', team: 'ATL', position: 'RB' }), opponent: null },
    { slotLabel: 'WR', you: cell({ playerId: 'p3', sleeperId: 'p3', name: 'Tee Higgins', team: 'CIN' }), opponent: null },
    { slotLabel: 'TE', you: cell({ playerId: 'p4', sleeperId: 'p4', name: 'Travis Kelce', team: 'KC', position: 'TE' }), opponent: null },
  ]
  return {
    league: { id: 'l1', name: 'Test League', platform: 'sleeper', logoUrl: null, sourceLink: null, lineupLink: null },
    week: { available: true, data: { week: 6, season: 2026, isFinal: false } },
    teams: { available: false, reason: 'no teams' },
    sides: { available: false, reason: 'unplayed' },
    lineups: { available: true, data: lineup },
    identityNote: null,
    playerScoring: { available: false, reason: 'no per-player scoring' },
    winProbability: { available: false, reason: 'no probability' },
    projectedFinal: { available: false, reason: 'no projection' },
    yetToPlay: { available: false, reason: 'no game state' },
    ...over,
  }
}

function stubFetch(body: unknown, ok = true) {
  const fn = vi.fn(async (_url: string) => ({ ok, status: ok ? 200 : 503, json: async () => body }))
  vi.stubGlobal('fetch', fn)
  return fn
}

const MARKET = {
  teams: {
    ATL: { opponent: 'NO', isHome: false, impliedTeamTotal: 23.25, spread: 1.5, gameTotal: 45, isStale: false },
    CIN: { opponent: 'TB', isHome: true, impliedTeamTotal: 27.5, spread: -3.5, gameTotal: 48.5, isStale: false },
    KC: null,
  },
}

describe('the Matchup screen carries the panel', () => {
  it('mounts it, asks for your starters’ clubs once each, and renders present + partial', async () => {
    const fetchFn = stubFetch(MARKET)
    const { container } = render(<Matchup data={data()} />)
    await screen.findByText('Scoring environment')

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const url = String(fetchFn.mock.calls[0][0])
    expect(url.startsWith('/api/core/matchup-market?')).toBe(true)
    const q = new URLSearchParams(url.split('?')[1])
    expect(q.get('season')).toBe('2026')
    expect(q.get('week')).toBe('6')
    // Yours only (no TB from the opponent), each club once.
    expect(q.getAll('team')).toEqual(['ATL', 'CIN', 'KC'])

    const panel = container.querySelector('.af-mu-market')!
    const names = [...panel.querySelectorAll('.af-mu-missing-key')].map((n) => n.firstChild?.textContent?.trim())
    // Highest expected scoring first; two CIN starters both listed; KC has no read and is counted.
    expect(names).toEqual(["Ja'Marr Chase", 'Tee Higgins', 'Bijan Robinson'])
    expect(panel.textContent).toContain('No market read yet for 1 of your starters')
    expect(panel.textContent).toContain('23.3 expected pts')
  })

  it('a week with no reads at all shows the "not yet" state', async () => {
    stubFetch({ teams: { ATL: null, CIN: null, KC: null } })
    render(<Matchup data={data()} />)
    await screen.findByText(/No market read yet — expected team scoring posts closer to kickoff/)
  })

  it('a failed request is said, not shown as an empty market', async () => {
    stubFetch({ error: 'x' }, false)
    render(<Matchup data={data()} />)
    await screen.findByText(/did not load/)
  })

  it('reads Spanish on the screen too', async () => {
    h.language = 'es'
    stubFetch(MARKET)
    const { container } = render(<Matchup data={data()} />)
    await screen.findByText('Entorno de anotación')
    expect(container.querySelector('.af-mu-market')!.textContent).toContain('favorito por 3.5')
  })

  it('a finished week, a non-NFL league or no lineups: no panel and no request', async () => {
    const fetchFn = stubFetch(MARKET)
    render(<MatchupMarketPanel data={data({ week: { available: true, data: { week: 6, season: 2026, isFinal: true } } })} />)
    render(
      <MatchupMarketPanel
        data={data({}, [{ slotLabel: 'G', you: cell({ sport: 'NBA', team: 'BOS' }), opponent: null }])}
      />,
    )
    render(<MatchupMarketPanel data={data({ lineups: { available: false, reason: 'no lineups' } })} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchFn).not.toHaveBeenCalled()
    expect(document.querySelector('.af-mu-market')).toBeNull()
  })

  it('CONTROL: the same panel with an open NFL week does request', async () => {
    const fetchFn = stubFetch(MARKET)
    render(<MatchupMarketPanel data={data()} />)
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))
  })
})
