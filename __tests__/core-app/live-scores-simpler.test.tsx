import { vi } from 'vitest'
/**
 * Live scores, simplified (2026-11-15): one headline answer, each fact once, the box score folded.
 *
 * - inside a league with a scored matchup the h1 is the score and who is on the field, and the strip
 *   under it is ONE line that says only what the h1 does not (opponent, chance, who is left to play)
 * - no "Playing now" tile, no "0 Done today", the page explainer behind a "?"
 * - a game card leads with your starters; the box score sits behind "Box score"; a game that has not
 *   kicked off shows its time and your projections only — no season-to-date leaders from other games
 * - inside a league: no "1 league" chip, no "· 1 league" count, one sport chip, Around the league folded
 */
const L = vi.hoisted(() => ({ lang: 'en' }))
vi.mock('next/navigation', () => ({ usePathname: () => '/core/live', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {} }) }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: L.lang, t: (k: string) => k }),
}))
vi.mock('@/components/MiniPlayerImg', () => ({
  default: ({ name }: { name: string }) => <span data-testid="face">{name}</span>,
}))
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))

import { GameCard, LiveScores } from '@/components/core-app/screens/LiveScores'
import { leftToPlay } from '@/components/core-app/screens/LiveMatchupStrip'
import { LiveLeagueGames } from '@/components/core-app/screens/LiveLeagueGames'
import { liveGuideMessages } from '@/lib/core-app/messages/liveGuide'
import type { LiveGameCard, LivePageData, LiveRosterTieIn } from '@/lib/live/liveScoresPage'
import type { MatchupStrip } from '@/lib/live/matchupStrip'
import type { ScoreboardGame } from '@/lib/core-app/leagueScoreboard'

afterEach(() => {
  cleanup()
  L.lang = 'en'
})

/** What a reader sees: the element's text with every "?" tip's popover (hidden until tapped) removed. */
function visibleText(el: Element): string {
  const copy = el.cloneNode(true) as Element
  copy.querySelectorAll('.af-info-tip-wrap').forEach((n) => n.remove())
  return copy.textContent ?? ''
}

const tie = (over: Partial<LiveRosterTieIn>): LiveRosterTieIn => ({
  leagueId: 'L1',
  leagueName: 'Alpha League',
  playerId: 'p1',
  playerName: 'Player One',
  position: 'RB',
  imageUrl: null,
  isStarter: true,
  points: 8.4,
  ...over,
})

function game(id: string, over: Partial<LiveGameCard> = {}): LiveGameCard {
  return {
    gameId: id,
    sport: 'NFL',
    week: 10,
    status: 'STATUS_IN_PROGRESS',
    statusDetail: 'Q2',
    clockLabel: 'Q2 · 4:50',
    isLive: true,
    completed: false,
    startTime: '2026-11-15T18:00:00Z',
    away: { abbrev: `A${id}`, name: `Away ${id}`, logo: '', score: 7, record: null, linescores: [7] },
    home: { abbrev: `H${id}`, name: `Home ${id}`, logo: '', score: 21, record: null, linescores: [21] },
    winProbability: null,
    topPerformer: null,
    leaders: [{ label: 'PASS', name: 'Quarter Back', headshot: null, statLine: '12/20, 211 YDS', position: 'QB', teamAbbrev: `H${id}` }] as LiveGameCard['leaders'],
    situation: null,
    venue: { name: 'Big Stadium', location: 'Somewhere' } as LiveGameCard['venue'],
    broadcast: null,
    tieIns: [tie({ playerId: `${id}-p1`, playerName: `Starter ${id}` })],
    leaguesAffected: 1,
    ...over,
  }
}

const pregame = (id: string, over: Partial<LiveGameCard> = {}) =>
  game(id, {
    isLive: false,
    completed: false,
    status: 'STATUS_SCHEDULED',
    statusDetail: '11/15 - 4:25 PM EST',
    clockLabel: null,
    away: { abbrev: `A${id}`, name: `Away ${id}`, logo: '', score: null, record: null, linescores: [] },
    home: { abbrev: `H${id}`, name: `Home ${id}`, logo: '', score: null, record: null, linescores: [] },
    leadersArePregame: true,
    ...over,
  })

function page(games: LiveGameCard[], over: Partial<LivePageData> = {}): LivePageData {
  return {
    sport: 'NFL',
    scope: 'my',
    counts: [
      { sport: 'NFL', label: 'NFL', slateCount: games.length },
      { sport: 'NBA', label: 'NBA', slateCount: 9 },
      { sport: 'NHL', label: 'NHL', slateCount: 5 },
    ],
    games,
    impact: { totalPoints: 0, livePlayers: 0, liveGames: 0, biggestMover: null, plays: [], upNext: [] },
    fetchedAt: new Date().toISOString(),
    hasRosterData: true,
    loadFailed: false,
    rosterFailed: false,
    ...over,
  }
}

const scored = (over: Partial<Extract<MatchupStrip, { kind: 'scored' }>> = {}): MatchupStrip => ({
  kind: 'scored',
  week: 10,
  isFinal: false,
  you: { name: 'NewYorkJets!', points: 29 },
  opponent: { name: 'Dolphins (B2B Champs)', points: 41.7 },
  margin: -12.7,
  pWin: 0.08,
  remaining: { you: { upcoming: 13, live: 3 }, opponent: { upcoming: 11, live: 3 } },
  ...over,
})

/** Three of your starters on the field, in league L1. */
const liveSlate = () =>
  page([
    game('1', { tieIns: [tie({ playerId: 'a', playerName: 'Ann' }), tie({ playerId: 'b', playerName: 'Bo' })] }),
    game('2', { tieIns: [tie({ playerId: 'c', playerName: 'Cy' })] }),
  ])

describe('the headline is the answer', () => {
  it('inside a league: the score, then how many of your starters are playing', () => {
    render(<LiveScores data={liveSlate()} selectedLeagueId="L1" matchupStrip={scored()} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('You trail 29.0–41.7 · 3 starters playing now')
  })

  it('leading, tied and final say so', () => {
    const a = render(<LiveScores data={liveSlate()} selectedLeagueId="L1" matchupStrip={scored({ you: { name: 'Me', points: 50 }, margin: 8.3 })} />)
    expect(a.getByRole('heading', { level: 1 }).textContent).toBe('You lead 50.0–41.7 · 3 starters playing now')
    a.unmount()
    const b = render(
      <LiveScores data={liveSlate()} selectedLeagueId="L1" matchupStrip={scored({ isFinal: true, you: { name: 'Me', points: 101.2 }, opponent: { name: 'Them', points: 98 }, margin: 3.2 })} />,
    )
    // A final says won or lost and nothing about who is on the field.
    expect(b.getByRole('heading', { level: 1 }).textContent).toBe('You won 101.2–98.0')
  })

  it('control: without a scored matchup the headline is the starters sentence', () => {
    render(<LiveScores data={liveSlate()} selectedLeagueId="L1" matchupStrip={null} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('3 of your starters are playing right now')
  })

  it('no "Playing now" tile, no "0 Done today", and the explainer is behind a "?", not a paragraph', () => {
    const { container } = render(<LiveScores data={liveSlate()} selectedLeagueId="L1" matchupStrip={scored()} />)
    const head = container.querySelector('.af-lg-head') as HTMLElement
    expect(head.querySelector('[data-chip]')).toBeNull()
    expect(head.querySelector('.af-pg-sub')).toBeNull()
    // The sentence lives only in the tip's popover now.
    expect(visibleText(head)).not.toContain('Open this while games are on')
    const tip = head.querySelector('.af-info-tip-wrap') as HTMLElement
    expect(tip.textContent).toContain('Open this while games are on')
  })
})

describe('the matchup strip is one line that says only what the headline does not', () => {
  it('opponent, chance to win, who is left to play — no score row, no "(3 live)"', () => {
    const { container, getByTestId } = render(<LiveScores data={liveSlate()} selectedLeagueId="L1" matchupStrip={scored()} />)
    const strip = container.querySelector('.af-live-matchup') as HTMLElement
    expect(strip.querySelector('.af-live-matchup-row')).toBeNull()
    expect(visibleText(getByTestId('live-matchup-line'))).toBe('vs Dolphins (B2B Champs) · 8% to win  · 16 left to play vs their 14 · Open matchup')
    expect(strip.textContent).not.toMatch(/\(\d+ live\)/)
    // The score is said once, in the h1.
    expect(container.textContent!.split('29.0').length - 1).toBe(1)
  })

  it('leftToPlay says each side once, and what is unknown is left out', () => {
    const t = liveGuideMessages.en
    expect(leftToPlay({ upcoming: 13, live: 3 }, { upcoming: 11, live: 3 }, t)).toBe('16 left to play vs their 14')
    expect(leftToPlay({ upcoming: 0, live: 0 }, { upcoming: 0, live: 0 }, t)).toBe('everyone has played')
    expect(leftToPlay({ upcoming: 2, live: 0 }, null, t)).toBe('2 left to play')
    expect(leftToPlay(null, { upcoming: 1, live: 1 }, t)).toBe('they have 2 left to play')
    expect(leftToPlay(null, null, t)).toBeNull()
  })
})

describe('a game card leads with your starters; the box score is folded', () => {
  it('starters come before the box score, which is closed', () => {
    const { container } = render(<LiveScores data={liveSlate()} selectedLeagueId="L1" matchupStrip={scored()} />)
    const card = container.querySelector('.af-live-slate > .af-live-game') as HTMLElement
    const starters = card.querySelector('.af-live-tieins') as HTMLElement
    const box = card.querySelector('[data-testid="live-box-score"]') as HTMLDetailsElement
    expect(box.open).toBe(false)
    expect(box.querySelector('summary')!.textContent).toBe('Box score')
    // Starters precede the fold in document order, and the linescore, leaders and venue sit inside it.
    expect(starters.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(box.querySelector('.af-live-leaders')).not.toBeNull()
    expect(box.querySelector('.af-live-venue')).not.toBeNull()
    expect(card.querySelector(':scope > .af-live-venue')).toBeNull()
  })

  it('a game that has not kicked off: time and projections only — no box score, no season leaders', () => {
    const { container } = render(<LiveScores data={page([pregame('9')])} selectedLeagueId="L1" />)
    const card = container.querySelector('.af-live-slate > .af-live-game') as HTMLElement
    expect(card.textContent).toContain('4:25 PM')
    expect(card.querySelector('[data-testid="live-box-score"]')).toBeNull()
    expect(card.textContent).not.toMatch(/highlight players/i)
    expect(card.textContent).not.toContain('Big Stadium')
    expect(card.querySelector('.af-live-tieins')).not.toBeNull()
  })

  it('control: the public card (no fold) keeps every block in place, starters last', () => {
    const { container } = render(<GameCard game={game('5')} scope="my" selectedLeagueId={null} lastPlay={null} />)
    expect(container.querySelector('[data-testid="live-box-score"]')).toBeNull()
    const card = container.querySelector('.af-live-game') as HTMLElement
    expect(card.querySelector(':scope > .af-live-venue')).not.toBeNull()
    expect(card.lastElementChild!.classList.contains('af-live-tieins')).toBe(true)
  })
})

describe('inside a league, nothing says "1 league"', () => {
  it('no "1 league" chip, no "· 1 league" in the head, and nothing to open on the row', () => {
    const { container } = render(<LiveScores data={liveSlate()} selectedLeagueId="L1" matchupStrip={scored()} />)
    const card = container.querySelector('.af-live-slate > .af-live-game') as HTMLElement
    expect(card.querySelector('.af-live-mine-count')).toBeNull()
    expect(card.querySelector('.af-live-tieins-head')!.textContent).toBe('Your starters · 2 players')
    expect(card.querySelector('.af-live-mine-row button.af-live-mine-toggle')).toBeNull()
    expect(card.querySelector('.af-live-mine-pts')!.textContent).toBe('8.4 pts')
  })

  it('control: across leagues the count and the league list stay', () => {
    const data = page([game('1', { tieIns: [tie({ playerId: 'a', playerName: 'Ann' }), tie({ playerId: 'a', playerName: 'Ann', leagueId: 'L2', leagueName: 'Bravo' })] })])
    const { container } = render(<LiveScores data={data} />)
    const card = container.querySelector('.af-live-slate > .af-live-game') as HTMLElement
    expect(card.querySelector('.af-live-mine-count')!.textContent).toBe('2 leagues')
    expect(card.querySelector('.af-live-tieins-head')!.textContent).toBe('Your starters · 1 player · 2 leagues')
  })

  it('one sport chip inside a league; "All games" brings every sport back', () => {
    const { container, getByRole } = render(<LiveScores data={liveSlate()} selectedLeagueId="L1" matchupStrip={scored()} />)
    expect([...container.querySelectorAll('.af-live-sport')].map((b) => b.textContent)).toEqual(['NFL2'])
    fireEvent.click(getByRole('button', { name: 'All games' }))
    expect([...container.querySelectorAll('.af-live-sport')].map((b) => b.textContent)).toEqual(['NFL2', 'NBA9', 'NHL5'])
  })
})

describe('Around the league is one line until opened', () => {
  const lg = (live: boolean): ScoreboardGame =>
    ({
      matchupId: Math.random(),
      teams: [
        { rosterId: 'a', teamName: 'Ants', managerName: null, avatarUrl: null, points: live ? 20 : null, projected: 90, projectedFrom: 9, starterCount: 9 },
        { rosterId: 'b', teamName: 'Bees', managerName: null, avatarUrl: null, points: live ? 16 : null, projected: 80, projectedFrom: 9, starterCount: 9 },
      ],
      winProbability: null,
      unplayed: !live,
    }) as unknown as ScoreboardGame

  it('closed, and the line counts the games being played', () => {
    const { getByTestId } = render(<LiveLeagueGames leagueId="L1" data={{ week: 10, allUnplayed: false, games: [lg(true), lg(true), lg(false)], weekFinal: false }} />)
    const box = getByTestId('live-league-games') as HTMLDetailsElement
    expect(box.tagName).toBe('DETAILS')
    expect(box.open).toBe(false)
    expect(getByTestId('live-league-games-summary').textContent).toBe('2 games live')
  })

  it('with nothing live it counts the games', () => {
    const { getByTestId } = render(<LiveLeagueGames leagueId="L1" data={{ week: 10, allUnplayed: true, games: [lg(false), lg(false)], weekFinal: false }} />)
    expect(getByTestId('live-league-games-summary').textContent).toBe('2 games')
  })
})

describe('Spanish', () => {
  it('the headline, the matchup line and the fold read in Spanish', () => {
    L.lang = 'es'
    const { container, getByTestId } = render(<LiveScores data={liveSlate()} selectedLeagueId="L1" matchupStrip={scored()} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Vas perdiendo 29.0–41.7 · 3 titulares jugando ahora')
    expect(visibleText(getByTestId('live-matchup-line'))).toBe(
      'contra Dolphins (B2B Champs) · 8% de ganar  · te quedan 16 por jugar, a ellos 14 · Abrir enfrentamiento',
    )
    expect(container.querySelector('[data-testid="live-box-score"] summary')!.textContent).toBe('Estadísticas del partido')
    expect(container.querySelector('.af-live-tieins-head')!.textContent).toBe('Tus titulares · 2 jugadores')
  })

  it('never says «waiver»', () => {
    const es = liveGuideMessages.es!
    const text = [es.headScore!('trail', false, '1', '2', 3), es.headScore!('lead', true, '1', '2', 0), es.leftBoth!(1, 2), es.boxScore, es.openMatchup, es.stripStale]
    expect(text.join(' ').toLowerCase()).not.toContain('waiver')
  })
})
