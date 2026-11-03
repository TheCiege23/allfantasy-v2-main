import { describe, expect, it } from 'vitest'
import {
  REDRAFT_POSITION_FILTERS,
  bracketColumns,
  claimStatusLabel,
  dailyOffDayIds,
  faabMeter,
  isFootballTheme,
  isOnBye,
  playoffRaceStatus,
  redraftPositionTone,
  sideGameCounts,
  slotGameState,
  tradeCardState,
  tradeDeadlineLabel,
  tradeDeadlineState,
  waiverClaimTypeLabel,
} from '@/lib/league-media/redraftScreens'
import { REDRAFT_SPORT_THEMES } from '@/lib/league-media/redraftIdentity'

describe('redraftPositionTone — the same letters mean different jobs by sport', () => {
  it('reads C, G, SF and DEF by sport, not globally', () => {
    expect(redraftPositionTone('nba', 'C')).toBe('amber') // centre
    expect(redraftPositionTone('nhl', 'C')).toBe('blue') // centre
    expect(redraftPositionTone('mlb', 'C')).toBe('violet') // catcher
    expect(redraftPositionTone('nba', 'G')).toBe('blue') // guard
    expect(redraftPositionTone('nhl', 'G')).toBe('red') // goalie
    expect(redraftPositionTone('nba', 'SF')).toBe('green') // small forward
    expect(redraftPositionTone('nfl', 'SF')).toBe('flex') // superflex slot
    expect(redraftPositionTone('nfl', 'DEF')).toBe('slate') // team defence
    expect(redraftPositionTone('soccer', 'DEF')).toBe('blue') // defender
  })

  it('keeps the football palette the native screens already used', () => {
    expect(['QB', 'RB', 'WR', 'TE', 'K'].map(p => redraftPositionTone('nfl', p))).toEqual(['red', 'green', 'blue', 'amber', 'violet'])
    expect(redraftPositionTone('ncaaf', 'WR')).toBe('blue')
    // College football has no team-defence slot.
    expect(redraftPositionTone('ncaaf', 'DEF')).toBeNull()
  })

  it('maps reserve and flex slots in every sport, and returns null for an unknown label', () => {
    for (const s of REDRAFT_SPORT_THEMES) {
      expect(redraftPositionTone(s, 'BN')).toBe('bench')
      expect(redraftPositionTone(s, 'ir')).toBe('ir')
      expect(redraftPositionTone(s, 'XYZ')).toBeNull()
      expect(redraftPositionTone(s, '')).toBeNull()
    }
    expect(redraftPositionTone('nba', 'UTIL')).toBe('flex')
    expect(redraftPositionTone('mlb', 'DH')).toBe('flex')
  })

  it('gives every position a sport filters on a tone, so no filter chip is uncoloured', () => {
    for (const s of REDRAFT_SPORT_THEMES) {
      for (const p of REDRAFT_POSITION_FILTERS[s]) expect(redraftPositionTone(s, p), `${s} ${p}`).not.toBeNull()
    }
  })

  it('only football gets the rushing / receiving / passing table', () => {
    expect(REDRAFT_SPORT_THEMES.filter(isFootballTheme)).toEqual(['nfl', 'ncaaf'])
  })
})

describe('dailyOffDayIds — an off day needs a schedule that was actually read', () => {
  it('marks an explicit null opponent when another row names one', () => {
    const ids = dailyOffDayIds([{ id: 'a', periodOpponent: 'BOS' }, { id: 'b', periodOpponent: null }, { id: 'c' }])
    expect([...ids]).toEqual(['b'])
  })

  it('marks nobody when no row names an opponent (schedule not loaded)', () => {
    expect(dailyOffDayIds([{ id: 'a', periodOpponent: null }, { id: 'b', periodOpponent: null }]).size).toBe(0)
    expect(dailyOffDayIds(null).size).toBe(0)
  })

  it('does not treat an absent field as "no game"', () => {
    expect(dailyOffDayIds([{ id: 'a', periodOpponent: 'DEN' }, { id: 'b' }]).size).toBe(0)
  })
})

describe('isOnBye', () => {
  it('trusts a BYE opponent or a bye week equal to this week, nothing else', () => {
    expect(isOnBye({ opponent: 'BYE' }, 9)).toBe(true)
    expect(isOnBye({ opponent: 'KC', byeWeek: 9 }, 9)).toBe(true)
    expect(isOnBye({ opponent: 'KC', byeWeek: 10 }, 9)).toBe(false)
    expect(isOnBye({ opponent: null, byeWeek: null }, 9)).toBe(false)
    expect(isOnBye({ byeWeek: 9 }, null)).toBe(false)
    expect(isOnBye(null, 9)).toBe(false)
  })
})

describe('matchup state', () => {
  it('reads only the three known states; unknown is not "upcoming"', () => {
    expect(slotGameState('live')).toBe('live')
    expect(slotGameState('final')).toBe('final')
    expect(slotGameState('upcoming')).toBe('upcoming')
    expect(slotGameState('unknown')).toBeNull()
    expect(slotGameState(undefined)).toBeNull()
  })

  it('counts a side by known states only', () => {
    expect(sideGameCounts([{ gameStatus: 'live' }, { gameStatus: 'final' }, { gameStatus: 'final' }, { gameStatus: 'unknown' }])).toEqual({ live: 1, final: 2, upcoming: 0 })
  })
})

describe('waivers', () => {
  it('names the claim system, and drops an unrecognised one', () => {
    expect(waiverClaimTypeLabel('faab')).toBe('FAAB bidding')
    expect(waiverClaimTypeLabel('rolling')).toBe('Rolling priority')
    expect(waiverClaimTypeLabel('reverse_standings')).toBe('Reverse standings')
    expect(waiverClaimTypeLabel('fcfs')).toBe('First come, first served')
    expect(waiverClaimTypeLabel('survivor_guillotine')).toBeNull()
    expect(waiverClaimTypeLabel(null)).toBeNull()
  })

  it('builds a FAAB meter only from a real balance and a positive budget', () => {
    expect(faabMeter(64, 100)).toEqual({ remaining: 64, budget: 100, spent: 36, pct: 64 })
    expect(faabMeter(null, 100)).toBeNull()
    expect(faabMeter(64, null)).toBeNull()
    expect(faabMeter(64, 0)).toBeNull()
    // A balance above the budget (a commissioner grant) fills the bar, never past it.
    expect(faabMeter(120, 100)?.pct).toBe(100)
  })

  it('labels the server claim statuses and drops an unknown one', () => {
    expect(claimStatusLabel('pending')?.label).toBe('Pending')
    expect(claimStatusLabel(undefined)?.label).toBe('Pending')
    expect(claimStatusLabel('processed')?.label).toBe('Won')
    expect(claimStatusLabel('failed')?.label).toBe('Lost')
    expect(claimStatusLabel('cancelled')?.label).toBe('Cancelled')
    expect(claimStatusLabel('mystery')).toBeNull()
  })
})

describe('trades', () => {
  it('reads the deadline from settings against the current week', () => {
    expect(tradeDeadlineState(null, 5)).toEqual({ kind: 'none' })
    expect(tradeDeadlineState(12, null)).toEqual({ kind: 'set', week: 12 })
    expect(tradeDeadlineState(12, 9)).toEqual({ kind: 'open', week: 12, weeksLeft: 3 })
    expect(tradeDeadlineState(12, 12)).toEqual({ kind: 'final', week: 12 })
    expect(tradeDeadlineState(12, 13)).toEqual({ kind: 'passed', week: 12 })
  })

  it('says it in words', () => {
    expect(tradeDeadlineLabel(tradeDeadlineState(null, 1))).toBe('No trade deadline')
    expect(tradeDeadlineLabel(tradeDeadlineState(12, 11))).toBe('Deadline · Wk 12 · 1 week left')
    expect(tradeDeadlineLabel(tradeDeadlineState(12, 9))).toBe('Deadline · Wk 12 · 3 weeks left')
    expect(tradeDeadlineLabel(tradeDeadlineState(12, 14))).toBe('Deadline passed · Wk 12')
  })

  it('names the open trade states from the real status, and nothing for an unknown one', () => {
    expect(tradeCardState('pending')?.label).toBe('Awaiting response')
    expect(tradeCardState('awaiting_commissioner')?.label).toBe('Commissioner review')
    expect(tradeCardState('accepted')?.tone).toBe('good')
    expect(tradeCardState('weird')).toBeNull()
  })
})

describe('playoffRaceStatus — clinched / eliminated only once the bracket exists', () => {
  const seeds = [{ rosterId: 'a' }, { rosterId: 'b' }]
  it('claims nothing before the bracket is generated, even with seeds and an eliminated list', () => {
    expect(playoffRaceStatus({ bracket: { generated: false }, seeds }, 'a')).toBeNull()
    expect(playoffRaceStatus({ bracket: { generated: false }, seeds }, 'z')).toBeNull()
    expect(playoffRaceStatus(null, 'a')).toBeNull()
  })

  it('splits seeded and unseeded teams once it is generated', () => {
    expect(playoffRaceStatus({ bracket: { generated: true }, seeds }, 'a')).toBe('clinched')
    expect(playoffRaceStatus({ bracket: { generated: true }, seeds }, 'z')).toBe('eliminated')
    expect(playoffRaceStatus({ bracket: { generated: true, championRosterId: 'b' }, seeds }, 'b')).toBe('champion')
  })

  it('claims nothing from a generated bracket with no seeds', () => {
    expect(playoffRaceStatus({ bracket: { generated: true }, seeds: [] }, 'a')).toBeNull()
  })
})

describe('bracketColumns', () => {
  const names: Record<string, string> = { a: 'Alpha', b: 'Bravo', c: 'Charlie' }
  const m = (over: Record<string, unknown>) => ({ matchupId: 'm', homeRosterId: null, awayRosterId: null, homeSeed: null, awaySeed: null, homeScore: null, awayScore: null, winnerRosterId: null, ...over })
  it('orders rounds, keeps byes and TBD slots, and marks the viewer and the winner', () => {
    const cols = bracketColumns(
      [
        { roundId: 'r2', roundNumber: 2, roundName: 'Final', matchups: [m({ matchupId: 'f' })] },
        { roundId: 'r1', roundNumber: 1, roundName: 'Semis', matchups: [m({ matchupId: 's1', homeRosterId: 'a', homeSeed: 1, bye: true }), m({ matchupId: 's2', homeRosterId: 'b', awayRosterId: 'c', homeScore: 101, awayScore: 99, winnerRosterId: 'b', complete: true })] },
      ],
      id => names[id] ?? null,
      'c',
    )
    expect(cols.map(c => c.name)).toEqual(['Semis', 'Final'])
    expect(cols[0].games[0]).toMatchObject({ bye: true, away: null, home: { name: 'Alpha', seed: 1 } })
    expect(cols[0].games[1]).toMatchObject({ state: 'final', viewer: true, home: { won: true }, away: { won: false, name: 'Charlie' } })
    expect(cols[1].games[0]).toMatchObject({ state: 'scheduled', home: { name: null }, away: { name: null } })
  })
})
