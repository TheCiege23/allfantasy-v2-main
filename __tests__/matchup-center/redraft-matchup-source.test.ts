/**
 * Redraft matchup source — deterministic unit/regression tests (G11 Phase 2c).
 * Covers the pure core of the pairing/roster adapter (no DB): side-context build
 * (starter filtering, readable DEF names, engine totals, records), home/away
 * selection, bye handling, and week-status normalization.
 */
import { describe, expect, it } from 'vitest'
import {
  buildRedraftSideContext,
  selectRedraftMatchupContext,
  normalizeRedraftWeekStatus,
  type RosterWithPlayers,
} from '@/server/services/matchupSources/redraftMatchupSource'

function roster(over: Partial<RosterWithPlayers> & { id: string }): RosterWithPlayers {
  return {
    ownerName: 'Owner',
    teamName: null,
    avatarUrl: null,
    wins: 0,
    losses: 0,
    ties: 0,
    players: [],
    ...over,
  }
}

const QB = { playerId: 'qb1', playerName: 'S. Darnold', position: 'QB', team: 'SEA', slotType: 'QB' }
const RB = { playerId: 'rb1', playerName: 'J. Cook', position: 'RB', team: 'BUF', slotType: 'RB' }
const BENCH = { playerId: 'bn1', playerName: 'Bench Guy', position: 'WR', team: 'NYJ', slotType: 'BN' }
const DEF = { playerId: 'nfl:def:KC', playerName: 'nfl:def:KC', position: 'DEF', team: 'KC', slotType: 'DEF' }

describe('week status normalization', () => {
  it('maps redraft statuses to canonical', () => {
    expect(normalizeRedraftWeekStatus('final')).toBe('final')
    expect(normalizeRedraftWeekStatus('in_progress')).toBe('live')
    expect(normalizeRedraftWeekStatus('scheduled')).toBe('upcoming')
    expect(normalizeRedraftWeekStatus(null)).toBe('upcoming')
  })
})

describe('buildRedraftSideContext', () => {
  it('keeps only starters and excludes bench', () => {
    const side = buildRedraftSideContext(roster({ id: 'r1', players: [QB, RB, BENCH] }), 88.5, 'live')
    expect(side.starters.map((s) => s.id)).toEqual(['qb1', 'rb1'])
    expect(side.starters.find((s) => s.id === 'bn1')).toBeUndefined()
  })

  it('REGRESSION: a raw nfl:def id renders as a readable team-defense name (no leak)', () => {
    const side = buildRedraftSideContext(roster({ id: 'r1', players: [DEF] }), 19, 'live')
    const def = side.starters[0]
    expect(def.name).toBe('KC Defense')
    expect(def.position).toBe('DEF')
    expect(side.starters.some((s) => /nfl:def:/i.test(String(s.name)))).toBe(false)
  })

  it('carries the scoring season/week so scores are looked up under RedraftSeason.season', () => {
    // Redraft scores live under RedraftSeason.season (often != League.season). The
    // side context must carry that season/week so the canonical lookup hits them.
    const side = buildRedraftSideContext(roster({ id: 'r1', players: [QB] }), 20, 'live', { season: 2090, week: 1 })
    expect(side.scoreSeason).toBe(2090)
    expect(side.scoreWeek).toBe(1)
  })

  it('leaves scoring season/week undefined when not provided (generic falls back to League.season)', () => {
    const side = buildRedraftSideContext(roster({ id: 'r1', players: [QB] }), 20, 'live')
    expect(side.scoreSeason).toBeUndefined()
    expect(side.scoreWeek).toBeUndefined()
  })

  it('carries the engine total, record, and team name', () => {
    const side = buildRedraftSideContext(
      roster({ id: 'r1', teamName: 'NewYorkJets!', wins: 1, losses: 2, ties: 0, players: [QB] }),
      78.77,
      'live',
    )
    expect(side.engineTotalPoints).toBe(78.77)
    expect(side.record).toEqual({ wins: 1, losses: 2, ties: 0 })
    expect(side.teamName).toBe('NewYorkJets!')
  })

  it('falls back to owner name when no team name', () => {
    expect(buildRedraftSideContext(roster({ id: 'r1', ownerName: 'Fitzy37' }), 0, 'upcoming').teamName).toBe('Fitzy37')
  })
})

describe('selectRedraftMatchupContext — pairing', () => {
  const home = roster({ id: 'home', teamName: 'Home', players: [QB] })
  const away = roster({ id: 'away', teamName: 'Away', players: [RB] })

  it('selected = home → opponent = away, with correct engine totals per side', () => {
    const ctx = selectRedraftMatchupContext({
      selectedRosterId: 'home',
      selectedFallback: home,
      homeRosterId: 'home',
      homeRoster: home,
      awayRoster: away,
      homeScore: 147.36,
      awayScore: 143.82,
      status: 'in_progress',
    })
    expect(ctx.kind).toBe('matchup')
    if (ctx.kind !== 'matchup') return
    expect(ctx.selected.teamName).toBe('Home')
    expect(ctx.selected.engineTotalPoints).toBe(147.36)
    expect(ctx.opponent.teamName).toBe('Away')
    expect(ctx.opponent.engineTotalPoints).toBe(143.82)
    expect(ctx.selected.weekStatus).toBe('live')
  })

  it('selected = away → sides + scores swap correctly', () => {
    const ctx = selectRedraftMatchupContext({
      selectedRosterId: 'away',
      selectedFallback: away,
      homeRosterId: 'home',
      homeRoster: home,
      awayRoster: away,
      homeScore: 100,
      awayScore: 120,
      status: 'final',
    })
    if (ctx.kind !== 'matchup') throw new Error('expected matchup')
    expect(ctx.selected.teamName).toBe('Away')
    expect(ctx.selected.engineTotalPoints).toBe(120)
    expect(ctx.opponent.engineTotalPoints).toBe(100)
  })

  it('no opponent roster → bye (never invents a pairing)', () => {
    const ctx = selectRedraftMatchupContext({
      selectedRosterId: 'home',
      selectedFallback: home,
      homeRosterId: 'home',
      homeRoster: home,
      awayRoster: null,
      homeScore: 90,
      awayScore: 0,
      status: 'scheduled',
    })
    expect(ctx.kind).toBe('bye')
    if (ctx.kind !== 'bye') return
    expect(ctx.selected.teamName).toBe('Home')
  })

  it('REGRESSION: both teams + player rows render and DEF is readable end-to-end', () => {
    const h = roster({ id: 'home', teamName: 'Jets', players: [QB, DEF] })
    const a = roster({ id: 'away', teamName: 'Pats', players: [RB] })
    const ctx = selectRedraftMatchupContext({
      selectedRosterId: 'home',
      selectedFallback: h,
      homeRosterId: 'home',
      homeRoster: h,
      awayRoster: a,
      homeScore: 78.77,
      awayScore: 82.22,
      status: 'in_progress',
    })
    if (ctx.kind !== 'matchup') throw new Error('expected matchup')
    expect(ctx.selected.starters).toHaveLength(2)
    expect(ctx.opponent.starters).toHaveLength(1)
    expect(ctx.selected.starters.find((s) => s.id === 'nfl:def:KC')?.name).toBe('KC Defense')
    // total exposed to the UI equals the engine-persisted RedraftMatchup score
    expect(ctx.selected.engineTotalPoints).toBe(78.77)
    expect(ctx.opponent.engineTotalPoints).toBe(82.22)
  })
})
