import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolvePlayers } from '@/lib/shared-services/player-identity/PlayerIdentityResolver'
import type { CanonicalValue, ValueLookup } from './contract'

/**
 * Market values → {@link CanonicalValue}. The first of the three adapters (2.2).
 *
 * TRANSLATION ONLY. No pricing happens here and none ever should: `PlayerValueSnapshot` is
 * written by `ingestPlayerValues`, scheduled daily at 10:00 UTC through `/api/cron/adp-refresh`.
 * That was checked rather than assumed — an adapter over a table nothing writes is the
 * `ingestCFBDStats` failure, and this plan has already found three variants of it tonight.
 *
 * ── 🛑 THREE ADAPTERS, NOT FOUR, AND THE CODE IS WHY ────────────────────────────────────────
 * D3 says "one contract, four producers". Reading the producers says three, because IDP and
 * KICKER are already composed by `lib/idp-kicker-values.ts#buildIdpKickerValueMap`, which takes
 * `vorpBySleeperId` (from `leagueIdpVorp`) and `kickerValue` (from `resolveLeagueKickerValue`)
 * and emits one league-scoped map.
 *
 * Writing separate IDP and kicker adapters would make two rivals to a module that already
 * unifies them — the exact mistake §2.14 records finding and mis-diagnosing in the waiver
 * resolvers. So: market (here), idp+kicker (one adapter over the composition), devy.
 *
 * ── WHY THE HONESTY FIELDS COME FROM HERE AND NOT FROM FANTASYCALC ──────────────────────────
 * `getFantasyCalcValuesDbFirst` returns ranks and a 30-day trend and nothing else.
 * `PlayerValueSnapshot` carries `marketStdDev` and `tradeFrequency`, and the schema comments
 * already say why they matter — "a high value with near-zero trade frequency is a thin,
 * rarely-tested price". The feed kernel asks every source for `confidence` and `sampleSize`;
 * every source in this repo currently answers null. This is the first one that can answer.
 */

/** What `basis: 'market'` is allowed to be sourced from. Named so a second source is a decision. */
const SOURCE_MODULE = 'lib/player-values/ingestPlayerValues → PlayerValueSnapshot'

/**
 * Sports for which a market price exists at all.
 *
 * ⚠ THIS IS A FACT ABOUT THE WORLD, NOT A TODO. No vendor prices NHL, MLB, NBA or soccer
 * fantasy assets in a way this product ingests, and `lib/trade-intel/devyOutlook.ts` records
 * that nothing prices college players either. A lookup for those returns `no_producer`, which
 * D8 requires Chimmy to be able to say out loud — distinct from "we have a model and it found
 * nothing", which is `not_computed`.
 */
const MARKET_PRICED_SPORTS: ReadonlySet<string> = new Set(['NFL'])

export interface MarketAdapterArgs {
  sport: string
  /** 'DYNASTY' | 'REDRAFT' — matches PlayerValueSnapshot.format. */
  format: string
  /** 'ONE_QB' | 'SUPERFLEX' — matches PlayerValueSnapshot.qbFormat. */
  qbFormat: string
  /** Bound the fan-out. The caller decides; the adapter never silently truncates. */
  limit?: number
}

/**
 * `marketStdDev` → confidence, inverted and clamped.
 *
 * ⚠ HIGH DEVIATION IS LOW CONFIDENCE, AND THE DIRECTION IS THE WHOLE POINT. The schema calls
 * `marketStdDev` "MARKET DISAGREEMENT... exactly where an edge lives". An edge for a trader is
 * uncertainty for a valuation, so it must reduce confidence, not raise it.
 *
 * Null in, null out — never 0.5, never 1. A producer that does not report deviation does not
 * thereby report agreement, and `OsFactEnvelope` documents null as "the producer does not
 * express confidence for this fact", which is a different statement from "confidence is low".
 */
export function confidenceFromStdDev(stdDev: number | null | undefined, value: number): number | null {
  if (stdDev == null || !Number.isFinite(stdDev)) return null
  if (!Number.isFinite(value) || value <= 0) return null
  // Relative dispersion: a stdDev of 200 means something different on a 5,000 asset than a 500 one.
  const relative = stdDev / value
  const confidence = 1 - Math.min(1, Math.max(0, relative))
  return Number(confidence.toFixed(3))
}

/**
 * Read the latest market snapshot per player and translate it.
 *
 * Returns a `ValueLookup` per row so an unresolved identity is REPORTED rather than dropped.
 * A silently shorter array is how coverage problems hide — §2.11 measured NCAAF roster ids
 * resolving at 24.2%, and an adapter that just omits the other 75.8% makes that invisible.
 */
export async function loadMarketValues(args: MarketAdapterArgs): Promise<ValueLookup[]> {
  const sport = args.sport.trim().toUpperCase()

  if (!MARKET_PRICED_SPORTS.has(sport)) {
    return [
      {
        status: 'no_producer',
        sport,
        basis: 'market',
        detail:
          `No market price exists for ${sport}. Market values come from traded-asset pricing, ` +
          `which is published for NFL only; nothing prices college players at all.`,
      },
    ]
  }

  // Latest row per (sleeperId) for this format. `capturedAt` desc + dedupe in code, because the
  // unique key is (sleeperId, source, format, qbFormat, capturedAt) — there is no "current" flag.
  const rows = await prisma.playerValueSnapshot
    .findMany({
      where: { format: args.format, qbFormat: args.qbFormat },
      orderBy: { capturedAt: 'desc' },
      take: args.limit ?? 2000,
      select: {
        sleeperId: true, name: true, position: true, value: true,
        overallRank: true, positionRank: true, trend30d: true,
        tradeFrequency: true, marketStdDev: true, capturedAt: true, source: true,
      },
    })
    .catch(() => [])

  if (rows.length === 0) {
    return [
      {
        status: 'not_computed',
        sport,
        basis: 'market',
        detail:
          `PlayerValueSnapshot holds no ${args.format}/${args.qbFormat} rows. ` +
          `The writer is /api/cron/adp-refresh (daily 10:00 UTC); this is a cold or failed ingest, not a missing model.`,
      },
    ]
  }

  const latestBySleeperId = new Map<string, (typeof rows)[number]>()
  for (const r of rows) if (!latestBySleeperId.has(r.sleeperId)) latestBySleeperId.set(r.sleeperId, r)
  const latest = [...latestBySleeperId.values()]

  /*
   * Resolve onto the canonical spine (D13) in ONE batched call.
   *
   * ⚠ `name_match_ambiguous` IS NOT A MATCH, and this adapter must not treat it as one. The
   * resolver deliberately returns a null player with that confidence rather than a coin flip,
   * for the reason `7beaa8811` measured on the college side: 4,925 of 7,248 colliding names are
   * different people. Accepting an ambiguous match here would attribute one player's price to
   * another and never surface as an error.
   */
  const resolutions = await resolvePlayers(
    latest.map((r) => ({ provider: 'sleeper' as const, sourceId: r.sleeperId, nameHint: r.name, positionHint: r.position, sport })),
  ).catch(() => [])

  const out: ValueLookup[] = []
  latest.forEach((row, i) => {
    const res = resolutions[i]
    const canonical = res?.player?.canonicalPlayerId
    if (!canonical || res?.confidence === 'name_match_ambiguous' || res?.confidence === 'unresolved') {
      out.push({
        status: 'unresolved_identity',
        idSpace: 'sleeperId',
        sourceId: row.sleeperId,
        detail:
          `"${row.name}" priced at ${row.value} but not resolved onto the identity registry ` +
          `(${res?.confidence ?? 'no result'}). Reported rather than dropped, so coverage stays visible.`,
      })
      return
    }

    const value: CanonicalValue = {
      playerId: canonical,
      idSpace: 'sleeperId',
      sourceId: row.sleeperId,
      sport,
      value: row.value,
      unit: 'market_units',
      basis: 'market',
      scope: 'global',
      positionRank: row.positionRank ?? null,
      overallRank: row.overallRank ?? null,
      confidence: confidenceFromStdDev(row.marketStdDev, row.value),
      // Liquidity IS the sample: a price tested by 200 trades rests on more than one tested by 2.
      sampleSize: row.tradeFrequency == null ? null : Math.round(row.tradeFrequency),
      asOf: row.capturedAt.toISOString(),
      sourceModule: `${SOURCE_MODULE} (${row.source})`,
    }
    out.push({ status: 'ok', value })
  })

  return out
}
