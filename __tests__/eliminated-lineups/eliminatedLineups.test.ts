/** Lineup minimums for eliminated teams — the pure rules (lib/eliminated-lineups/eliminatedLineups.ts). */
import { describe, expect, it } from 'vitest'
import {
  describeRule,
  describeShortfall,
  eliminatedTeams,
  lineupShortfall,
  meetsMinimum,
  parseEliminatedLineupRule,
  readEliminatedLineupRule,
  type StandingTeam,
} from '@/lib/eliminated-lineups/eliminatedLineups'

const team = (rosterId: string, wins: number, losses: number, ties = 0, playoffSeed: number | null = null): StandingTeam => ({ rosterId, wins, losses, ties, playoffSeed })
// 6 teams, 2 make it. After 11 weeks the line (2nd place) has 8 wins.
const TABLE = [team('a', 9, 2), team('b', 8, 3), team('c', 6, 5), team('d', 5, 6), team('e', 4, 6, 1), team('f', 2, 9)]

describe('who is out of the race', () => {
  it('in the regular season: more wins behind the line than games left, and nobody else', () => {
    // Week 12 of a season whose playoffs start in week 15: 3 games left (12, 13, 14).
    const out = eliminatedTeams({ teams: TABLE, playoffTeams: 2, playoffStartWeek: 15, currentWeek: 12 })
    expect([...out.keys()].sort()).toEqual(['e', 'f'])
    expect(out.get('f')).toBe('cannot_reach_line')
    // d is exactly 3 back with 3 to play: it can still tie the line, so it is NOT out.
    expect(out.has('d')).toBe(false)
  })

  it('a tie counts half a win', () => {
    // e: 4.5 against the line's 8 → 3.5 back with 3 to play: out. Without the tie it is 4 back.
    const withoutTie = eliminatedTeams({ teams: TABLE.map((t) => (t.rosterId === 'e' ? { ...t, ties: 0, wins: 5 } : t)), playoffTeams: 2, playoffStartWeek: 15, currentWeek: 12 })
    expect(withoutTie.has('e')).toBe(false)
  })

  it('in a playoff week, the teams without a seed — but only once seeds are set', () => {
    const seeded = TABLE.map((t, i) => ({ ...t, playoffSeed: i < 2 ? i + 1 : null }))
    expect([...eliminatedTeams({ teams: seeded, playoffTeams: 2, playoffStartWeek: 15, currentWeek: 15 }).values()]).toEqual(Array(4).fill('missed_playoffs'))
    expect(eliminatedTeams({ teams: TABLE, playoffTeams: 2, playoffStartWeek: 15, currentWeek: 15 }).size).toBe(0)
  })

  it('nobody, when everyone makes the playoffs or the season is not readable', () => {
    expect(eliminatedTeams({ teams: TABLE, playoffTeams: 6, playoffStartWeek: 15, currentWeek: 12 }).size).toBe(0)
    expect(eliminatedTeams({ teams: TABLE, playoffTeams: 2, playoffStartWeek: 0, currentWeek: 12 }).size).toBe(0)
    expect(eliminatedTeams({ teams: TABLE, playoffTeams: 2, playoffStartWeek: 15, currentWeek: 0 }).size).toBe(0)
  })
})

describe('what a lineup is short of', () => {
  const st = (playerId: string, extra: { byeWeek?: number; injuryStatus?: string; started?: boolean } = {}) => ({
    playerId, byeWeek: extra.byeWeek ?? null, injuryStatus: extra.injuryStatus ?? null, started: extra.started ?? false,
  })
  const lineup = [st('ok'), st('bye', { byeWeek: 12 }), st('out', { injuryStatus: 'Out' }), st('ir', { injuryStatus: 'IR' }), st('q', { injuryStatus: 'Questionable' }), null]

  it('"filled" counts only empty slots', () => {
    expect(lineupShortfall({ starters: lineup, week: 12, standard: 'filled' })).toEqual({ emptySlots: 1, byeStarters: [], outStarters: [] })
  })

  it('"playable" adds byes and Out/IR — never Questionable', () => {
    expect(lineupShortfall({ starters: lineup, week: 12, standard: 'playable' })).toEqual({ emptySlots: 1, byeStarters: ['bye'], outStarters: ['out', 'ir'] })
  })

  it('a starter whose game has started is not held against the lineup', () => {
    const s = lineupShortfall({ starters: [st('out', { injuryStatus: 'Out', started: true }), st('bye', { byeWeek: 12, started: true })], week: 12, standard: 'playable' })
    expect(meetsMinimum(s)).toBe(true)
  })

  it('a bye in another week is not a bye this week', () => {
    expect(meetsMinimum(lineupShortfall({ starters: [st('p', { byeWeek: 9 })], week: 12, standard: 'playable' }))).toBe(true)
  })

  it('is said in English and Spanish', () => {
    const s = { emptySlots: 2, byeStarters: ['k'], outStarters: ['m'] }
    const name = (id: string) => ({ k: 'Travis Kelce', m: 'Joe Mixon' })[id] ?? id
    expect(describeShortfall(s, name)).toBe('2 empty slots; Travis Kelce on a bye; Joe Mixon listed Out/IR')
    expect(describeShortfall(s, name, 'es')).toBe('2 puestos vacíos; Travis Kelce en semana de descanso; Joe Mixon listado Out/IR')
  })
})

describe('the rule', () => {
  it('reads only a well-formed rule that is on', () => {
    expect(readEliminatedLineupRule({ eliminated_lineup_minimum: { enabled: true, standard: 'filled', autoFill: true } })).toEqual({ standard: 'filled', autoFill: true })
    expect(readEliminatedLineupRule({ eliminated_lineup_minimum: { enabled: true, standard: 'playable' } })).toEqual({ standard: 'playable', autoFill: false })
    for (const bad of [{ enabled: false, standard: 'filled' }, { enabled: 'yes', standard: 'filled' }, { enabled: true, standard: 'strict' }, true, 'on', null]) {
      expect(readEliminatedLineupRule({ eliminated_lineup_minimum: bad })).toBeNull()
    }
    expect(readEliminatedLineupRule(null)).toBeNull()
  })

  it('a save stores it on or off, and refuses anything else', () => {
    expect(parseEliminatedLineupRule({ enabled: true, standard: 'playable', autoFill: true })).toEqual({ ok: true, value: { enabled: true, standard: 'playable', autoFill: true } })
    expect(parseEliminatedLineupRule({ enabled: false })).toEqual({ ok: true, value: { enabled: false } })
    expect(parseEliminatedLineupRule(null)).toEqual({ ok: true, value: { enabled: false } })
    for (const bad of [{ enabled: true }, { enabled: true, standard: 'strict' }, { enabled: true, standard: 'filled', autoFill: 'yes' }, { standard: 'filled' }, 'on', []]) {
      expect(parseEliminatedLineupRule(bad).ok).toBe(false)
    }
  })

  it('is described for members and Chimmy in both languages', () => {
    expect(describeRule({ standard: 'filled', autoFill: false })).toBe('League rule: a team out of the playoff race must still start a lineup with no empty slots.')
    expect(describeRule({ standard: 'playable', autoFill: true })).toMatch(/no starters on a bye.*fills only those slots from the team’s own bench/)
    expect(describeRule({ standard: 'playable', autoFill: true }, 'es')).toMatch(/^Regla de la liga: un equipo eliminado.*con la banca del equipo\.$/)
  })
})
