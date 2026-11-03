import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { gradeTrade, type TradeGradeLine, type TradeGradeView } from './tradeGrade'
import { indexBoard, resolveBoardPlayer } from './sportPointsValue'
import { pointsOverReplacement, type GuillotineContext } from './guillotineValue'

/** Old generic market grades are not originals on the Zombie player basis. */
export function isZombieBasisGrade(grade: { lines?: ReadonlyArray<{ valueSource?: string | null }> | null } | null | undefined): boolean {
  const lines = grade?.lines ?? []
  return lines.length > 0 && lines.every((line) => line.valueSource === 'zombie_points')
}

/** Player-only Zombie grade. Infection, item holdings and trade eligibility need live team state. */
export function gradeZombiePlayerDeal(args: {
  give: readonly TradeAssetInput[]
  get: readonly TradeAssetInput[]
  ctx: GuillotineContext
}): TradeGradeView {
  const { ctx } = args
  const weeks = ctx.weeksLeft
  const basis = `Zombie · ${ctx.lineupLabel} · league scoring · ${weeks} projected week${weeks === 1 ? '' : 's'} left. Players are priced above the best available free agent for each eligible lineup slot because adds are free and immediate. Infection, weapons, serums, payout and counterparty eligibility are not priced.`
  if (!(weeks > 0)) return { graded: false, reason: 'No projected season weeks remain for a Zombie player comparison.', basis }

  const index = indexBoard(ctx.board)
  const price = (assets: readonly TradeAssetInput[], side: 'give' | 'get'): { lines: TradeGradeLine[]; total: number } | { withheld: string } => {
    const lines: TradeGradeLine[] = []
    let total = 0
    for (const asset of assets) {
      if (asset.kind === 'pick') return { withheld: 'This Zombie player comparison cannot price draft picks. The full deal is not graded.' }
      if (asset.kind === 'faab') return { withheld: 'This Zombie league uses free agency rather than a FAAB waiver auction. The full deal is not graded.' }
      const found = resolveBoardPlayer({ playerId: asset.playerId ?? null, name: asset.name ?? null }, ctx.board, index)
      if (!found.ok) return { withheld: `${found.reason} The full deal is not graded.` }
      const value = Math.round(pointsOverReplacement(found.player, ctx.seats, ctx.replacementBySlot) * weeks * 10) / 10
      total += value
      lines.push({ side, name: found.player.name, marketValue: value, leagueValue: value, source: 'zombie-player-vorp', valueSource: 'zombie_points', valueAsOf: null })
    }
    return { lines, total }
  }

  const give = price(args.give, 'give')
  if ('withheld' in give) return { graded: false, reason: give.withheld, basis }
  const get = price(args.get, 'get')
  if ('withheld' in get) return { graded: false, reason: get.withheld, basis }
  if (give.total <= 0 && get.total <= 0) {
    return { graded: false, reason: 'Both sides project at or below the best free agents for this Zombie lineup.', basis }
  }
  const grade = gradeTrade({
    giveValue: Math.max(give.total, 0.01), getValue: Math.max(get.total, 0.01),
    giveMarket: give.total, getMarket: get.total, unpriced: 0,
    giveCount: args.give.length, getCount: args.get.length,
    basis, scoringApplied: true, needApplied: false, needGap: null,
    lines: [...give.lines, ...get.lines], moves: [],
  })
  // A player-value edge is useful, but the missing Zombie state cannot authorize an acceptance.
  return grade.graded
    ? { ...grade, action: 'review', recommendation: 'Review this player-only edge alongside current infection status, item holdings, payout rules and trade eligibility before deciding.' }
    : grade
}
