import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { WaiversBoard } from '@/components/core-app/boards/WaiversBoard'
import type { WaiverBoardRow, WaiversBoardData, WaiverSportSection } from '@/lib/core-app/waiversBoard'

/**
 * The Waivers board's sport sections. On origin/main an account whose leagues were all basketball
 * saw "None of your leagues could be priced this week — the reasons are below" and nothing below.
 */

const nbaRow: WaiverBoardRow = {
  leagueId: 'B1',
  leagueName: 'Hoops League',
  platform: 'manual',
  platformLeagueId: null,
  logoUrl: null,
  format: 'Redraft · Points',
  netGain: 32,
  add: { playerId: 'pim-free', name: 'Free Centre', position: 'C', team: 'DEN', imageUrl: null, projected: 44, ownPct: null, startPct: null },
  drop: { playerId: 'pim-bench', name: 'Me Bench', position: 'SG', team: null, imageUrl: null, projected: 12, ownPct: null, startPct: null },
  faabRemaining: 64,
  runsAt: null,
  href: '/core/waivers?league=B1',
  reasoning: "Free Centre (C) projects 44.0 per game on AllFantasy's default scoring.",
  sport: 'NBA',
}

const section = (over: Partial<WaiverSportSection>): WaiverSportSection => ({
  sport: 'NBA',
  state: 'ok',
  reason: null,
  basis: 'season_per_game_af_default',
  basisLabel: "Per-game points from AllFantasy's NBA season projection, on AllFantasy's default NBA scoring.",
  season: 2026,
  rows: [nbaRow],
  considered: 2,
  withheld: { noRoster: 0, idSpace: 1, noScoring: 0, noCandidate: 0, noUpgrade: 0 },
  ...over,
})

const onlyOtherSports = (sports: WaiverSportSection[]): WaiversBoardData => ({
  rows: [],
  considered: 0,
  withheld: { noRoster: 0, idSpace: 0, noScoring: 0, noCandidate: 0, noUpgrade: 0 },
  marketLeagues: 0,
  at: { season: '2026', week: 4 },
  weekKickoffs: null,
  sports,
})

const soccer = section({
  sport: 'SOCCER',
  state: 'no_producer',
  reason: 'No projection exists for soccer players: our stats provider serves no soccer player season stats.',
  basis: null,
  basisLabel: null,
  season: null,
  rows: [],
  considered: 1,
  withheld: { noRoster: 0, idSpace: 0, noScoring: 0, noCandidate: 0, noUpgrade: 0 },
})

describe('WaiversBoard — sport sections', () => {
  it('gives a basketball-only account its basketball section, not an NFL empty state', () => {
    const { container } = render(<WaiversBoard data={onlyOtherSports([section({}), soccer])} allHref="/x" totalLeagues={3} />)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/could be priced this week/)
    expect(text).not.toMatch(/No team is claimed/)
    expect(text).not.toMatch(/re-scored under that league/)
    expect(container.querySelector('[data-testid="waivers-sport-NBA"]')).not.toBeNull()
    expect(text).toContain('NBA · top 1 · ranked by lineup gain per game')
  })

  it('prints every season-rate figure per game, never per week', () => {
    const { container } = render(<WaiversBoard data={onlyOtherSports([section({})])} allHref="/x" totalLeagues={2} />)
    const nba = container.querySelector('[data-testid="waivers-sport-NBA"]')!
    expect(nba.textContent).toContain('+32.0 pts/g')
    expect(nba.textContent).toContain('Proj pts/g')
    expect(nba.textContent).not.toContain('pts/wk')
    expect(nba.querySelector('[aria-label="Lineup gain +32.0 projected points per game"]')).not.toBeNull()
    expect(nba.textContent).toContain('season rate, 2026')
    expect(nba.textContent).toContain("AllFantasy's default NBA scoring")
  })

  it('never opens a player card on a projection key', () => {
    const { container } = render(<WaiversBoard data={onlyOtherSports([section({})])} allHref="/x" totalLeagues={2} />)
    const names = [...container.querySelectorAll('[data-testid="waivers-sport-NBA"] .af-bd-asset-name')]
    expect(names.length).toBe(2)
    for (const n of names) expect(n.querySelector('button')).toBeNull()
  })

  it("names a section's excluded leagues, and a sport with no producer by its reason", () => {
    const { container } = render(<WaiversBoard data={onlyOtherSports([section({}), soccer])} allHref="/x" totalLeagues={3} />)
    const nba = container.querySelector('[data-testid="waivers-sport-NBA"]')?.textContent ?? ''
    expect(nba).toMatch(/1 league is not on this board/)
    const sx = container.querySelector('[data-testid="waivers-sport-SOCCER"]')?.textContent ?? ''
    expect(sx).toContain('No projection exists for soccer players')
    expect(sx).toContain('1 league')
  })

  it("counts the sections' rows in the footer", () => {
    const { container } = render(<WaiversBoard data={onlyOtherSports([section({}), soccer])} allHref="/x" totalLeagues={3} />)
    expect(container.textContent).toContain('2 more leagues are not on this board')
  })

  it('labels the NFL rows as NFL only when other sports share the board', () => {
    const nflRow: WaiverBoardRow = { ...nbaRow, leagueId: 'N1', sport: undefined, netGain: 5 }
    const data: WaiversBoardData = { ...onlyOtherSports([section({})]), rows: [nflRow], considered: 1 }
    const { container } = render(<WaiversBoard data={data} allHref="/x" totalLeagues={2} />)
    expect(container.textContent).toContain('NFL · Top 1 · ranked by lineup gain')
    expect(container.textContent).toContain('+5.0 pts/wk')
  })

  it('marks every card list as the Waivers board, so its phone layout cannot reach Trades or Draft HQ', () => {
    const nflRow: WaiverBoardRow = { ...nbaRow, leagueId: 'N1', sport: undefined, netGain: 5 }
    const data: WaiversBoardData = { ...onlyOtherSports([section({})]), rows: [nflRow], considered: 1 }
    const { container } = render(<WaiversBoard data={data} allHref="/x" totalLeagues={2} />)
    const lists = [...container.querySelectorAll('ul.af-bd-cards')]
    expect(lists.length).toBe(2) // the NFL list and the basketball section
    for (const ul of lists) expect(ul.classList.contains('af-bd-cards--waivers')).toBe(true)
  })
})
