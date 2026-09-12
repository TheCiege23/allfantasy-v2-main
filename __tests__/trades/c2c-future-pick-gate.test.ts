import { describe, expect, it } from 'vitest'

import { validateTradeAssets } from '@/lib/league-trade-engine/tradeValidationService'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import {
  buildEngineTestLeague,
  buildEngineTestRoster,
} from '@/lib/engine-testing/fixtures/enginePayloadBuilders'

/**
 * 🛑 THE C2C GATE WAS AN EMPTY BLOCK.
 *
 *   if (t === 'future_pick' && !settings.c2cTradingAllowed) {
 *     // c2c flag also used for cross-layer picks
 *   }
 *
 * The condition ran and nothing happened, so a league with C2C trading switched off still accepted
 * `future_pick` assets. Its two siblings — draft picks and devy — both refuse. Nothing type-checks
 * an empty block, and no test covered the branch, so it read as a guard for as long as it existed.
 *
 * These tests exist because the fix is one `return`: without them the branch is exactly as easy to
 * empty out again as it was to leave empty.
 */

const PICK_ID = 'pick-2027-r1'

function leagueWithC2C(c2cTrading: boolean | undefined, leagueType = 'redraft') {
  return buildEngineTestLeague({
    leagueType,
    settings: {
      conceptRules: { extensions: c2cTrading === undefined ? {} : { c2cTrading } },
    } as never,
  })
}

/** A roster holding one future pick the validator can actually find. */
function rosterWithPick(id: string, leagueId: string, userId: string) {
  return buildEngineTestRoster(id, leagueId, userId, {
    players: ['p1'],
    futurePicks: [{ id: PICK_ID, season: 2027, round: 1 }],
  })
}

function validateFuturePick(league: ReturnType<typeof buildEngineTestLeague>) {
  const proposer = rosterWithPick('r1', league.id, 'u1')
  const receiver = buildEngineTestRoster('r2', league.id, 'u2', { players: ['p3'] })
  return validateTradeAssets({
    league,
    settings: resolveLeagueTradeSettings(league),
    proposer,
    receiver,
    assets: [
      {
        itemType: 'future_pick',
        itemReference: PICK_ID,
        fromRosterId: 'r1',
        toRosterId: 'r2',
        metadata: {},
      },
    ],
    currentWeek: 5,
  })
}

describe('C2C cross-layer pick gate', () => {
  it('refuses a future pick when C2C trading is off', () => {
    // The whole point: before the fix this returned ok:true and the trade went through.
    const v = validateFuturePick(leagueWithC2C(false))
    expect(v.ok).toBe(false)
    if (v.ok) throw new Error('unreachable')
    expect(v.code).toBe('C2C_TRADE_BLOCKED')
  })

  it('allows a future pick when C2C trading is on', () => {
    // ⚠ The refusal must not swallow the ordinary case. A guard that blocks everything is as
    // wrong as one that blocks nothing, and only this test can tell the two apart.
    expect(validateFuturePick(leagueWithC2C(true)).ok).toBe(true)
  })

  it('allows a future pick when the league says nothing about C2C', () => {
    // `ext.c2cTrading ?? true` — unset means allowed. Filling in the empty block must not turn
    // silence into a refusal for every league that never configured this.
    expect(validateFuturePick(leagueWithC2C(undefined)).ok).toBe(true)
  })

  it('⚠ a C2C-TYPE league cannot switch it off, and that is the resolver, not this gate', () => {
    // `c2cTradingAllowed = leagueType.includes('c2c') || Boolean(ext.c2cTrading ?? true)`.
    // The first clause wins, so `c2cTrading: false` is INERT inside a C2C league. Pinned here
    // because it decides this refusal's blast radius: it can only ever fire in a NON-C2C league.
    // Reported rather than rewritten — `devyTradingAllowed` has the identical shape, so "a C2C
    // league always permits cross-layer picks" is a consistent product reading, and changing it
    // would start blocking assets in the leagues built around them.
    const league = leagueWithC2C(false, 'c2c_dynasty')
    expect(resolveLeagueTradeSettings(league).c2cTradingAllowed).toBe(true)
    expect(validateFuturePick(league).ok).toBe(true)
  })

  it('leaves the neighbouring pick types to their own gates', () => {
    // A rookie pick is governed by `draftPickTradingAllowed`, not by the C2C flag. If the new
    // refusal were written one line higher, or without the `t === 'future_pick'` test, this is
    // what would catch it.
    const league = leagueWithC2C(false)
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
    expect(v.ok).toBe(true)
  })
})
