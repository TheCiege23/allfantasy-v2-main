// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

import PlayerCardSheet from '@/components/core-app/player-card/PlayerCardSheet'
import type { PlayerCardData } from '@/lib/core-app/playerCard'
import { describeKeeperCardCost } from '@/lib/keeper/keeperCardCostLine'

const no = (reason: string) => ({ available: false as const, reason })
function cardData(over: Partial<PlayerCardData> = {}): PlayerCardData {
  return {
    context: 'universal',
    player: { externalId: '9509', sleeperId: '9509', sport: 'NFL', name: 'Bijan Robinson', position: 'RB', team: 'ATL', number: 7, imageUrl: null },
    bio: { age: 25, height: null, weight: null, yearsExp: 3, college: null },
    market: no('No price.'), ownership: no('No ownership.'), schedule: no('No schedule.'), byeWeek: null,
    trades: no('No trades.'), comps: no('No comps.'), news: no('No news.'), injury: no('No injury.'), injuryFeed: no('No feed.'),
    insight: null, league: null, follow: { following: false }, depth: null,
    ...over,
  } as unknown as PlayerCardData
}
const sheet = (data: PlayerCardData) =>
  render(<PlayerCardSheet subject={{ sport: 'NFL', sleeperId: '9509', name: 'Bijan Robinson', position: 'RB' }} data={data} status="ready" onClose={() => {}} onOpen={() => {}} />)

describe('player card keeper line', () => {
  it('shows the cost, the rule and the value in a keeper league', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ points: [] }) })))
    const keeperCost = describeKeeperCardCost({
      rules: { costSystem: 'round_based', roundsEarlier: 1, inflationPerYear: 1, waiverCostRound: null, minCostRound: null, sameRoundRule: 'player_chooses' },
      cost: { ok: true, costRound: 5 }, basis: 'drafted', lastRound: 6, valuation: { marketRank: 14, teams: 12 },
    })
    const { getByTestId } = sheet(cardData({ keeperCost }))
    const line = getByTestId('player-card-keeper-cost').textContent
    expect(line).toContain('Keeper cost: Round 5')
    expect(line).toContain('Drafted Round 6 last season · league rule: 1 round earlier')
    expect(getByTestId('player-card-keeper-value').textContent).toBe('Market rank #14; a Round 5 keeper uses about the #54 pick — 40 picks of value.')
  })

  it('is absent everywhere else (non-keeper league, or the commissioner lacks the plan)', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ points: [] }) })))
    const { queryByTestId } = sheet(cardData())
    expect(queryByTestId('player-card-keeper-cost')).toBeNull()
  })
})
