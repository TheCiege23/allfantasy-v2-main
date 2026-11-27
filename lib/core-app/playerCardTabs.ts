import type { PlayerCardData } from '@/lib/core-app/playerCard'
import type { PlayerCardMore } from '@/lib/core-app/playerCardMore'
import type { CardTabId } from '@/lib/core-app/playerCardLayoutCopy'

/**
 * The player card's tabs, in order, keeping only those with something to show.
 *
 * ⚠ A TAB IS HIDDEN, NEVER EMPTY. A sport with no depth chart, a player with no game rows yet, a
 * league with no trades — each loses its tab rather than printing why there is nothing in it.
 * `news` is the phone-only tab: on a wide screen the same content sits in the side column.
 */
export function playerCardTabs(data: PlayerCardData | null, more: PlayerCardMore | null): CardTabId[] {
  if (!data) return []
  const league = data.league
  const tabs: CardTabId[] = []
  const hasOutlook = Boolean(
    data.afLeagueProjection ||
      data.insight ||
      league?.boardValue?.available ||
      (league && league.price.available) ||
      data.market.available ||
      data.ownership.available,
  )
  if (hasOutlook) tabs.push('outlook')
  if (more?.gameLog.length) tabs.push('gamelog')
  if (more?.career.length) tabs.push('career')
  if (more?.depthChart) tabs.push('depth')
  if (data.schedule.available || league?.playoffSchedule.available) tabs.push('schedule')
  const depthLocked = data.depth?.unlocked === false
  const hasHistory = league
    ? league.trades.length > 0
    : data.trades.available || data.comps.available
  if (hasHistory || depthLocked) tabs.push('history')
  if (data.news.available) tabs.push('news')
  return tabs
}

/**
 * The rank chips under the bio: "#32 PG", "#95 overall", "88% rostered", "61% started". Each figure
 * once — AllFantasy's league ranks when the league has them, the market's otherwise.
 */
export type RankChip = { value: string; label: string }

export function playerCardRankChips(
  data: PlayerCardData | null,
  labels: { overall: string; rostered: string; started: string },
): RankChip[] {
  if (!data) return []
  const position = (data.player.position ?? '').toUpperCase()
  const chips: RankChip[] = []
  const af = data.afLeagueProjection
  const market = data.market.available ? data.market.data : null
  const posRank = af?.positionRank ?? market?.positionRank ?? null
  const overall = af?.rank ?? market?.overallRank ?? null
  if (posRank != null && position) chips.push({ value: `#${posRank}`, label: position })
  if (overall != null) chips.push({ value: `#${overall}`, label: labels.overall })
  if (data.ownership.available) {
    chips.push({ value: `${Math.round(data.ownership.data.ownPct * 100)}%`, label: labels.rostered })
    if (data.ownership.data.startPct != null) {
      chips.push({ value: `${Math.round(data.ownership.data.startPct * 100)}%`, label: labels.started })
    }
  }
  return chips
}
