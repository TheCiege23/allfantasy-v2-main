import { isIdpEligiblePosition } from '@/lib/af-projections/idpScoring'
import { normalizeCfbdGameStats } from '@/lib/scoring-runtime/ncaafStatNormalization'
import { computeLeagueProjectedPoints } from './leagueScoring'

// AF's scoring engine and imported rulebooks use different names for these individual stats.
const importedRule: Record<string, string> = {
  idp_solo: 'idp_tkl_solo', idp_tackle: 'idp_tkl', idp_tfl: 'idp_tkl_loss',
  idp_pd: 'idp_pass_def', idp_td: 'idp_def_td', idp_int_return_yards: 'idp_int_ret_yd',
}

export function scoreNcaafProjection(
  rates: Record<string, unknown> | null | undefined,
  rules: Record<string, unknown>,
  position: string | null | undefined,
) {
  if (!rates || !isIdpEligiblePosition(position)) return computeLeagueProjectedPoints(rates, rules)
  const components = { ...rates }
  for (const [key, amount] of Object.entries(normalizeCfbdGameStats(rates).stats)) {
    if (!key.startsWith('idp_')) continue
    const configured = key in rules ? key : importedRule[key]
    if (configured && configured in rules && components[configured] == null) components[configured] = amount
  }
  return computeLeagueProjectedPoints(components, rules)
}
