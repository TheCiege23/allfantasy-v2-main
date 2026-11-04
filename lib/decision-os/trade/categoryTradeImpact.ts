import { computeCategoryValue, readCategoryStat } from '@/lib/category-scoring/CategoryMatchupResolver'
import type { CategoryDefinition } from '@/lib/category-scoring/types'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { meetsSampleBar, resolveBoardPlayer, type SportPointsContext } from './sportPointsValue'

export type CategoryTradeImpact = {
  season: number
  rows: Array<{ label: string; direction: 'higher' | 'lower'; give: number | null; get: number | null;
    giveAttempts?: number; getAttempts?: number }>
}

export function buildCategoryTradeImpact(
  ctx: SportPointsContext, give: readonly TradeAssetInput[], get: readonly TradeAssetInput[],
): CategoryTradeImpact | undefined {
  const categories = ctx.categoryDefinitions
  if (!categories?.length || !give.length || !get.length) return
  const resolve = (side: readonly TradeAssetInput[]) => side.map((asset) => {
    if (asset.kind !== 'player') return null
    const result = resolveBoardPlayer(asset, ctx.board)
    return result.ok && meetsSampleBar(result.player) && result.player.categoryStats ? result.player : null
  })
  const outgoing = resolve(give)
  const incoming = resolve(get)
  const players = [...outgoing, ...incoming]
  const season = players[0]?.sourceSeason
  if (!season || players.some((player) => player?.sourceSeason !== season) ||
      new Set(players.map((player) => player?.id)).size !== players.length) return

  function packageValue(category: CategoryDefinition, side: typeof outgoing) {
    const computation = category.computation
    const keys = computation.kind === 'sum' ? [computation.statKey] :
      [computation.numeratorStatKey, computation.denominatorStatKey, ...(computation.additionalNumeratorStatKeys ?? [])]
    const totals: Record<string, number> = {}
    for (const key of keys) {
      const values = side.map((player) => readCategoryStat(player!.categoryStats!, key))
      if (values.some((value) => value == null)) return { value: null }
      totals[key] = values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    }
    return { value: computeCategoryValue(totals, category),
      ...(computation.kind === 'ratio' ? { attempts: totals[computation.denominatorStatKey] } : {}) }
  }
  const rows = categories.map((category) => {
    const a = packageValue(category, outgoing)
    const b = packageValue(category, incoming)
    return { label: category.label, direction: category.direction, give: a.value, get: b.value,
      giveAttempts: a.attempts, getAttempts: b.attempts }
  })
  if (rows.every((row) => row.give == null || row.get == null)) return
  return { season, rows }
}

export function renderCategoryTradeImpact(impact: CategoryTradeImpact): string {
  const format = (value: number | null, attempts: number | undefined, label: string) =>
    (value == null ? (attempts === 0 ? 'unqualified' : 'unavailable') : label.endsWith('%') ? (value * 100).toFixed(1) + '%' : value.toFixed(2)) +
    (attempts == null ? '' : ' on ' + attempts.toFixed(2) + (label.endsWith('%') ? ' attempts' : ' denominator units'))
  return [
    'Trade category impact from the ' + impact.season + ' per-game baseline. Your outgoing → incoming package. The other team gets the reverse.',
    ...impact.rows.map((row) => '- ' + row.label + ' (' + row.direction + ' is better): ' +
      format(row.give, row.giveAttempts, row.label) + ' → ' + format(row.get, row.getAttempts, row.label)),
    'These are player-package contributions, not projected team totals or a matchup winner. Attempts determine how much a percentage can move a team total.',
  ].join('\n')
}
