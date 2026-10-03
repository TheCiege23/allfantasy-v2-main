import type { TradeGradeLine } from './tradeGrade'

const DAY = 86_400_000
/** Operational freshness rule, not a measured probability that the verdict is right. */
export const TRADE_VALUE_STALE_DAYS = 7
const MARKET = new Set(['fantasycalc', 'fantasycalc_pick'])
const APPROXIMATE = new Set(['position_baseline', 'pick_curve', 'draft_analytics', 'historical_file', 'devy_option', 'league_kicker', 'league_defense'])

export type TradeEvidence = {
  status: 'dated' | 'mixed' | 'limited'
  label: string
  priced: number
  total: number
  dated: number
  oldest: string | null
  newest: string | null
  issues: string[]
}

/** Evidence coverage and freshness only. No accuracy percentage or probability is inferred. */
export function tradeEvidence(lines: readonly TradeGradeLine[], at: string, gaps: readonly string[] = []): TradeEvidence {
  const now = Date.parse(at)
  const dates: number[] = []
  let priced = 0
  const issues = new Set(gaps.filter(Boolean))
  for (const line of lines) {
    if (line.leagueValue == null || !Number.isFinite(line.leagueValue) || line.leagueValue < 0) {
      issues.add(`${line.name}: value unavailable or invalid.`)
      continue
    }
    priced++
    const source = line.valueSource
    if (!source) issues.add(`${line.name}: the price source was not recorded.`)
    if (source && APPROXIMATE.has(source)) issues.add(`${line.name}: priced by an estimate or formula (${source.replaceAll('_', ' ')}).`)
    const date = line.valueAsOf ? Date.parse(line.valueAsOf) : NaN
    if (Number.isFinite(date) && Number.isFinite(now) && date <= now + DAY) {
      dates.push(date)
      if (now - date > TRADE_VALUE_STALE_DAYS * DAY) issues.add(`${line.name}: source is more than ${TRADE_VALUE_STALE_DAYS} days old.`)
    } else {
      issues.add(`${line.name}: source date unavailable or invalid${line.valueScope ? ` (projection scope: ${line.valueScope})` : ''}.`)
    }
    if (source && !MARKET.has(source) && !APPROXIMATE.has(source)) {
      issues.add(`${line.name}: value uses ${source.replaceAll('_', ' ')}; a market quote is not independently verified.`)
    }
  }
  if (!lines.length) issues.add('Asset evidence was not recorded for this evaluation.')
  if (!Number.isFinite(now)) issues.add('Evaluation time was not recorded; freshness cannot be checked.')
  const status = priced !== lines.length || !lines.length || !dates.length ? 'limited' : issues.size ? 'mixed' : 'dated'
  return {
    status,
    label: status === 'dated' ? 'Dated market evidence' : status === 'mixed' ? 'Mixed evidence' : 'Limited evidence',
    priced, total: lines.length, dated: dates.length,
    oldest: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
    newest: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
    issues: [...issues],
  }
}

export type TradePackageReview = { givePlayers: number; getPlayers: number; netPlayerSlots: number; note: string }

/** Picks and FAAB do not occupy player roster slots. Never infer an asset's kind from its name. */
export function tradePackageReview(lines: readonly TradeGradeLine[]): TradePackageReview | null {
  if (lines.length < 3 || lines.some(line => !line.assetKind)) return null
  const givePlayers = lines.filter(line => line.side === 'give' && line.assetKind === 'player').length
  const getPlayers = lines.filter(line => line.side === 'get' && line.assetKind === 'player').length
  const netPlayerSlots = getPlayers - givePlayers
  if (!netPlayerSlots) return null
  return {
    givePlayers, getPlayers, netPlayerSlots,
    note: `You send ${givePlayers} player${givePlayers === 1 ? '' : 's'} and receive ${getPlayers}. ${netPlayerSlots > 0
      ? `That adds ${netPlayerSlots} player roster slot${netPlayerSlots === 1 ? '' : 's'}; a full roster may require drops.`
      : `That frees ${-netPlayerSlots} player roster slot${netPlayerSlots === -1 ? '' : 's'}; check that outgoing starters are replaced.`
    } The value grade sums quoted asset prices. Usable starter value and the cost of any drops require a roster review.`,
  }
}

/** Deliberate stress scenario, not a confidence interval or an observed disagreement between sources. */
export function tradeValueSensitivity(give: number, get: number, swingPct = 10): { low: number; high: number } | null {
  if (![give, get, swingPct].every(Number.isFinite) || give <= 0 || get <= 0 || swingPct < 0 || swingPct >= 100) return null
  const swing = swingPct / 100
  const gap = (a: number, b: number) => {
    const raw = (b - a) / Math.max(a, b, 1) * 100
    return raw < 0 ? -Math.round(-raw) : Math.round(raw)
  }
  return { low: gap(give * (1 + swing), get * (1 - swing)), high: gap(give * (1 - swing), get * (1 + swing)) }
}

