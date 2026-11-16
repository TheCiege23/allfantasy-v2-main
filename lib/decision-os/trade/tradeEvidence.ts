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
      issues.add(`${line.name}: no value found.`)
      continue
    }
    priced++
    const source = line.valueSource
    if (!source) issues.add(`${line.name}: we don’t know where this value came from.`)
    if (source && APPROXIMATE.has(source)) issues.add(`${line.name}: this value is an estimate (${source.replaceAll('_', ' ')}).`)
    const date = line.valueAsOf ? Date.parse(line.valueAsOf) : NaN
    if (Number.isFinite(date) && Number.isFinite(now) && date <= now + DAY) {
      dates.push(date)
      if (now - date > TRADE_VALUE_STALE_DAYS * DAY) issues.add(`${line.name}: this value is more than ${TRADE_VALUE_STALE_DAYS} days old.`)
    } else {
      issues.add(`${line.name}: this value has no date${line.valueScope ? ` (projection for ${line.valueScope})` : ''}.`)
    }
    if (source && !MARKET.has(source) && !APPROXIMATE.has(source)) {
      issues.add(`${line.name}: this value comes from ${source.replaceAll('_', ' ')}, not the trade market.`)
    }
  }
  if (!lines.length) issues.add('No player values were saved for this grade.')
  if (!Number.isFinite(now)) issues.add('We don’t know when this was graded, so we can’t check how fresh the values are.')
  const status = priced !== lines.length || !lines.length || !dates.length ? 'limited' : issues.size ? 'mixed' : 'dated'
  return {
    status,
    label: status === 'dated' ? 'Values are up to date' : status === 'mixed' ? 'Some values need a check' : 'Some values are missing',
    priced, total: lines.length, dated: dates.length,
    oldest: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
    newest: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
    issues: [...issues],
  }
}

export type TradePackageReview = { givePlayers: number; getPlayers: number; netPlayerSlots: number; note: string }

/** Picks and FAAB do not occupy player roster slots. Never infer an asset's kind from its name. */
export function tradePackageReview(
  lines: readonly TradeGradeLine[],
  opts: { rosterSpotCharged?: boolean } = {},
): TradePackageReview | null {
  if (lines.length < 3 || lines.some(line => !line.assetKind)) return null
  const givePlayers = lines.filter(line => line.side === 'give' && line.assetKind === 'player').length
  const getPlayers = lines.filter(line => line.side === 'get' && line.assetKind === 'player').length
  const netPlayerSlots = getPlayers - givePlayers
  if (!netPlayerSlots) return null
  return {
    givePlayers, getPlayers, netPlayerSlots,
    note: `You send ${givePlayers} player${givePlayers === 1 ? '' : 's'} and receive ${getPlayers}. ${netPlayerSlots > 0
      ? `You’ll need ${netPlayerSlots} more roster spot${netPlayerSlots === 1 ? '' : 's'}; if your roster is full, you’ll have to drop someone.`
      : `That opens ${-netPlayerSlots} roster spot${netPlayerSlots === -1 ? '' : 's'}; make sure you can replace any starters you send.`
    } ${opts.rosterSpotCharged
      // The grade carries the open-spot credit (`lib/trade-value/rosterSpotCharge.ts`).
      ? 'The grade already counts what that roster spot is worth. Check your lineup to see who you’d drop.'
      : 'The grade only adds up values, so check your lineup and any drops too.'}`,
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
