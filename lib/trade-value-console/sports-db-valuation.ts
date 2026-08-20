import 'server-only'

import type { SportsPlayerRecord } from '@prisma/client'
import type { PricedAsset } from '@/lib/hybrid-valuation'

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function extractProjectionPoints(projections: unknown): number | null {
  if (!projections || typeof projections !== 'object' || Array.isArray(projections)) return null
  const o = projections as Record<string, unknown>
  const keys = ['fantasyPoints', 'projectedPoints', 'points', 'fp', 'total', 'ros']
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v)
  }
  return null
}

function injuryVolatility(status: string | null | undefined): number {
  if (!status) return 0.22
  const s = status.toLowerCase()
  if (s.includes('out') || s.includes('ir')) return 0.45
  if (s.includes('doubt')) return 0.4
  if (s.includes('quest')) return 0.32
  if (s.includes('prob')) return 0.26
  return 0.24
}

/**
 * HONESTY PASS: this used to fall back to a hardcoded `market = 1200` for any
 * player with neither a dynasty value nor a projection — then derive
 * "impactValue" and "vorpValue" from that constant. In sports where
 * `dynastyValue`/`projections` are sparse (everything outside NFL), that made
 * every player identical, every trade "even", and the fabrication was
 * indistinguishable from a real valuation downstream.
 *
 * Now it returns `null` when nothing real resolved. Callers must report the
 * gap (they already carry a `dataGaps` channel) rather than trade on a
 * constant.
 */
export function sportsRecordToPricedAsset(row: SportsPlayerRecord): PricedAsset | null {
  const dyn = row.dynastyValue
  const projPts = extractProjectionPoints(row.projections)
  let market = typeof dyn === 'number' && dyn > 0 ? Math.round(dyn * 75) : 0
  if (market <= 0 && projPts != null) {
    market = Math.round(clamp(projPts * 45, 200, 9000))
  }
  if (market <= 0) {
    return null
  }
  const vol = injuryVolatility(row.injuryStatus)
  const impact = Math.round(market * 0.62)
  const vorp = Math.round(market * 0.28)
  return {
    name: row.name,
    type: 'player',
    value: market,
    assetValue: {
      marketValue: market,
      impactValue: impact,
      vorpValue: vorp,
      volatility: vol,
    },
    position: row.position,
    source: 'unknown',
  }
}

export { clamp }
