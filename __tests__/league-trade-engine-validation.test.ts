import { describe, expect, it } from 'vitest'
import { validateTradeAssets } from '@/lib/league-trade-engine/tradeValidationService'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import {
  buildEngineTestLeague,
  buildEngineTestRoster,
  buildPlayerSwapTradeAssets,
} from '@/lib/engine-testing/fixtures/enginePayloadBuilders'

describe('validateTradeAssets', () => {
  it('accepts valid player swap', () => {
    const lg = buildEngineTestLeague()
    const proposer = buildEngineTestRoster('r1', lg.id, 'u1', { players: ['p1', 'p2'] })
    const receiver = buildEngineTestRoster('r2', lg.id, 'u2', { players: ['p3'] })
    const settings = resolveLeagueTradeSettings(lg)
    const v = validateTradeAssets({
      league: lg,
      settings,
      proposer,
      receiver,
      assets: buildPlayerSwapTradeAssets({
        proposerRosterId: 'r1',
        receiverRosterId: 'r2',
        proposerSendsPlayerId: 'p1',
        receiverSendsPlayerId: 'p3',
      }),
      currentWeek: 5,
    })
    expect(v.ok).toBe(true)
  })

  it('rejects asset not on roster', () => {
    const lg = buildEngineTestLeague()
    const proposer = buildEngineTestRoster('r1', lg.id, 'u1', { players: ['p1'] })
    const receiver = buildEngineTestRoster('r2', lg.id, 'u2', { players: ['p3'] })
    const settings = resolveLeagueTradeSettings(lg)
    const v = validateTradeAssets({
      league: lg,
      settings,
      proposer,
      receiver,
      assets: [
        {
          itemType: 'player',
          itemReference: 'ghost',
          fromRosterId: 'r1',
          toRosterId: 'r2',
        },
      ],
      currentWeek: 5,
    })
    expect(v.ok).toBe(false)
  })

  it('validates a three-team asset graph against every sending roster', () => {
    const lg = buildEngineTestLeague()
    const proposer = buildEngineTestRoster('r1', lg.id, 'u1', { players: ['p1', 'p2'] })
    const receiver = buildEngineTestRoster('r2', lg.id, 'u2', { players: ['p3'] })
    const third = buildEngineTestRoster('r3', lg.id, 'u3', { players: ['p4'] })
    const v = validateTradeAssets({
      league: lg,
      settings: resolveLeagueTradeSettings(lg),
      proposer,
      receiver,
      participants: [proposer, receiver, third],
      assets: [
        { itemType: 'player', itemReference: 'p1', fromRosterId: 'r1', toRosterId: 'r2' },
        { itemType: 'player', itemReference: 'p3', fromRosterId: 'r2', toRosterId: 'r3' },
        { itemType: 'player', itemReference: 'p4', fromRosterId: 'r3', toRosterId: 'r1' },
      ],
      currentWeek: 5,
    })
    expect(v.ok).toBe(true)
  })

  it('rejects a three-team asset attributed to the wrong owner', () => {
    const lg = buildEngineTestLeague()
    const proposer = buildEngineTestRoster('r1', lg.id, 'u1', { players: ['p1'] })
    const receiver = buildEngineTestRoster('r2', lg.id, 'u2', { players: ['p2'] })
    const third = buildEngineTestRoster('r3', lg.id, 'u3', { players: ['p3'] })
    const v = validateTradeAssets({
      league: lg,
      settings: resolveLeagueTradeSettings(lg),
      proposer,
      receiver,
      participants: [proposer, receiver, third],
      assets: [{ itemType: 'player', itemReference: 'p3', fromRosterId: 'r2', toRosterId: 'r1' }],
      currentWeek: 5,
    })
    expect(v).toMatchObject({ ok: false, code: 'PLAYER_NOT_ON_ROSTER' })
  })
})
