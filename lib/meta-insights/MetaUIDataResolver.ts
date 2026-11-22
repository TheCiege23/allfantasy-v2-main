/**
 * MetaUIDataResolver – resolves the full dashboard payload for Meta Insights UI.
 * Single entry for server-side dashboard preload or API that returns all panels' data.
 */

import { resolvePlayerTrendPanel } from './PlayerTrendPanelResolver'
import { resolveStrategyMetaPanel } from './StrategyMetaPanelResolver'
import { resolveWarRoomMetaWidget, type WarRoomMetaWidgetPayload } from './WarRoomMetaWidgetResolver'
import { resolveSportForMetaUI } from './SportMetaUIResolver'

interface MetaUIDataPayload {
  sport: string
  leagueFormat?: string
  timeframe?: string
  trending: {
    hottest: Awaited<ReturnType<typeof resolvePlayerTrendPanel>>['data']
    rising: Awaited<ReturnType<typeof resolvePlayerTrendPanel>>['data']
    fallers: Awaited<ReturnType<typeof resolvePlayerTrendPanel>>['data']
  }
  strategy: Awaited<ReturnType<typeof resolveStrategyMetaPanel>>['data']
  warRoom: WarRoomMetaWidgetPayload
}

export async function resolveMetaUIData(opts: {
  sport: string
  leagueFormat?: string
  timeframe?: string
}): Promise<MetaUIDataPayload> {
  const sport = resolveSportForMetaUI(opts.sport)
  const timeframe =
    opts.timeframe === '24h' || opts.timeframe === '30d' || opts.timeframe === '7d'
      ? opts.timeframe
      : '7d'
  const [hottest, rising, fallers, strategy, warRoom] = await Promise.all([
    resolvePlayerTrendPanel({ sport, list: 'hottest', timeframe, limit: 8 }),
    resolvePlayerTrendPanel({ sport, list: 'rising', timeframe, limit: 6 }),
    resolvePlayerTrendPanel({ sport, list: 'fallers', timeframe, limit: 6 }),
    resolveStrategyMetaPanel({ sport, leagueFormat: opts.leagueFormat, timeframe }),
    resolveWarRoomMetaWidget(sport, 5, timeframe),
  ])
  return {
    sport,
    leagueFormat: opts.leagueFormat,
    timeframe: opts.timeframe,
    trending: {
      hottest: hottest.data,
      rising: rising.data,
      fallers: fallers.data,
    },
    strategy: strategy.data,
    warRoom,
  }
}
