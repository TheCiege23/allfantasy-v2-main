import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

// The week banner's refresh control calls useRouter, which needs an app router outside one.
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import Matchup from '@/components/core-app/screens/Matchup'
import type { MatchupData, MatchupPlayerCell, MatchupSlot } from '@/lib/core-app/matchup'
import { lineupHoles, slotFamily, swingGame, toWin } from '@/lib/core-app/matchupInsights'

/*
 * The 2026-11-01 Matchup redesign: the dark broadcast scoreboard, three insight cards under it, a
 * state chip on every live starter, and position-tinted slot chips.
 *
 * 🛑 THE CARDS ARE THE PART THAT CAN LIE. Each is drawn only when the stored data answers it, so most
 * of this file is about ABSENCE: no swing game without placed games, no lineup check without a
 * certain zero, no "to win" before kickoff or after the final whistle — and no bench, ever, because
 * the loader carries none.
 */

afterEach(() => {
  cleanup()
  lang.language = 'en'
})

function cell(name: string, over: Partial<MatchupPlayerCell> = {}): MatchupPlayerCell {
  return {
    playerId: name, sleeperId: name, name, position: 'WR', team: 'DET', sport: 'NFL', imageUrl: null,
    projected: 10, afEngine: null, actual: null, empty: false, unavailable: null, gameState: 'final', ...over,
  }
}

const SUN_NIGHT = '2026-11-09T01:20:00.000Z'

/** Brown Pig Bandits vs Gridiron Goons, NFL week 9, Sunday evening. */
function slots(): MatchupSlot[] {
  return [
    { slotLabel: 'QB', you: cell('Jalen Hurts', { position: 'QB', team: 'PHI', actual: 24.6 }), opponent: cell('Lamar Jackson', { position: 'QB', team: 'BAL', projected: 24.1, gameState: 'upcoming', actual: 0, kickoff: SUN_NIGHT, opponentClub: 'CIN', home: true }) },
    { slotLabel: 'RB', you: cell('Bijan Robinson', { position: 'RB', team: 'ATL', actual: 14.2, gameState: 'live' }), opponent: cell('Derrick Henry', { position: 'RB', team: 'BAL', projected: 17.8, gameState: 'upcoming', actual: 0, kickoff: SUN_NIGHT, opponentClub: 'CIN', home: true }) },
    { slotLabel: 'WR', you: cell("Ja'Marr Chase", { team: 'CIN', projected: 18.4, gameState: 'upcoming', actual: 0, kickoff: SUN_NIGHT, opponentClub: 'BAL', home: false }), opponent: cell('Amon-Ra St. Brown', { actual: 21.4 }) },
    { slotLabel: 'WR', you: cell('Garrett Wilson', { team: 'NYJ', projected: 0, actual: 0, unavailable: 'bye' }), opponent: cell('Puka Nacua', { team: 'LAR', actual: 9.6 }) },
    { slotLabel: 'FLEX', you: cell("De'Von Achane", { position: 'RB', team: 'MIA', projected: 15.2, gameState: 'upcoming', actual: 0, kickoff: '2026-11-10T01:15:00.000Z', opponentClub: 'KC', home: true }), opponent: cell('James Cook', { position: 'RB', team: 'BUF', actual: 12, gameState: 'live' }) },
    { slotLabel: 'DEF', you: cell('Ravens', { position: 'DEF', team: 'BAL', projected: 8.1, gameState: 'upcoming', actual: 0, kickoff: SUN_NIGHT, opponentClub: 'CIN', home: true }), opponent: cell('Steelers', { position: 'DEF', team: 'PIT', actual: 6 }) },
  ]
}

function data(state: 'upcoming' | 'live' | 'final' = 'live', lineup: MatchupSlot[] = slots()): MatchupData {
  const scored = state !== 'upcoming'
  const team = (teamName: string, isYou: boolean) => ({ teamName, ownerName: isYou ? 'guap' : 'goon', record: isYou ? '6-2' : '5-3', isYou, avatarUrl: null })
  return {
    league: { id: 'l1', name: 'Brown Pig League', platform: 'sleeper', sport: 'NFL', logoUrl: null, sourceLink: null, lineupLink: null },
    week: { available: true, data: { week: 9, season: 2026, isFinal: state === 'final' } },
    teams: { available: true, data: { you: team('Brown Pig Bandits', true), opponent: team('Gridiron Goons', false) } },
    sides: scored
      ? { available: true, data: { you: { ...team('Brown Pig Bandits', true), points: 38.8 }, opponent: { ...team('Gridiron Goons', false), points: 49 } } }
      : { available: false, reason: 'not scored yet' },
    lineups: { available: true, data: lineup },
    identityNote: null,
    playerScoring: scored ? { available: true, data: { playersScored: 12, source: 'Sleeper' } } : { available: false, reason: 'projections' },
    winProbability: { available: true, data: { pWin: 0.42, detail: 'model', confidence: 'medium' } },
    projectedFinal: { available: true, data: { you: 101.9, opponent: 108.9, model: 'starters', unprojected: { you: 0, opponent: 0 } } },
    yetToPlay: { available: false, reason: 'tally' },
    starterCountsBySide: {
      you: { upcoming: 3, live: 1, final: 2, unknown: 0 },
      opponent: { upcoming: 2, live: 1, final: 3, unknown: 0 },
    },
  } as MatchupData
}

describe('the scoreboard', () => {
  it('shows both scored totals big, with the live line under each: proj · left to play · live', () => {
    const { container } = render(<Matchup data={data('live')} />)
    const board = container.querySelector('.af-mu-h2h') as HTMLElement
    expect([...board.querySelectorAll('.af-mu-score')].map((n) => n.textContent)).toEqual(['38.8', '49.0'])
    const lines = [...board.querySelectorAll('.af-mu-score-line')].map((n) => n.textContent)
    expect(lines).toEqual(['proj 101.9' + '4 left to play' + '1 live', 'proj 108.9' + '3 left to play' + '1 live'])
    expect(within(board).getByText('42%')).toBeTruthy()
  })

  it('never puts a projection under a FINAL score, and no live line before kickoff', () => {
    const final = render(<Matchup data={data('final')} />)
    expect(final.container.querySelectorAll('.af-mu-score-proj')).toHaveLength(0)
    expect(final.container.querySelectorAll('.af-mu-live-n')).toHaveLength(0)
    cleanup()
    const pre = render(<Matchup data={data('upcoming')} />)
    expect(pre.container.querySelectorAll('.af-mu-score-line')).toHaveLength(0)
  })

  it('drops the "N live" count when any starter’s game state is unknown — a partial count reads as fewer', () => {
    const d = data('live')
    d.starterCountsBySide = { you: { upcoming: 3, live: 1, final: 1, unknown: 1 }, opponent: d.starterCountsBySide!.opponent }
    const { container } = render(<Matchup data={d} />)
    expect(container.querySelectorAll('.af-mu-live-n')).toHaveLength(1)
  })
})

describe('insight cards — present only with data', () => {
  it('draws all three on a live week with placed games, a bye starter and stored projections', () => {
    const { container } = render(<Matchup data={data('live')} />)
    const kinds = [...container.querySelectorAll('.af-mu-insight')].map((n) => n.getAttribute('data-kind'))
    expect(kinds).toEqual(['swing', 'lineup', 'to-win'])
  })

  it('swing game: the game with starters on both sides, named away @ home, counted against all remaining', () => {
    const g = swingGame(data('live'), 'live')!
    expect(g.label).toBe('CIN @ BAL')
    expect(g.yours).toEqual(["Ja'Marr Chase", 'Ravens'])
    expect(g.theirs).toEqual(['Lamar Jackson', 'Derrick Henry'])
    // 4 of the 7 who can still score: Bijan (live), Chase, Achane, Ravens · Lamar, Henry, Cook (live).
    expect(g.inGame).toBe(4)
    expect(g.remaining).toBe(7)
    render(<Matchup data={data('live')} />)
    expect(screen.getByText(/Your Ja'Marr Chase and Ravens against their Lamar Jackson and Derrick Henry\. 4 of 7/)).toBeTruthy()
  })

  it('no swing game when no starter can be placed in a game, and none on a final week', () => {
    const unplaced = slots().map((s) => ({
      ...s,
      you: s.you && { ...s.you, opponentClub: null },
      opponent: s.opponent && { ...s.opponent, opponentClub: null },
    }))
    expect(swingGame(data('live', unplaced), 'live')).toBeNull()
    expect(swingGame(data('final'), 'final')).toBeNull()
    const { container } = render(<Matchup data={data('live', unplaced)} />)
    expect(container.querySelector('.af-mu-insight[data-kind="swing"]')).toBeNull()
  })

  it('lineup check: names the certain zero, and is absent when nobody in your lineup is one', () => {
    expect(lineupHoles(data('live'), 'live')).toEqual([{ slot: 'WR', name: 'Garrett Wilson', reason: 'bye' }])
    render(<Matchup data={data('live')} />)
    expect(screen.getByText('Garrett Wilson will score nothing')).toBeTruthy()
    cleanup()
    const full = slots().map((s) => (s.you?.unavailable ? { ...s, you: cell('Puka Nacua', { actual: 9.6 }) } : s))
    const { container } = render(<Matchup data={data('live', full)} />)
    expect(container.querySelector('.af-mu-insight[data-kind="lineup"]')).toBeNull()
  })

  it('lineup check: an empty slot counts; an injury designation (he may play) does not', () => {
    const lineup = slots()
    lineup[0] = { ...lineup[0], you: cell('Jalen Hurts', { position: 'QB', injury: 'Questionable', actual: 24.6 }) }
    lineup[3] = { ...lineup[3], you: { ...cell(''), name: null, empty: true } }
    expect(lineupHoles(data('live', lineup), 'live')).toEqual([{ slot: 'WR', name: null, reason: 'empty' }])
  })

  it('to win: what you still need against their projected final, and what your unplayed starters project', () => {
    const w = toWin(data('live'), 'live', { you: 38.8, opponent: 49 })!
    expect(w.needed).toBe(70.1)
    // Chase 18.4 + Achane 15.2 + Ravens 8.1. Bijan is LIVE: part of his projection is already scored.
    expect(w.yourLeft).toBe(3)
    expect(w.yourLeftProjected).toBe(41.7)
    render(<Matchup data={data('live')} />)
    expect(screen.getByText('70.1 more points')).toBeTruthy()
    expect(screen.getByText(/Your 3 still to play project for 41\.7\./)).toBeTruthy()
  })

  it('to win: not before kickoff, not once final, and no remaining-projection sentence when one is unpriced', () => {
    expect(toWin(data('upcoming'), 'upcoming', null)).toBeNull()
    expect(toWin(data('final'), 'final', { you: 38.8, opponent: 49 })).toBeNull()
    const lineup = slots()
    lineup[2] = { ...lineup[2], you: { ...lineup[2].you!, projected: null } }
    expect(toWin(data('live', lineup), 'live', { you: 38.8, opponent: 49 })?.yourLeftProjected).toBeNull()
  })

  it('a final week draws no cards at all', () => {
    const { container } = render(<Matchup data={data('final')} />)
    expect(container.querySelector('.af-mu-insights')).toBeNull()
  })

  it('🛑 never draws a bench: the loader carries none, so there is no bench toggle and no bench total', () => {
    const { container } = render(<Matchup data={data('live')} />)
    expect(screen.queryByRole('button', { name: /bench/i })).toBeNull()
    expect(container.textContent).not.toMatch(/bench/i)
  })

  it('reads in Spanish from the catalog', () => {
    lang.language = 'es'
    render(<Matchup data={data('live')} />)
    expect(screen.getByText('Partido clave')).toBeTruthy()
    expect(screen.getByText('Garrett Wilson no sumará puntos')).toBeTruthy()
    expect(screen.getByText('70.1 puntos más')).toBeTruthy()
  })
})

describe('per-player state chips', () => {
  const chipOf = (container: HTMLElement, name: string) =>
    screen.getByText(name).closest('.af-mu-half')?.querySelector('.af-mu-chip')?.textContent ?? null

  it('LIVE on a starter playing now, FINAL on one whose game is over', () => {
    const { container } = render(<Matchup data={data('live')} />)
    expect(chipOf(container, 'Bijan Robinson')).toBe('LIVE')
    expect(chipOf(container, 'Jalen Hurts')).toBe('FINAL')
  })

  it('no FINAL chip over a starter on bye — he never played; his BYE flag says so', () => {
    const { container } = render(<Matchup data={data('live')} />)
    expect(chipOf(container, 'Garrett Wilson')).toBeNull()
    expect(screen.getByText('Garrett Wilson').closest('.af-mu-half')?.querySelector('.af-mu-flag')?.textContent).toBe('BYE')
  })

  it('an upcoming starter carries his game line, not a state chip', () => {
    const { container } = render(<Matchup data={data('live')} />)
    expect(chipOf(container, "Ja'Marr Chase")).toBeNull()
    expect(screen.getByText("Ja'Marr Chase").closest('.af-mu-half')?.querySelector('.af-mu-half-game')?.textContent).toMatch(/@ BAL/)
  })

  it('no chips at all on a board of projections before kickoff', () => {
    const { container } = render(<Matchup data={data('upcoming')} />)
    expect(container.querySelectorAll('.af-mu-chip')).toHaveLength(0)
  })
})

describe('slot chips are tinted by position family, read under the league’s sport', () => {
  it('maps NFL slots, and leaves a label it does not know untinted', () => {
    expect(['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF'].map((l) => slotFamily('NFL', l))).toEqual([
      'qb', 'rb', 'wr', 'te', 'flex', 'flex', 'k', 'k',
    ])
    expect(slotFamily('NFL', 'BN')).toBeNull()
  })

  it('"C" means a different position in each sport', () => {
    expect(slotFamily('NBA', 'C')).toBe('te')
    expect(slotFamily('MLB', 'C')).toBe('te')
    expect(slotFamily('NHL', 'C')).toBe('rb')
    expect(slotFamily('MLB', 'SP')).toBe('qb')
    expect(slotFamily('NHL', 'G')).toBe('te')
    expect(slotFamily('NBA', 'G')).toBe('wr')
  })

  it('renders data-pos on each slot cell', () => {
    const { container } = render(<Matchup data={data('live')} />)
    expect([...container.querySelectorAll('.af-mu-slot')].map((n) => n.getAttribute('data-pos'))).toEqual([
      'qb', 'rb', 'wr', 'wr', 'flex', 'k',
    ])
  })
})

describe('the stylesheet', () => {
  const CORE = readFileSync(join(process.cwd(), 'components/core-app/af-core.css'), 'utf8')
  const MATCHUP = readFileSync(join(process.cwd(), 'components/core-app/af-matchup.css'), 'utf8')
  const blockOf = (selector: string) => {
    const at = CORE.indexOf(`\n${selector} {`)
    return at < 0 ? '' : CORE.slice(at, CORE.indexOf('\n}', at))
  }

  it('🛑 the scoreboard ground is defined in every theme, and stays dark in light mode', () => {
    for (const sel of ['.af-core', "html[data-mode='light'] .af-core", "html[data-mode='legacy'] .af-core,\nhtml[data-mode='af'] .af-core"]) {
      expect(blockOf(sel)).toMatch(/--mu-sb-bg: #[0-9a-f]{6};/)
    }
    expect(blockOf("html[data-mode='light'] .af-core")).toMatch(/--mu-sb-bg: #11181c;/)
    expect(blockOf("html[data-mode='light'] .af-core")).toMatch(/--mu-sb-text: #ffffff;/)
  })

  it('the board re-points the ordinary tokens at its own ladder, naming no colour itself', () => {
    const at = MATCHUP.indexOf('.af-core .af-mu-h2h {')
    const rule = MATCHUP.slice(at, MATCHUP.indexOf('}', at))
    expect(rule).toMatch(/--surface: var\(--mu-sb-bg\);/)
    expect(rule).toMatch(/--text: var\(--mu-sb-text\);/)
    expect(MATCHUP.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('every slot tint the stylesheet reads is defined for the dark and light themes', () => {
    for (const fam of ['qb', 'rb', 'wr', 'te', 'flex', 'k']) {
      expect(MATCHUP).toContain(`var(--mu-pos-${fam}-bg)`)
      expect(blockOf('.af-core')).toContain(`--mu-pos-${fam}-bg:`)
      expect(blockOf("html[data-mode='light'] .af-core")).toContain(`--mu-pos-${fam}-bg:`)
    }
  })
})
