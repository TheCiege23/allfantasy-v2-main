import { describe, expect, it } from 'vitest'
import {
  allPlayShare,
  formatRecord,
  oddsTone,
  optimalLineupLists,
  optimalLineupListsRespectingLocks,
  ordinal,
  pairScoreboard,
  positionTone,
  powerOrder,
  projectedTotal,
  readPlayoffFormat,
  shortPlayerName,
  slotPillLabel,
  streakTone,
  waiverTrendByPlayer,
  signed,
} from '@/lib/league/native/nativeScreenModels'

describe('formatting', () => {
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 112].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '112th'])
    expect(ordinal(0)).toBeNull()
    expect(ordinal(Number.NaN)).toBeNull()
  })
  it('records and names', () => {
    expect(formatRecord({ wins: 3, losses: 1 })).toBe('3–1')
    expect(formatRecord({ wins: 3, losses: 1, ties: 1 })).toBe('3–1–1')
    expect(shortPlayerName('Jalen Hurts')).toBe('J. Hurts')
    expect(shortPlayerName('Amon-Ra St. Brown')).toBe('A. St. Brown')
    expect(shortPlayerName('Ravens D/ST')).toBe('Ravens D/ST')
    expect(signed(9)).toBe('+9')
    expect(signed(-3)).toBe('−3')
    expect(signed(0)).toBe('0')
  })
  it('position tones and slot labels', () => {
    expect(positionTone('qb')).toBe('qb')
    expect(positionTone('DST')).toBe('def')
    expect(positionTone('SUPER_FLEX')).toBe('flex')
    expect(positionTone('LB')).toBe('other')
    expect(slotPillLabel('SUPER_FLEX')).toBe('SF')
    expect(slotPillLabel('FLEX')).toBe('FLX')
    expect(slotPillLabel('')).toBe('—')
  })
})

describe('pairScoreboard', () => {
  const rows = [
    { rosterId: 'a', teamName: 'A', totalPoints: 100, opponentRosterId: 'b' },
    { rosterId: 'b', teamName: 'B', totalPoints: 90, opponentRosterId: 'a' },
    { rosterId: 'c', teamName: 'C', totalPoints: 80, opponentRosterId: 'd' },
    { rosterId: 'd', teamName: 'D', totalPoints: 70, opponentRosterId: 'c' },
    { rosterId: 'e', teamName: 'E', totalPoints: 60, opponentRosterId: null },
  ]
  it('lists each matchup once, viewer first, and keeps a lone row', () => {
    const pairs = pairScoreboard(rows, 'd')
    expect(pairs).toHaveLength(3)
    expect(pairs[0].mine).toBe(true)
    expect([pairs[0].home.rosterId, pairs[0].away?.rosterId]).toEqual(['c', 'd'])
    expect(pairs.find((p) => p.home.rosterId === 'e')?.away).toBeNull()
  })
})

describe('readPlayoffFormat', () => {
  it.each([null, undefined, 0])('uses the saved NBA playoff week when the column is %s', (column) => {
    expect(readPlayoffFormat({ playoff_structure: { playoff_start_week: 22, playoff_weeks: 3, playoff_team_count: 6, first_round_byes: 2 } }, column)).toMatchObject({ startWeek: 22, weeks: 3, teams: 6, byes: 2 })
  })
  it.each([null, '', ' ', false])('does not turn an unset numeric setting (%s) into zero', (value) => {
    expect(readPlayoffFormat({ playoff_start_week: value, playoff_team_count: value, first_round_byes: value, playoff_weeks: value }, null)).toEqual({ teams: null, byes: null, startWeek: null, weeks: null, consolation: null, reseed: null })
  })
  it('retains valid zero byes and rejects week zero', () => {
    expect(readPlayoffFormat({ playoff_start_week: 0, first_round_byes: 0 })).toMatchObject({ startWeek: null, byes: 0 })
  })

  it('prefers playoff_structure, then top level, then the column', () => {
    const f = readPlayoffFormat({ playoff_structure: { playoff_team_count: 6, first_round_byes: 2 }, playoff_team_count: 4, toilet_bowl_enabled: true }, 15)
    expect(f).toEqual({ teams: 6, byes: 2, startWeek: 15, weeks: 3, consolation: 'toilet_bowl', reseed: null })
  })
  it('reads reseeding from reseed_behavior or the in-app "Re-seed" seeding rule', () => {
    expect(readPlayoffFormat({ playoff_structure: { reseed_behavior: 'reseed_after_round' } }).reseed).toBe(true)
    expect(readPlayoffFormat({ playoff_structure: { seeding_rules: 'reseed' } }).reseed).toBe(true)
    expect(readPlayoffFormat({ playoff_structure: { reseed_behavior: 'fixed_bracket' } }).reseed).toBe(false)
  })
  it('returns nulls for keys the league never set, never a guess', () => {
    expect(readPlayoffFormat(null)).toEqual({ teams: null, byes: null, startWeek: null, weeks: null, consolation: null, reseed: null })
  })

  it('the playoffLowerBracket column — what the bracket is built from — wins over stale JSON flags', () => {
    const stale = { toilet_bowl_enabled: false, consolation_bracket_enabled: true }
    expect(readPlayoffFormat(stale, 15, 'toilet').consolation).toBe('toilet_bowl')
    expect(readPlayoffFormat({ toilet_bowl_enabled: true }, 15, 'consolation').consolation).toBe('consolation')
    expect(readPlayoffFormat({ toilet_bowl_enabled: true }, 15, 'consolation_bracket').consolation).toBe('consolation')
    expect(readPlayoffFormat(stale, 15, 'none').consolation).toBe('none')
    // Any other set value plays no lower bracket, exactly as getBracketConfigForLeague reads it.
    expect(readPlayoffFormat(stale, 15, 'toilet_bowl').consolation).toBe('none')
  })

  it('[control] with the column unset the JSON flags still decide', () => {
    expect(readPlayoffFormat({ consolation_bracket_enabled: true }, 15, null).consolation).toBe('consolation')
    expect(readPlayoffFormat({ toilet_bowl_enabled: true }, 15, '').consolation).toBe('toilet_bowl')
    expect(readPlayoffFormat({}, 15, undefined).consolation).toBeNull()
  })
})

describe('standings helpers', () => {
  it('streak and odds tones', () => {
    expect(streakTone('W4')).toBe('good')
    expect(streakTone('L1')).toBe('bad')
    expect(streakTone(null)).toBe('neutral')
    expect(oddsTone(97)).toBe('good')
    expect(oddsTone(43)).toBe('accent')
    expect(oddsTone(14)).toBe('warn')
    expect(oddsTone(1)).toBe('bad')
    expect(oddsTone(null)).toBe('neutral')
  })
  it('power order uses all-play share, then points for', () => {
    expect(allPlayShare('7-4-0')).toBeCloseTo(7 / 11)
    expect(allPlayShare('nope')).toBeNull()
    const order = powerOrder([
      { rosterId: 'low', allPlay: '2-9', pointsFor: 500 },
      { rosterId: 'high', allPlay: '9-2', pointsFor: 300 },
      { rosterId: 'none', allPlay: null, pointsFor: 999 },
      { rosterId: 'tie', allPlay: '9-2', pointsFor: 400 },
    ])
    expect(order.map((r) => r.rosterId)).toEqual(['tie', 'high', 'low', 'none'])
  })
})

describe('waiverTrendByPlayer', () => {
  it('adds +2, drops −1, pending claims +1', () => {
    const m = waiverTrendByPlayer(
      [{ addPlayerId: 'x', dropPlayerId: 'y' }, { addPlayerId: 'x', dropPlayerId: null }],
      [{ addPlayerId: 'x' }, { addPlayerId: 'z' }],
    )
    expect(m.get('x')).toBe(5)
    expect(m.get('y')).toBe(-1)
    expect(m.get('z')).toBe(1)
  })
})

describe('optimalLineupLists', () => {
  const slots = [
    { index: 0, label: 'QB', allowedPositions: ['QB'], isFlexible: false },
    { index: 1, label: 'RB', allowedPositions: ['RB'], isFlexible: false },
    { index: 2, label: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'], isFlexible: true },
  ]
  const players = {
    qb1: { position: 'QB', projectedPoints: 20 },
    rb1: { position: 'RB', projectedPoints: 8 },
    rb2: { position: 'RB', projectedPoints: 15 },
    wr1: { position: 'WR', projectedPoints: 12 },
    wr2: { position: 'WR', projectedPoints: 3 },
  }
  it('seats the highest projections legally and benches the rest', () => {
    const next = optimalLineupLists(slots, { starters: ['qb1', 'rb1', 'wr2'], bench: ['rb2', 'wr1'], ir: ['hurt'], taxi: [], devy: [] }, players)
    expect(next?.starters[0]).toBe('qb1')
    expect(new Set(next?.starters.slice(1))).toEqual(new Set(['rb2', 'wr1']))
    expect(next?.starters[1]).toBe('rb2')
    expect(new Set(next?.bench)).toEqual(new Set(['rb1', 'wr2']))
    expect(next?.ir).toEqual(['hurt'])
    expect(projectedTotal(next!.starters, players)).toBe(47)
  })
  it('returns null when the lineup is already optimal', () => {
    expect(optimalLineupLists(slots, { starters: ['qb1', 'rb2', 'wr1'], bench: ['rb1', 'wr2'], ir: [], taxi: [], devy: [] }, players)).toBeNull()
  })
  it('never moves a locked player', () => {
    // rb1 (starter) has kicked off; wr1 (bench) has kicked off. Only QB + FLEX may be re-solved.
    const lists = { starters: ['qb1', 'rb1', 'wr2'], bench: ['rb2', 'wr1'], ir: [], taxi: [], devy: [] }
    const locked = new Set(['rb1', 'wr1'])
    const next = optimalLineupListsRespectingLocks(slots, lists, players, (id) => locked.has(id))
    expect(next?.starters).toEqual(['qb1', 'rb1', 'rb2'])
    expect(next?.bench).toContain('wr1')
    expect(next?.bench).toContain('wr2')
    expect(next?.bench).not.toContain('rb2')
  })
  it('keeps a locked low scorer in his slot instead of re-solving around him', () => {
    const lists = { starters: ['qb1', 'rb1', 'wr2'], bench: ['rb2'], ir: [], taxi: [], devy: [] }
    const next = optimalLineupListsRespectingLocks(slots, lists, players, (id) => id === 'wr2')
    expect(next?.starters).toEqual(['qb1', 'rb2', 'wr2'])
    expect(next?.bench).toEqual(['rb1'])
  })
  it('returns null when every slot is locked', () => {
    const lists = { starters: ['qb1', 'rb1', 'wr2'], bench: ['rb2'], ir: [], taxi: [], devy: [] }
    expect(optimalLineupListsRespectingLocks(slots, lists, players, () => true)).toBeNull()
  })
  it('returns null rather than a lineup with an empty seat', () => {
    expect(optimalLineupLists(slots, { starters: ['', 'rb1', 'wr1'], bench: [], ir: [], taxi: [], devy: [] }, players)).toBeNull()
  })
})
