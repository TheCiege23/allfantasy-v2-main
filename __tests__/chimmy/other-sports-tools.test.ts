import { describe, expect, it, vi } from 'vitest'

/**
 * Pickups and lineups outside the NFL, from data already in our database. The rule that matters
 * most: every number is labelled as AllFantasy's STANDARD per-game projection, never as this
 * league's points — and a sport with no projection base is refused, never ranked from memory.
 */

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/ai-payload/resolveAiTeamContext', () => ({ resolveNames: vi.fn() }))
vi.mock('@/lib/decision-os/world', () => ({ resolveCanonicalWorld: vi.fn() }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({ getPlayerPoolForLeague: vi.fn() }))

import { buildOtherSportAvailableContext } from '@/lib/chimmy/tools/availablePlayersOtherSports'
import { buildBaselineLineupContext, supportsBaselineLineup } from '@/lib/chimmy/lineupOptimizerOtherSports'
import type { BaselineIndex } from '@/lib/chimmy/afBaselineIndex'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'

function index(sport: string, rows: Array<[string, string, number] | [string, null]>): BaselineIndex {
  const byName = new Map<string, { name: string; position: string | null; perGame: number } | null>()
  for (const r of rows) byName.set(normalizePlayerName(r[0]), r[1] === null ? null : { name: r[0], position: r[1], perGame: r[2] as number })
  return { sport, season: 2026, byName }
}

const pool = (id: string, name: string, position: string, extra: Record<string, unknown> = {}) =>
  ({ player_id: id, full_name: name, position, team_abbreviation: 'BOS', external_source_id: null, sleeper_id: null, injury_status: null, ...extra }) as never

describe('get_available_players outside the NFL', () => {
  const deps = (players: unknown[], idx: BaselineIndex) => ({ pool: vi.fn(async () => players as never), baseline: vi.fn(async () => idx) })

  it('subtracts the league rosters from the sport pool and ranks by the labelled per-game projection', async () => {
    const d = deps(
      [pool('p1', 'Jayson Tatum', 'SF'), pool('p2', 'Jaylen Brown', 'SG', { injury_status: 'Questionable' }), pool('p3', 'Al Horford', 'C'), pool('p4', 'Nobody Projected', 'PG')],
      index('NBA', [['Jayson Tatum', 'SF', 51.2], ['Jaylen Brown', 'SG', 40.5], ['Al Horford', 'C', 22.0]]),
    )
    const out = await buildOtherSportAvailableContext({ leagueName: 'Hoops', sport: 'NBA', leagueId: 'L1', rostered: new Set(['p1']) }, d)
    expect(out).toMatch(/only published for NFL/)
    expect(out).toMatch(/standard per-game projection/)
    expect(out).toMatch(/NOT re-scored under this league's own rules/)
    expect(out).not.toMatch(/Jayson Tatum/) // rostered
    expect(out).toMatch(/1\. Jaylen Brown \(SG, BOS\) — 40\.5 pts per game \[Questionable\]/)
    expect(out).toMatch(/2\. Al Horford \(C, BOS\) — 22\.0 pts per game/)
    expect(out).toMatch(/1 other unrostered players have no projection/)
  })

  it('never ranks soccer — there is no projection base', async () => {
    const d = deps([pool('s1', 'Bukayo Saka', 'MID')], index('SOCCER', []))
    const out = await buildOtherSportAvailableContext({ leagueName: 'EPL', sport: 'SOCCER', leagueId: 'L1', rostered: new Set(['x']) }, d)
    expect(out).toMatch(/no SOCCER projections to rank them by/)
    expect(out).not.toMatch(/Saka/)
    expect(d.baseline).not.toHaveBeenCalled()
  })

  it('names nobody when rosters have not synced', async () => {
    const d = deps([pool('p1', 'Jayson Tatum', 'SF')], index('NBA', [['Jayson Tatum', 'SF', 51]]))
    const out = await buildOtherSportAvailableContext({ leagueName: 'Hoops', sport: 'NBA', leagueId: 'L1', rostered: new Set() }, d)
    expect(out).toMatch(/do NOT name any players/)
    expect(d.pool).not.toHaveBeenCalled()
  })

  it('gives an ambiguous name no number', async () => {
    const d = deps([pool('p9', 'Mike Williams', 'OF')], index('MLB', [['Mike Williams', null]]))
    const out = await buildOtherSportAvailableContext({ leagueName: 'Diamonds', sport: 'MLB', leagueId: 'L1', rostered: new Set(['x']) }, d)
    expect(out).toMatch(/None of the 1 unrostered MLB players has an AllFantasy projection/)
  })
})

describe('optimize_my_lineup outside the NFL (baseline)', () => {
  const world = (sport: string, slots: string[] | null, starters: string[]) =>
    ({
      league: { sport, rosterSettings: { starterSlots: slots } },
      teams: [{ teamId: 't1', managerUserId: 'u1' }],
      rosters: [{ rosterId: 'r1', teamId: 't1', playerIds: ['a', 'b', 'c', 'd', 'e'], starterIds: starters, reserveIds: [], taxiIds: [] }],
    }) as never

  const players = new Map([
    ['a', { name: 'Point Guard', position: 'PG', team: 'BOS' }],
    ['b', { name: 'Shooting Guard', position: 'SG', team: 'BOS' }],
    ['c', { name: 'Big Man', position: 'C', team: 'BOS' }],
    ['d', { name: 'Bench Star', position: 'PG/SG', team: 'BOS' }],
    ['e', { name: 'No Projection', position: 'C', team: 'BOS' }],
  ])
  const idx = index('NBA', [['Point Guard', 'PG', 30], ['Shooting Guard', 'SG', 18], ['Big Man', 'C', 25], ['Bench Star', 'PG', 28]])
  const deps = (w: unknown) => ({ resolveWorld: vi.fn(async () => w as never), loadPlayers: vi.fn(async () => players as never), baseline: vi.fn(async () => idx) })

  it('fills the league slots from the per-game projection and labels the basis', async () => {
    const out = await buildBaselineLineupContext({ leagueId: 'L1', userId: 'u1' }, deps(world('NBA', ['PG', 'G', 'C', 'BN'], ['a', 'b', 'c'])))
    expect(out).toMatch(/standard per-game projection/)
    expect(out).toMatch(/PG: Point Guard .* 30\.0\/game/)
    expect(out).toMatch(/G: Bench Star .* 28\.0\/game/)
    expect(out).toMatch(/START Bench Star .*; BENCH Shooting Guard/)
    expect(out).toMatch(/That adds 10\.0 per-game pts/)
    expect(out).toMatch(/WHO PLAYS TODAY/)
    expect(out).toMatch(/propose_lineup_change/)
  })

  it('refuses a slot it does not understand rather than leaving it out', async () => {
    const out = await buildBaselineLineupContext({ leagueId: 'L1', userId: 'u1' }, deps(world('NBA', ['PG', 'WEIRD'], ['a'])))
    expect(out).toMatch(/NOT COMPUTED/)
    expect(out).toMatch(/WEIRD/)
  })

  it('refuses soccer by name', async () => {
    expect(supportsBaselineLineup('SOCCER')).toBe(false)
    const out = await buildBaselineLineupContext({ leagueId: 'L1', userId: 'u1' }, deps(world('SOCCER', ['GK'], [])))
    expect(out).toMatch(/NOT COMPUTED/)
    expect(out).toMatch(/no SOCCER projections/)
  })

  it.each(['NBA', 'NHL', 'MLB', 'NCAAB', 'NCAAF'])('supports %s', (sport) => expect(supportsBaselineLineup(sport)).toBe(true))
})
