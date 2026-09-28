import { describe, expect, it } from 'vitest'
import type { League } from '@prisma/client'

import { buildTier0LeagueColumnPatch } from '@/lib/league-import/ImportedLeagueCommitService'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'

/*
 * Guap's decision, 2026-09-27: an import carries the provider's best-ball flag onto
 * `League.bestBallMode`. The one consumer that read that column as "no trades" is scoped to
 * native leagues, because Sleeper best-ball leagues trade.
 */
const normalized = (league: Record<string, unknown>) => ({ league }) as unknown as Parameters<typeof buildTier0LeagueColumnPatch>[0]

describe('buildTier0LeagueColumnPatch bestBallMode', () => {
  it("writes the provider's flag both ways — as the Sleeper mapper's 1/0 (#1371) and as a boolean", () => {
    expect(buildTier0LeagueColumnPatch(normalized({ best_ball: 1 }))).toMatchObject({ bestBallMode: true })
    expect(buildTier0LeagueColumnPatch(normalized({ best_ball: 0 }))).toMatchObject({ bestBallMode: false })
    expect(buildTier0LeagueColumnPatch(normalized({ best_ball: true }))).toMatchObject({ bestBallMode: true })
  })
  it('writes nothing when the provider sent no flag, so the column keeps its value', () => {
    expect(buildTier0LeagueColumnPatch(normalized({}))).not.toHaveProperty('bestBallMode')
  })
})

describe('resolveLeagueTradeSettings and best ball', () => {
  const league = (over: Record<string, unknown>) => ({ settings: null, lockAllMoves: false, guillotineMode: false, bbTradesEnabled: false, ...over }) as unknown as League

  it('keeps an imported best-ball league tradeable — the platform decides', () => {
    expect(resolveLeagueTradeSettings(league({ platform: 'sleeper', bestBallMode: true })).tradesAllowed).toBe(true)
    expect(resolveLeagueTradeSettings(league({ platform: 'espn', bestBallMode: true })).tradesAllowed).toBe(true)
  })

  it('still closes trades in a native best-ball league, as before', () => {
    expect(resolveLeagueTradeSettings(league({ platform: 'manual', bestBallMode: true })).tradesAllowed).toBe(false)
    expect(resolveLeagueTradeSettings(league({ platform: null, bestBallMode: true })).tradesAllowed).toBe(false)
  })

  it('leaves a non-best-ball league alone', () => {
    expect(resolveLeagueTradeSettings(league({ platform: 'manual', bestBallMode: false })).tradesAllowed).toBe(true)
  })
})
