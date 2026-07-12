import type { FantasyCalcSettings } from '@/lib/player-valuations/canonicalPlayerValuations'
import type { LoadedTradeLeague } from '@/lib/trade-value-console/league-loader'

export function fantasyCalcSettingsFromLeague(league: LoadedTradeLeague | null): FantasyCalcSettings {
  if (!league) {
    return { isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1 }
  }
  const settings = league.settings ?? {}
  const superflex = Boolean((settings as { superflex?: boolean }).superflex)
  const scoring = (league.scoring ?? '').toLowerCase()
  let ppr: 0 | 0.5 | 1 = 1
  if (scoring.includes('half')) ppr = 0.5
  else if (scoring.includes('standard') || scoring.includes('non-ppr') || scoring === 'std') ppr = 0
  const n = league.leagueSize ?? 12
  return {
    isDynasty: league.isDynasty,
    numQbs: superflex ? 2 : 1,
    numTeams: Math.min(32, Math.max(4, n)),
    ppr,
  }
}
