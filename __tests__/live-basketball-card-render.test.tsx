/**
 * The basketball score card as rendered: Q1–Q4 / OT (college: 1H 2H / OT) line
 * score headers, and each team's leaders and shooting side by side.
 */
import React from 'react'
import { render, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
vi.mock('@/components/MiniPlayerImg', () => ({
  default: ({ name }: { name: string }) => <span data-testid="face">{name}</span>,
}))

import { LiveScores } from '@/components/core-app/screens/LiveScores'
import type { LiveGameCard, LiveGameLeader, LivePageData, LiveTeamSide } from '@/lib/live/liveScoresPage'

const leader = (label: string, name: string, shortName: string, statLine: string, teamAbbrev: string): LiveGameLeader => ({
  label,
  name,
  shortName,
  statLine,
  position: null,
  headshot: null,
  teamAbbrev,
})

const side = (over: Partial<LiveTeamSide>): LiveTeamSide => ({
  abbrev: 'CHA',
  name: 'Charlotte Hornets',
  logo: '',
  score: 100,
  record: null,
  linescores: [30, 35, 25, 10],
  hits: null,
  errors: null,
  leaders: [],
  shooting: null,
  ...over,
})

function game(over: Partial<LiveGameCard> = {}): LiveGameCard {
  return {
    gameId: '401811026',
    sport: 'NBA',
    week: null,
    status: 'STATUS_IN_PROGRESS',
    statusDetail: '5:42 - 3rd',
    clockLabel: 'Q3 · 5:42',
    isLive: true,
    completed: false,
    startTime: '2026-04-10T23:00:00Z',
    away: side({
      abbrev: 'DET',
      name: 'Detroit Pistons',
      score: 118,
      linescores: [36, 32, 25, 25],
      leaders: [leader('Pts', 'Jalen Duren', 'J. Duren', '20', 'DET'), leader('Ast', 'Cade Cunningham', 'C. Cunningham', '7', 'DET')],
      shooting: {
        fieldGoals: { made: 45, attempted: 89, pct: '50.6' },
        threePointers: { made: 9, attempted: 27, pct: '33.3' },
        freeThrows: { made: 19, attempted: 26, pct: '73.1' },
      },
    }),
    home: side({
      leaders: [leader('Pts', 'LaMelo Ball', 'L. Ball', '27', 'CHA'), leader('Reb', 'Miles Bridges', 'M. Bridges', '8', 'CHA')],
      shooting: { fieldGoals: { made: 34, attempted: 88, pct: '38.6' }, threePointers: null, freeThrows: null },
    }),
    winProbability: null,
    topPerformer: null,
    leaders: [],
    situation: null,
    venue: null,
    broadcast: null,
    espnDetail: false,
    leadersArePregame: false,
    tieIns: [],
    leaguesAffected: 0,
    ...over,
  }
}

function page(g: LiveGameCard): LivePageData {
  return {
    sport: g.sport,
    scope: 'all',
    counts: [{ sport: g.sport, label: g.sport, slateCount: 1 }],
    games: [g],
    impact: { totalPoints: 0, livePlayers: 0, liveGames: 1, biggestMover: null, plays: [], upNext: [] },
    fetchedAt: new Date().toISOString(),
    hasRosterData: false,
    loadFailed: false,
    rosterFailed: false,
  }
}

const headers = (container: HTMLElement) =>
  [...container.querySelectorAll('.af-live-linescore thead th')].slice(1).map((th) => th.textContent)

describe('line score headers', () => {
  it('NBA: Q1–Q4 from the first quarter on, then T', () => {
    const { container } = render(
      <LiveScores data={page(game({ away: side({ abbrev: 'DET', linescores: [36, 32, 10] }), home: side({ linescores: [30, 35, 12] }) }))} />,
    )
    expect(headers(container)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'T'])
  })

  it('NBA double overtime adds OT and 2OT (DEN @ NY, 2026-02-04)', () => {
    const { container } = render(
      <LiveScores
        data={page(
          game({
            away: side({ abbrev: 'DEN', score: 127, linescores: [30, 23, 29, 26, 11, 8] }),
            home: side({ abbrev: 'NY', score: 134, linescores: [28, 27, 33, 20, 11, 15] }),
          }),
        )}
      />,
    )
    expect(headers(container)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'OT', '2OT', 'T'])
  })

  it('college basketball: two halves, then OT', () => {
    const halves = render(
      <LiveScores data={page(game({ sport: 'NCAAB', away: side({ abbrev: 'MISS', linescores: [38] }), home: side({ abbrev: 'ARK', linescores: [36] }) }))} />,
    )
    expect(headers(halves.container)).toEqual(['1H', '2H', 'T'])
    halves.unmount()
    const ot = render(
      <LiveScores data={page(game({ sport: 'NCAAB', away: side({ abbrev: 'MISS', linescores: [38, 36, 9] }), home: side({ abbrev: 'ARK', linescores: [40, 34, 7] }) }))} />,
    )
    expect(headers(ot.container)).toEqual(['1H', '2H', 'OT', 'T'])
  })

  it('control: football keeps 1 2 3 4', () => {
    const { container } = render(
      <LiveScores data={page(game({ sport: 'NFL', away: side({ abbrev: 'TB', linescores: [3, 0] }), home: side({ abbrev: 'CIN', linescores: [14, 0] }) }))} />,
    )
    expect(headers(container)).toEqual(['1', '2', '3', '4', 'T'])
  })
})

describe('team box', () => {
  it('shows each team leaders and shooting, away on the left', () => {
    const { container } = render(<LiveScores data={page(game())} />)
    const sides = container.querySelectorAll('.af-live-teambox-side')
    expect([...sides].map((s) => s.getAttribute('aria-label'))).toEqual(['DET leaders', 'CHA leaders'])

    const cha = sides[1] as HTMLElement
    expect([...cha.querySelectorAll('.af-live-teambox-name')].map((n) => n.textContent)).toEqual(['L. Ball', 'M. Bridges'])
    expect(cha.querySelector('.af-live-teambox-name')!.getAttribute('title')).toBe('LaMelo Ball')
    expect(within(cha).getByText('27')).toBeInTheDocument()
    expect(within(cha).getByText('Pts')).toBeInTheDocument()
    // Only the lines ESPN sent: CHA's fixture has field goals and nothing else.
    expect([...cha.querySelectorAll('.af-live-teambox-shot')].map((s) => s.textContent)).toEqual(['FG34-88 38.6%'])

    const det = sides[0] as HTMLElement
    expect([...det.querySelectorAll('.af-live-teambox-shot dd')].map((s) => s.textContent)).toEqual([
      '45-89 50.6%',
      '9-27 33.3%',
      '19-26 73.1%',
    ])
  })

  it('is absent when neither team has anything yet', () => {
    const { container } = render(
      <LiveScores data={page(game({ away: side({ abbrev: 'DET', linescores: [] }), home: side({ linescores: [] }) }))} />,
    )
    expect(container.querySelector('.af-live-teambox')).toBeNull()
  })

  it('control: a football card never draws one, even carrying the same fields', () => {
    const { container } = render(<LiveScores data={page(game({ sport: 'NFL' }))} />)
    expect(container.querySelector('.af-live-teambox')).toBeNull()
  })
})
