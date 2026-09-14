/**
 * The WNBA game view and score card, rendered from real feed values (NY Liberty @
 * Dallas Wings, 2026-07-20, Final/OT 99-98): quarters then OT, the WNBA court
 * (NBA lane, college arc), and a box score that shows ESPN's `reason` only where a
 * player did not play — the WNBA feed sends "COACH'S DECISION" on every player.
 */
import React from 'react'
import { render, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
vi.mock('@/components/MiniPlayerImg', () => ({
  default: ({ name }: { name: string }) => <span data-testid="face">{name}</span>,
}))

import { LiveGameView } from '@/components/core-app/screens/LiveGameView'
import { LiveScores } from '@/components/core-app/screens/LiveScores'
import { trimEspnGameSummary } from '@/lib/live/espnGameSummary'
import type { LiveGameCard, LiveTeamSide } from '@/lib/live/liveScoresPage'
import { WNBA_OPTS, rawWnba } from './fixtures/espn-wnba-summary'

const view = () =>
  render(
    <LiveGameView
      initial={{ detail: trimEspnGameSummary(rawWnba(), WNBA_OPTS), stale: false, failed: false }}
      sport="WNBA"
      gameId="401892393"
      backHref="/core/live?sport=WNBA"
    />,
  )

describe('LiveGameView — WNBA', () => {
  it('line score has four quarters then OT', () => {
    const { container } = view()
    expect([...container.querySelectorAll('.af-gv-lines thead th')].map((th) => th.textContent)).toEqual(['', '1', '2', '3', '4', 'OT', 'T'])
  })

  it('shot chart draws the WNBA court: the 16 ft lane with the 22 ft 1.75 in arc', () => {
    const { container } = view()
    const lines = container.querySelector('.af-gv-court-lines[data-court="wnba"]') as SVGElement
    expect(lines.querySelector('rect')!.getAttribute('width')).toBe('16')
    expect(lines.querySelector('path')!.getAttribute('d')).toMatch(/^M3\.35 0 .*A22\.15 22\.15/)
    const court = container.querySelector('.af-gv-court') as SVGElement
    expect(court.querySelectorAll('.af-gv-shot[data-made="true"]')).toHaveLength(2)
    expect(court.querySelectorAll('.af-gv-shot[data-made="false"]')).toHaveLength(1)
  })

  it("box score: the reason appears only on the player who did not play", () => {
    const { container } = view()
    const ny = container.querySelector('.af-gv-box-team[data-team="9"]') as HTMLElement
    expect(within(ny).getByText('B. Stewart')).toBeInTheDocument()
    expect(within(ny).getByText('Bench')).toBeInTheDocument()
    expect(within(ny).getAllByText(/COACH'S DECISION/)).toHaveLength(1)
    expect(within(ny).getByText("DNP · COACH'S DECISION")).toBeInTheDocument()
  })
})

const side = (over: Partial<LiveTeamSide>): LiveTeamSide => ({
  abbrev: 'DAL',
  name: 'Dallas Wings',
  logo: '',
  score: 60,
  record: null,
  linescores: [22, 25, 13],
  hits: null,
  errors: null,
  leaders: [
    { label: 'Pts', name: 'Arike Ogunbowale', shortName: 'A. Ogunbowale', statLine: '18', position: 'G', headshot: null, teamAbbrev: 'DAL' },
  ],
  shooting: { fieldGoals: { made: 24, attempted: 50, pct: '48.0' }, threePointers: null, freeThrows: null },
  ...over,
})

function card(): LiveGameCard {
  return {
    gameId: '401892393',
    sport: 'WNBA',
    week: null,
    status: 'STATUS_IN_PROGRESS',
    statusDetail: '4:12 - 3rd',
    clockLabel: 'Q3 · 4:12',
    isLive: true,
    completed: false,
    startTime: '2026-07-20T23:00:00Z',
    away: side({ abbrev: 'NY', name: 'New York Liberty', score: 59, linescores: [25, 25, 9], leaders: [], shooting: null }),
    home: side({}),
    winProbability: null,
    topPerformer: null,
    leaders: [],
    situation: null,
    venue: null,
    broadcast: null,
    espnDetail: false,
    tieIns: [],
    leaguesAffected: 0,
  }
}

describe('WNBA score card', () => {
  it('shows Q1–Q4 from the third quarter on, and the team box', () => {
    const g = card()
    const { container } = render(
      <LiveScores
        data={{
          sport: 'WNBA', scope: 'all', counts: [{ sport: 'WNBA', label: 'WNBA', slateCount: 1 }], games: [g],
          impact: { totalPoints: 0, livePlayers: 0, liveGames: 1, biggestMover: null, plays: [], upNext: [] },
          fetchedAt: new Date().toISOString(), hasRosterData: false, loadFailed: false, rosterFailed: false,
        }}
      />,
    )
    expect([...container.querySelectorAll('.af-live-linescore thead th')].slice(1).map((th) => th.textContent)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'T'])
    const dal = container.querySelector('.af-live-teambox-side[aria-label="DAL leaders"]') as HTMLElement
    expect(within(dal).getByText('A. Ogunbowale')).toBeInTheDocument()
    expect(dal.querySelector('.af-live-teambox-shot dd')!.textContent).toBe('24-50 48.0%')
  })
})
