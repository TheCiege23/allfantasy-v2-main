import { describe, expect, it } from 'vitest'

import {
  buildAdpDeltaByOverall,
  buildAdpLookup,
  classifyManagerTendency,
  detectPositionRun,
  formatAdpDelta,
  formatSurvival,
  pickAdpDelta,
  positionTierRemaining,
  recentPickPositions,
  summarizeDraftValue,
  survivalProbability,
  survivalTone,
  type PulsePick,
  type PulsePoolPlayer,
} from '@/lib/draft-room/draftPulse'

function pick(overall: number, rosterId: string, playerName: string, position: string, playerId: string | null = null): PulsePick {
  return { overall, rosterId, displayName: rosterId.toUpperCase(), playerName, position, playerId }
}

const POOL: PulsePoolPlayer[] = [
  { playerId: 'p1', name: 'Nikola Jokic', position: 'C', adp: 1.2 },
  { playerId: 'p2', name: 'Jalen Brunson', position: 'PG', adp: 11 },
  { playerId: 'p3', name: 'Alperen Sengun', position: 'C', adp: 19 },
  { playerId: null, name: "De'Aaron Fox", position: 'PG', adp: 30 },
  { playerId: 'p5', name: 'Ja Morant', position: 'PG', adp: 31 },
  { playerId: 'p6', name: 'Jamal Murray', position: 'PG', adp: 33 },
  { playerId: 'p7', name: 'No Adp Guy', position: 'SF', adp: null },
]

describe('buildAdpLookup', () => {
  const lookup = buildAdpLookup(POOL)

  it('resolves by player id first', () => {
    expect(lookup({ playerId: 'p2', playerName: 'Wrong Name', position: 'SG' })).toBe(11)
  })

  it('falls back to normalized name + position', () => {
    expect(lookup({ playerId: null, playerName: 'DeAaron Fox', position: 'pg' })).toBe(30)
  })

  it('returns null for players without market ADP — never invents one', () => {
    expect(lookup({ playerId: 'p7', playerName: 'No Adp Guy', position: 'SF' })).toBeNull()
    expect(lookup({ playerId: 'zzz', playerName: 'Unknown', position: 'C' })).toBeNull()
  })
})

describe('pickAdpDelta / buildAdpDeltaByOverall', () => {
  it('is positive when a player is taken after ADP (value)', () => {
    expect(pickAdpDelta(26, 11)).toBe(15)
    expect(pickAdpDelta(11, 19)).toBe(-8)
    expect(pickAdpDelta(5, null)).toBeNull()
  })

  it('only badges picks at or beyond the threshold', () => {
    const lookup = buildAdpLookup(POOL)
    const picks = [
      pick(1, 'a', 'Nikola Jokic', 'C', 'p1'), // -0.2 → no badge
      pick(11, 'b', 'Alperen Sengun', 'C', 'p3'), // -8 → reach
      pick(26, 'c', 'Jalen Brunson', 'PG', 'p2'), // +15 → steal
      { ...pick(27, 'd', 'Ja Morant', 'PG', 'p5'), pickEditorEmpty: true }, // cleared cell
    ]
    expect(buildAdpDeltaByOverall(picks, lookup)).toEqual({ 11: -8, 26: 15 })
  })
})

describe('detectPositionRun', () => {
  it('finds a trailing same-position streak', () => {
    const picks = [pick(1, 'a', 'A', 'C'), pick(2, 'b', 'B', 'PG'), pick(3, 'c', 'C', 'PG'), pick(4, 'd', 'D', 'pg')]
    expect(detectPositionRun(picks)).toEqual({ position: 'PG', length: 3 })
  })

  it('returns null below the minimum and ignores input order', () => {
    const picks = [pick(3, 'c', 'C', 'PG'), pick(1, 'a', 'A', 'PG'), pick(2, 'b', 'B', 'C')]
    expect(detectPositionRun(picks)).toBeNull()
  })

  it('skips cleared cells instead of letting them break the run', () => {
    const picks = [
      pick(1, 'a', 'A', 'SF'),
      pick(2, 'b', 'B', 'SF'),
      { ...pick(3, 'c', '', 'C'), pickEditorEmpty: true },
      pick(4, 'd', 'D', 'SF'),
    ]
    expect(detectPositionRun(picks)).toEqual({ position: 'SF', length: 3 })
  })

  it('reports recent positions oldest first', () => {
    const picks = [pick(2, 'b', 'B', 'PG'), pick(1, 'a', 'A', 'C'), pick(3, 'c', 'C', 'SF')]
    expect(recentPickPositions(picks, 2)).toEqual(['PG', 'SF'])
  })
})

describe('positionTierRemaining', () => {
  it('lists available players at the position inside the horizon, by ADP — fallers included', () => {
    const tier = positionTierRemaining(POOL, 'PG', 22, 10)
    expect(tier.map((p) => p.name)).toEqual(['Jalen Brunson', "De'Aaron Fox", 'Ja Morant'])
  })
})

describe('summarizeDraftValue', () => {
  const lookup = buildAdpLookup(POOL)
  const picks = [
    pick(1, 'me', 'Nikola Jokic', 'C', 'p1'),
    pick(11, 'b', 'Alperen Sengun', 'C', 'p3'),
    pick(26, 'c', 'Jalen Brunson', 'PG', 'p2'),
    pick(32, 'me', 'Ja Morant', 'PG', 'p5'),
  ]

  it('totals only the viewer and finds the league extremes', () => {
    const s = summarizeDraftValue(picks, lookup, 'me')
    expect(s.viewerPicksWithAdp).toBe(2)
    expect(s.viewerTotal).toBeCloseTo(-0.2 + 1, 5)
    expect(s.biggestSteal?.playerName).toBe('Jalen Brunson')
    expect(s.biggestReach?.playerName).toBe('Alperen Sengun')
  })

  it('reports null (not zero) when the viewer has no ADP-backed picks', () => {
    expect(summarizeDraftValue(picks, lookup, 'nobody').viewerTotal).toBeNull()
    expect(summarizeDraftValue(picks, lookup, null).viewerTotal).toBeNull()
  })
})

describe('survivalProbability', () => {
  it('is 50% at ADP and moves the right way on either side', () => {
    expect(survivalProbability(40, 40)).toBeCloseTo(0.5, 5)
    expect(survivalProbability(60, 40)!).toBeGreaterThan(0.9)
    expect(survivalProbability(20, 40)!).toBeLessThan(0.1)
  })

  it('returns null without ADP', () => {
    expect(survivalProbability(null, 40)).toBeNull()
  })
})

describe('classifyManagerTendency', () => {
  const lookup = buildAdpLookup(POOL)

  it('needs a minimum sample', () => {
    const t = classifyManagerTendency([pick(11, 'b', 'Alperen Sengun', 'C', 'p3')], 'b', lookup)
    expect(t).toEqual({ kind: 'unknown', averageDelta: null, sample: 1 })
  })

  it('separates reachers, value hunters and ADP-loyal managers', () => {
    const reacher = [pick(11, 'b', 'Alperen Sengun', 'C', 'p3'), pick(25, 'b', 'Ja Morant', 'PG', 'p5')]
    expect(classifyManagerTendency(reacher, 'b', lookup).kind).toBe('reacher')

    const hunter = [pick(26, 'c', 'Jalen Brunson', 'PG', 'p2'), pick(36, 'c', 'Jamal Murray', 'PG', 'p6')]
    expect(classifyManagerTendency(hunter, 'c', lookup).kind).toBe('value_hunter')

    const loyal = [pick(1, 'a', 'Nikola Jokic', 'C', 'p1'), pick(31, 'a', 'Ja Morant', 'PG', 'p5')]
    expect(classifyManagerTendency(loyal, 'a', lookup).kind).toBe('adp_loyal')
  })
})

describe('formatAdpDelta', () => {
  it('signs values with a typographic minus', () => {
    expect(formatAdpDelta(4.54)).toBe('+4.5')
    expect(formatAdpDelta(-3)).toBe('−3.0')
    expect(formatAdpDelta(0)).toBe('0.0')
  })
})

describe('survivalTone / formatSurvival', () => {
  it('bands an estimate into likely / coin flip / unlikely', () => {
    expect(survivalTone(0.6)).toBe('likely')
    expect(survivalTone(0.59)).toBe('coin_flip')
    expect(survivalTone(0.3)).toBe('coin_flip')
    expect(survivalTone(0.29)).toBe('unlikely')
  })

  it('never prints an estimate as a certainty', () => {
    expect(formatSurvival(0.634)).toBe('63%')
    expect(formatSurvival(0.9999)).toBe('99%')
    expect(formatSurvival(0.0001)).toBe('1%')
  })
})
