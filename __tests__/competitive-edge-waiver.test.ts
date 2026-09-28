// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { buildWaiverEdge, WAIVER_FLOOR, type EdgeWaiverClaim } from '@/lib/competitive-edge/waiverEdge'

/*
 * Competitive Edge for waivers (lib/competitive-edge/waiverEdge.ts): who can outbid you and what each
 * other manager has actually won this season — counts and budgets, never a label, never a prediction.
 */

const claim = (team: string, position: string | null, bid: number | null, day = 1): EdgeWaiverClaim => ({
  teamExternalId: team,
  position,
  bid,
  atIso: `2026-09-${String(day).padStart(2, '0')}T12:00:00.000Z`,
})

const MANAGERS = [
  { teamExternalId: '1', name: 'You', faabRemaining: 40 },
  { teamExternalId: '2', name: 'Tasha', faabRemaining: 72 },
  { teamExternalId: '3', name: 'Mike', faabRemaining: 12 },
  { teamExternalId: '4', name: 'Dee', faabRemaining: 40 },
]

const CLAIMS = [
  claim('2', 'RB', 18, 1),
  claim('2', 'RB', 0, 2),
  claim('2', 'WR', 6, 3),
  claim('2', 'RB', 1, 4),
  claim('3', 'QB', 30, 2),
  claim('1', 'TE', 5, 3),
]

const build = (over: Partial<Parameters<typeof buildWaiverEdge>[0]> = {}) =>
  buildWaiverEdge({
    season: 2026,
    usesFaab: true,
    claims: CLAIMS,
    managers: MANAGERS,
    viewerTeamExternalId: '1',
    asOf: '2026-09-25T12:44:20.000Z',
    stale: false,
    ...over,
  })

const texts = (edge: ReturnType<typeof build>, team: string) =>
  edge.rivals.find((r) => r.manager.teamExternalId === team)!.facts.map((f) => f.text)

describe('FAAB league', () => {
  it('who can outbid you comes first, against your own budget', () => {
    const edge = build()
    expect(edge.leagueFacts[0]).toEqual({
      key: 'waiver.outbid_by',
      text: '1 of the 3 other managers has more FAAB left than your $40.',
      bearsOnDeal: true,
    })
    expect(edge.rivals.map((r) => r.manager.name)).toEqual(['Tasha', 'Dee', 'Mike'])
    expect(texts(edge, '2')[0]).toBe('Tasha has $72 of FAAB left — more than your $40.')
    expect(texts(edge, '3')[0]).toBe('Mike has $12 of FAAB left — less than your $40.')
    expect(texts(edge, '4')[0]).toBe('Dee has $40 of FAAB left — the same as yours.')
  })

  it('a manager past the floor gets their spend, biggest winning bid, $0 bids and most-claimed position', () => {
    expect(texts(build(), '2')).toEqual([
      'Tasha has $72 of FAAB left — more than your $40.',
      'Tasha has won 4 waiver claims this season, spending $25 in all.',
      'Their biggest winning bid was $18 (RB).',
      '1 of their 4 claims was a $0 bid.',
      '3 of their 4 claims were RBs.',
    ])
  })

  it(`🛑 below ${WAIVER_FLOOR} claims there is a count and nothing read into it`, () => {
    expect(texts(build(), '3')).toEqual([
      'Mike has $12 of FAAB left — less than your $40.',
      'Mike has won 1 waiver claim this season, spending $30 in all.',
    ])
    expect(texts(build(), '4')).toEqual([
      'Dee has $40 of FAAB left — the same as yours.',
      "Dee hasn't won a waiver claim this season.",
    ])
    expect(build().rivals.find((r) => r.manager.teamExternalId === '3')!.sufficient).toBe(false)
  })

  it('you are not your own rival, and your claims still count toward the league total', () => {
    const edge = build()
    expect(edge.rivals.some((r) => r.manager.teamExternalId === '1')).toBe(false)
    expect(edge.viewer).toEqual({ teamExternalId: '1', faabRemaining: 40 })
    expect(edge.leagueFacts.at(-1)!.text).toBe('This league has made 6 winning waiver claims this season.')
  })

  it('an unknown budget states nothing about it — never "$0"', () => {
    const edge = build({ managers: MANAGERS.map((m) => (m.teamExternalId === '3' ? { ...m, faabRemaining: null } : m)) })
    expect(texts(edge, '3').some((t) => /FAAB left/.test(t))).toBe(false)
    expect(edge.leagueFacts[0]!.text).toBe('1 of the 2 other managers has more FAAB left than your $40.')
  })
})

describe('🛑 not a FAAB league', () => {
  it('no budget, no spend, no bid lines — a rolling-priority league still carries a default budget nobody can spend', () => {
    const edge = build({ usesFaab: false })
    expect(edge.leagueFacts.map((f) => f.key)).toEqual(['waiver.league_claims'])
    const all = edge.rivals.flatMap((r) => r.facts.map((f) => f.text)).join(' ')
    expect(all).not.toMatch(/\$|FAAB|bid/)
    expect(texts(edge, '2')).toEqual(['Tasha has won 4 waiver claims this season.', '3 of their 4 claims were RBs.'])
    // Most claims first when there is no budget to rank by.
    expect(edge.rivals.map((r) => r.manager.name)).toEqual(['Tasha', 'Mike', 'Dee'])
  })
})

describe('without a viewer team', () => {
  it('nothing is compared to "your" budget', () => {
    const edge = build({ viewerTeamExternalId: null })
    expect(edge.leagueFacts.map((f) => f.key)).toEqual(['waiver.league_claims'])
    expect(edge.rivals).toHaveLength(4)
    expect(texts(edge, '2')[0]).toBe('Tasha has $72 of FAAB left.')
  })
})

describe('🛑 the contract', () => {
  it('facts, never labels or predictions', () => {
    const all = [build(), build({ usesFaab: false })].flatMap((e) => [
      ...e.leagueFacts.map((f) => f.text),
      ...e.rivals.flatMap((r) => r.facts.map((f) => f.text)),
    ])
    for (const t of all) {
      expect(t).not.toMatch(/aggressive|hoard|shark|gambl|likes|loves|tends to|will bid|likely|probably|always|never bids/i)
    }
  })

  it('an empty season says so', () => {
    expect(build({ claims: [] }).leagueFacts.at(-1)!.text).toBe(
      'No winning waiver claims are on file for this league this season yet.',
    )
  })
})
