import { describe, expect, it } from 'vitest'

import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import { validateTradeAssets } from '@/lib/league-trade-engine/tradeValidationService'
import {
  buildEngineTestLeague,
  buildEngineTestRoster,
} from '@/lib/engine-testing/fixtures/enginePayloadBuilders'

/**
 * 🛑 FAAB TRADING WAS GOVERNED BY THE DRAFT-PICK SETTING, AND THAT SETTING DEFAULTS TO FALSE.
 *
 *   faabTradingAllowed = Boolean(ext.faabTradable ?? league.draftPickTrading !== false)
 *
 * `League.draftPickTrading` is `Boolean @default(false)` in the schema. So for every league that
 * never turned draft-pick trading on — the default — `faabTradingAllowed` resolved to FALSE and the
 * validator refused every FAAB asset with `FAAB_TRADE_BLOCKED`. Two unrelated settings, one switch.
 *
 * ⚠ NO EXISTING TEST COULD SEE THIS. `buildEngineTestLeague` sets `draftPickTrading: true`, so
 * every suite that touches trade settings runs in the one configuration where the bug is invisible.
 * These tests build a league at the SCHEMA default on purpose.
 */

/** A league at the schema default: `draftPickTrading` false, nothing configured in extensions. */
function defaultLeague() {
  return buildEngineTestLeague({ draftPickTrading: false })
}

function tradeOneFaabDollar(league: ReturnType<typeof buildEngineTestLeague>) {
  const proposer = buildEngineTestRoster('r1', league.id, 'u1', { players: ['p1'] }, 100)
  const receiver = buildEngineTestRoster('r2', league.id, 'u2', { players: ['p3'] }, 100)
  return validateTradeAssets({
    league,
    settings: resolveLeagueTradeSettings(league),
    proposer,
    receiver,
    assets: [
      {
        itemType: 'faab',
        itemReference: null,
        fromRosterId: 'r1',
        toRosterId: 'r2',
        faabAmount: 5,
        metadata: {},
      },
    ],
    currentWeek: 5,
  })
}

describe('FAAB trading does not inherit the draft-pick setting', () => {
  it('is allowed in a league at the schema default', () => {
    // The bug, stated as the contract it broke: a commissioner who never touched draft-pick
    // trading could not trade FAAB, and nothing told them why.
    expect(resolveLeagueTradeSettings(defaultLeague()).faabTradingAllowed).toBe(true)
    expect(tradeOneFaabDollar(defaultLeague()).ok).toBe(true)
  })

  it('is independent of draftPickTrading in both directions', () => {
    // ⚠ BOTH DIRECTIONS. Asserting only the false case would still pass if FAAB were hardwired
    // to `true`, and asserting only the true case is what the old fixture already did.
    for (const draftPickTrading of [true, false]) {
      const s = resolveLeagueTradeSettings(buildEngineTestLeague({ draftPickTrading }))
      expect(s.faabTradingAllowed).toBe(true)
      expect(s.draftPickTradingAllowed).toBe(draftPickTrading)
    }
  })

  it('still honours an explicit faabTradable: false', () => {
    // The escape hatch has to keep working, or this trades one broken default for another.
    const league = buildEngineTestLeague({
      draftPickTrading: true,
      settings: { conceptRules: { extensions: { faabTradable: false } } } as never,
    })
    expect(resolveLeagueTradeSettings(league).faabTradingAllowed).toBe(false)

    const v = tradeOneFaabDollar(league)
    expect(v.ok).toBe(false)
    if (v.ok) throw new Error('unreachable')
    expect(v.code).toBe('FAAB_TRADE_BLOCKED')
  })

  it('still honours an explicit faabTradable: true when picks are off', () => {
    const league = buildEngineTestLeague({
      draftPickTrading: false,
      settings: { conceptRules: { extensions: { faabTradable: true } } } as never,
    })
    expect(resolveLeagueTradeSettings(league).faabTradingAllowed).toBe(true)
  })

  it('leaves the draft-pick gate itself alone', () => {
    // Fixing FAAB must not accidentally open pick trading, which is correctly off by default.
    const league = defaultLeague()
    const proposer = buildEngineTestRoster('r1', league.id, 'u1', {
      players: ['p1'],
      draftPicks: [{ id: 'rookie-1', season: 2027, round: 1 }],
    })
    const receiver = buildEngineTestRoster('r2', league.id, 'u2', { players: ['p3'] })
    const v = validateTradeAssets({
      league,
      settings: resolveLeagueTradeSettings(league),
      proposer,
      receiver,
      assets: [
        {
          itemType: 'rookie_pick',
          itemReference: 'rookie-1',
          fromRosterId: 'r1',
          toRosterId: 'r2',
          metadata: {},
        },
      ],
      currentWeek: 5,
    })
    expect(v.ok).toBe(false)
    if (v.ok) throw new Error('unreachable')
    expect(v.code).toBe('PICK_TRADING_BLOCKED')
  })

  it('still refuses more FAAB than the sender holds', () => {
    // Allowing FAAB trading must not weaken the sufficiency check that bounds it.
    const league = defaultLeague()
    const proposer = buildEngineTestRoster('r1', league.id, 'u1', { players: ['p1'] }, 3)
    const receiver = buildEngineTestRoster('r2', league.id, 'u2', { players: ['p3'] }, 100)
    const v = validateTradeAssets({
      league,
      settings: resolveLeagueTradeSettings(league),
      proposer,
      receiver,
      assets: [
        {
          itemType: 'faab',
          itemReference: null,
          fromRosterId: 'r1',
          toRosterId: 'r2',
          faabAmount: 50,
          metadata: {},
        },
      ],
      currentWeek: 5,
    })
    expect(v.ok).toBe(false)
    if (v.ok) throw new Error('unreachable')
    expect(v.code).toBe('FAAB_INSUFFICIENT')
  })
})
