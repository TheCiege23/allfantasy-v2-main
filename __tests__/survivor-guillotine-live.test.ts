import { describe, expect, it } from 'vitest'
import type { League } from '@prisma/client'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import { parseSGActionCommand } from '@/lib/survivor-guillotine/powers'
import { getRosterPlayerIds, removePlayerFromRosterData } from '@/lib/waiver-wire/roster-utils'

describe('Survivor Guilly live safeguards', () => {
  it('defaults trades off and only enables them by saved commissioner choice', () => {
    const league = { leagueVariant: 'survivor_guillotine', settings: { survivorGuillotine: { tradesEnabled: false } },
      lockAllMoves: false, bestBallMode: false, guillotineMode: false } as unknown as League
    expect(resolveLeagueTradeSettings(league).tradesAllowed).toBe(false)
    expect(resolveLeagueTradeSettings({ ...league, settings: { survivorGuillotine: { tradesEnabled: true } } } as League).tradesAllowed).toBe(true)
  })

  it('requires an explicit token id and target for player actions', () => {
    expect(parseSGActionCommand('@chimmy use token secret_1 on player_2 drop player_3')).toEqual({
      powerId: 'secret_1', targetId: 'player_2', dropPlayerId: 'player_3',
    })
    expect(parseSGActionCommand('use token secret_1 on player_2')).toBeNull()
  })

  it('removes a chopped player from roster ownership and every lineup view', () => {
    const source = { players: ['player_1', 'player_2'], starters: ['player_1'],
      lineup_sections: { starters: ['player_1'], bench: ['player_2'], ir: [] } }
    const released = removePlayerFromRosterData(source, 'player_1') as typeof source
    expect(getRosterPlayerIds(released)).toEqual(['player_2'])
    expect(released.starters).toEqual([])
    expect(released.lineup_sections.starters).toEqual([])
    expect(source.players).toEqual(['player_1', 'player_2'])
  })
})
