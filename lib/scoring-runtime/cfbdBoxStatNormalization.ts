/**
 * CFBD's stored player-game boxes use grouped source keys (`passing.YDS`), while
 * NCAAF league scoring uses canonical keys (`pass_yds`). Translate only measured
 * athlete box fields. Team defense and fields the source does not prove stay absent.
 */
const BOX_TO_SCORING: Readonly<Record<string, string>> = {
  'passing.YDS': 'pass_yds',
  'passing.TD': 'pass_td',
  'passing.INT': 'pass_int',
  'rushing.YDS': 'rush_yds',
  'rushing.TD': 'rush_td',
  'receiving.REC': 'rec',
  'receiving.YDS': 'rec_yds',
  'receiving.TD': 'rec_td',
  'defensive.SOLO': 'idp_solo',
  'defensive.TOT': 'idp_tackle',
  'defensive.SACKS': 'idp_sack',
  'defensive.PD': 'idp_pd',
  'defensive.TFL': 'idp_tfl',
  'defensive.TD': 'idp_td',
  'interceptions.INT': 'idp_int',
  'interceptions.YDS': 'idp_int_return_yards',
  'kickReturns.TD': 'kr_td',
  'puntReturns.TD': 'pr_td',
  'conversions.PASS': 'pass_2pt',
  'conversions.RUSH': 'rush_2pt',
  'conversions.REC': 'rec_2pt',
  'kicking.FGM': 'fg_made',
  'kicking.XPM': 'xp_made',
  'fumbles.LOST': 'fum_lost',
}

function numeric(source: Record<string, unknown>, key: string): number | null {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function normalizeCfbdBoxStats(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const out: Record<string, number> = {}
  for (const [from, to] of Object.entries(BOX_TO_SCORING)) {
    const value = numeric(source, from)
    if (value != null) out[to] = value
  }
  const fieldGoals = numeric(source, 'kicking.FGA')
  const madeFieldGoals = numeric(source, 'kicking.FGM')
  if (fieldGoals != null && madeFieldGoals != null) out.fg_miss = Math.max(0, fieldGoals - madeFieldGoals)
  const extraPoints = numeric(source, 'kicking.XPA')
  const madeExtraPoints = numeric(source, 'kicking.XPM')
  if (extraPoints != null && madeExtraPoints != null) out.xp_miss = Math.max(0, extraPoints - madeExtraPoints)
  const roleConversions = ['pass_2pt', 'rush_2pt', 'rec_2pt']
  if (roleConversions.some((key) => key in out)) out.two_pt = roleConversions.reduce((sum, key) => sum + (out[key] ?? 0), 0)
  return Object.keys(out).length ? out : null
}
