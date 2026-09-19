import { describe, expect, it } from 'vitest'
import { generateMultiTeamTradeSuggestions, generateTradePartnerSuggestions, type SuggestionRoster } from '@/lib/league-trade-engine/proposalSuggestions'

const roster = (over: Partial<SuggestionRoster> & Pick<SuggestionRoster, 'rosterId'>): SuggestionRoster => ({
  rosterId: over.rosterId,
  ownerName: over.ownerName ?? over.rosterId,
  wins: over.wins ?? 0,
  losses: over.losses ?? 0,
  faabRemaining: over.faabRemaining ?? 100,
  picks: over.picks ?? [],
  players: over.players ?? [],
})

describe('league trade proposal suggestions', () => {
  it('ranks a complementary roster and builds a real player/pick/FAAB package', () => {
    const mine = roster({
      rosterId: 'mine',
      players: [
        { id: 'wr1', name: 'My WR', position: 'WR', value: 3100 },
        { id: 'wr2', name: 'Depth WR', position: 'WR', value: 1300 },
      ],
      picks: [{ pickId: 'pick1', label: '2027 round 2', itemType: 'future_pick', value: 900 }],
      faabRemaining: 80,
    })
    const fit = roster({
      rosterId: 'fit', ownerName: 'RB Rich',
      players: [
        { id: 'rb1', name: 'Target RB', position: 'RB', value: 5200 },
        { id: 'rb2', name: 'Other RB', position: 'RB', value: 2500 },
        { id: 'rb3', name: 'Depth RB', position: 'RB', value: 900 },
      ],
    })
    const out = generateTradePartnerSuggestions({
      viewerRosterId: 'mine', rosters: [mine, fit], rosterPositions: ['RB', 'WR', 'FLEX', 'BN'], faabBudget: 100,
    })
    expect(out[0]?.rosterId).toBe('fit')
    const rb1 = out[0]?.packages.find((p) => p.receive.some((a) => a.id === 'rb1'))
    expect(rb1?.receive[0]).toMatchObject({ kind: 'player', id: 'rb1' })
    expect(rb1?.send.some((a) => a.kind === 'pick')).toBe(true)
    expect(out[0]?.packages[0]?.fairness).toBeGreaterThanOrEqual(72)
  })

  it('returns no invented suggestion when the viewer roster is unknown', () => {
    expect(generateTradePartnerSuggestions({ viewerRosterId: null, rosters: [], rosterPositions: [], faabBudget: 100 })).toEqual([])
  })

  it('uses survival strategy in guillotine leagues and does not spend future picks', () => {
    const mine = roster({
      rosterId: 'mine',
      players: [{ id: 'wr', name: 'Wideout', position: 'WR', value: 3000 }],
      picks: [{ pickId: 'future', label: '2028 first', itemType: 'future_pick', value: 2200 }],
    })
    const target = roster({
      rosterId: 'target',
      players: [{ id: 'rb', name: 'Weekly RB', position: 'RB', value: 3000 }],
    })
    const [suggestion] = generateTradePartnerSuggestions({
      viewerRosterId: 'mine', rosters: [mine, target], rosterPositions: ['RB', 'WR'], faabBudget: 100, leagueMode: 'guillotine',
    })
    expect(suggestion?.packages[0]?.send.every((asset) => asset.kind !== 'pick')).toBe(true)
    expect(suggestion?.reasons.join(' ')).toContain('weekly survival')
  })

  it('targets draft capital when the manager has confirmed a rebuild', () => {
    const mine = roster({
      rosterId: 'mine',
      players: [{ id: 'veteran', name: 'Veteran WR', position: 'WR', value: 2200 }],
    })
    const target = roster({
      rosterId: 'target',
      players: [{ id: 'rb', name: 'RB', position: 'RB', value: 1800 }],
      picks: [{ pickId: 'first', label: '2027 first', itemType: 'future_pick', value: 2200 }],
    })
    const [suggestion] = generateTradePartnerSuggestions({
      viewerRosterId: 'mine', rosters: [mine, target], rosterPositions: ['RB', 'WR'], faabBudget: 100,
      leagueMode: 'dynasty', managerStrategy: 'rebuild',
    })
    expect(suggestion?.packages.some((proposal) => proposal.receive.some((asset) => asset.id === 'first'))).toBe(true)
    expect(suggestion?.reasons.join(' ')).toContain('confirmed strategy is rebuild')
  })

  it('prefers sending roster surplus that addresses the partner need', () => {
    const mine = roster({
      rosterId: 'mine',
      players: [
        { id: 'only-rb', name: 'Only RB', position: 'RB', value: 2500 },
        { id: 'wr1', name: 'WR One', position: 'WR', value: 2500 },
        { id: 'wr2', name: 'WR Two', position: 'WR', value: 2400 },
        { id: 'wr3', name: 'WR Three', position: 'WR', value: 2300 },
      ],
    })
    const target = roster({
      rosterId: 'target',
      players: [
        { id: 'target-rb', name: 'Target RB', position: 'RB', value: 2500 },
        { id: 'target-rb2', name: 'Target RB Two', position: 'RB', value: 2300 },
        { id: 'target-rb3', name: 'Target RB Three', position: 'RB', value: 2200 },
      ],
    })
    const [suggestion] = generateTradePartnerSuggestions({
      viewerRosterId: 'mine', rosters: [mine, target], rosterPositions: ['RB', 'WR'], faabBudget: 100,
    })
    const packageForTarget = suggestion?.packages.find((proposal) => proposal.receive.some((asset) => asset.id === 'target-rb'))
    expect(packageForTarget?.send.some((asset) => asset.id.startsWith('wr'))).toBe(true)
    expect(packageForTarget?.send.some((asset) => asset.id === 'only-rb')).toBe(false)
  })

  it('recognizes a weak starting position even when the roster has enough bodies', () => {
    const mine = roster({
      rosterId: 'mine',
      players: [
        { id: 'low-rb1', name: 'Low RB One', position: 'RB', value: 400 },
        { id: 'low-rb2', name: 'Low RB Two', position: 'RB', value: 300 },
        { id: 'wr1', name: 'WR One', position: 'WR', value: 2600 },
        { id: 'wr2', name: 'WR Two', position: 'WR', value: 2500 },
        { id: 'wr3', name: 'WR Three', position: 'WR', value: 2400 },
      ],
    })
    const target = roster({
      rosterId: 'target',
      players: [
        { id: 'strong-rb1', name: 'Strong RB One', position: 'RB', value: 3000 },
        { id: 'strong-rb2', name: 'Strong RB Two', position: 'RB', value: 2800 },
        { id: 'strong-rb3', name: 'Strong RB Three', position: 'RB', value: 2600 },
        { id: 'low-wr', name: 'Low WR', position: 'WR', value: 500 },
      ],
    })
    const [suggestion] = generateTradePartnerSuggestions({
      viewerRosterId: 'mine', rosters: [mine, target], rosterPositions: ['RB', 'WR'], faabBudget: 100,
    })
    expect(suggestion?.reasons.join(' ')).toContain('surplus RB')
    expect(suggestion?.packages.some((proposal) => proposal.receive.some((asset) => asset.position === 'RB'))).toBe(true)
  })

  it('constructs a balanced circular three-team trade', () => {
    const player = (id: string, position: string) => ({ id, name: id, position, value: 2000 })
    const mine = roster({ rosterId: 'mine', players: [player('my-wr1', 'WR'), player('my-wr2', 'WR'), player('my-wr3', 'WR'), player('my-rb', 'RB')] })
    const b = roster({ rosterId: 'b', ownerName: 'Team B', players: [player('b-rb1', 'RB'), player('b-rb2', 'RB'), player('b-rb3', 'RB'), player('b-te', 'TE')] })
    const c = roster({ rosterId: 'c', ownerName: 'Team C', players: [player('c-te1', 'TE'), player('c-te2', 'TE'), player('c-te3', 'TE'), player('c-wr', 'WR')] })
    const [suggestion] = generateMultiTeamTradeSuggestions({ viewerRosterId: 'mine', rosters: [mine, b, c], rosterPositions: ['RB', 'WR', 'TE'] })
    expect(suggestion?.legs).toHaveLength(3)
    expect(suggestion?.legs.map((leg) => `${leg.fromRosterId}->${leg.toRosterId}`)).toEqual(['mine->b', 'b->c', 'c->mine'])
    expect(suggestion?.fairness).toBe(100)
  })
})
