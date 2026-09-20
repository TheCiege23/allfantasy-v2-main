/**
 * Player values from FantasyCalc, appended as a dated series.
 *
 * ⚠ NO KEEPTRADECUT, NO REDDIT. KTC's terms forbid scraping and any use that
 * "competes with the Service"; taking their values from a Reddit repost changes the
 * retrieval path, not the rights. Reddit's free tier is non-commercial only. Both are
 * excluded by decision, not oversight. (Carried over from the original script.)
 *
 * WHY THIS IS A LIBRARY AND NOT JUST A SCRIPT. This logic lived in
 * `scripts/ingest-player-values.ts`, runnable only by hand. It ran once — 1,140 rows,
 * every one stamped 2026-08-16 — and nothing scheduled it, so the series never grew.
 *
 * That matters more than it looks. Contemporaneous trade valuation reads a dated value
 * series; without one, a historical trade cannot be priced at the time it happened. The
 * only file that HAS such a series (`data/historical-values/*.json`) was converted from a
 * spreadsheet that is gitignored, uncommitted, absent from disk, and stops at 2026-02-05.
 * Of 468 trades measured on one account, 12 fell inside that window and 456 did not.
 *
 * So the same code now has two callers: the CLI, and a daily cron. This module holds no
 * process.exit and no console output — it returns what happened and lets the caller
 * decide how to report it.
 */
import { prisma } from '@/lib/prisma'

const FANTASYCALC_CURRENT = 'https://api.fantasycalc.com/values/current'

const COMBOS = [
  { format: 'DYNASTY', qbFormat: 'SUPERFLEX', url: 'isDynasty=true&numQbs=2&numTeams=12&ppr=1' },
  { format: 'DYNASTY', qbFormat: 'ONE_QB', url: 'isDynasty=true&numQbs=1&numTeams=12&ppr=1' },
  { format: 'REDRAFT', qbFormat: 'SUPERFLEX', url: 'isDynasty=false&numQbs=2&numTeams=12&ppr=1' },
  { format: 'REDRAFT', qbFormat: 'ONE_QB', url: 'isDynasty=false&numQbs=1&numTeams=12&ppr=1' },
] as const

type FcRow = {
  player: { name: string; sleeperId?: string | null; position?: string | null }
  value: number
  overallRank?: number
  positionRank?: number
  trend30Day?: number
  maybeTradeFrequency?: number | null
  maybeMovingStandardDeviation?: number | null
}

export type ComboResult = {
  format: string
  qbFormat: string
  fetched: number
  /** Pick rows stored for this combo. Was `picksFiltered` while picks were discarded. */
  picksStored: number
  stored: number
  /** Present only when this combo did not complete. */
  skipped?: string
}

export type IngestPlayerValuesResult = {
  /** The UTC day this run is filed under, not the wall-clock time it ran. */
  capturedAt: string
  stored: number
  combos: ComboResult[]
  /** True when at least one combo failed. Callers must surface this, not bury it. */
  partial: boolean
}

/**
 * One capture per UTC day, not one per invocation.
 *
 * `capturedAt` used to be `new Date()`, so the unique key
 * (sleeperId, source, format, qbFormat, capturedAt) could never collide across runs and
 * `skipDuplicates` never fired. A cron that retries — or a human running the CLI on a day
 * the cron already covered — appended a second full series for the same day, which then
 * double-counts in anything that averages across dates. Flooring to midnight UTC makes a
 * same-day re-run a genuine no-op.
 */
function captureStampFor(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export async function ingestPlayerValues(now: Date = new Date()): Promise<IngestPlayerValuesResult> {
  const capturedAt = captureStampFor(now)
  const combos: ComboResult[] = []
  let stored = 0
  let partial = false

  for (const combo of COMBOS) {
    let rows: FcRow[]
    try {
      const res = await fetch(`${FANTASYCALC_CURRENT}?${combo.url}`, {
        // Identify ourselves: if we ever cause a problem, they should be able to email us
        // rather than block us.
        headers: { 'User-Agent': 'AllFantasy/1.0 (allfantasysportsapp@gmail.com)' },
        cache: 'no-store',
      })
      if (!res.ok) {
        partial = true
        combos.push({
          format: combo.format,
          qbFormat: combo.qbFormat,
          fetched: 0,
          picksStored: 0,
          stored: 0,
          skipped: `HTTP ${res.status}`,
        })
        continue
      }
      rows = (await res.json()) as FcRow[]
    } catch (e) {
      // One combo failing must not lose the other three.
      partial = true
      combos.push({
        format: combo.format,
        qbFormat: combo.qbFormat,
        fetched: 0,
        picksStored: 0,
        stored: 0,
        skipped: e instanceof Error ? e.message.slice(0, 80) : 'fetch failed',
      })
      continue
    }

    /*
     * 🛑 PICKS ARE STORED NOW. THIS FILTER USED TO DROP THEM, AND THAT IS WHY NO TRADE
     * CONTAINING A PICK COULD EVER BE GRADED.
     *
     * FantasyCalc prices draft picks as tradeable assets and ranks them in the SAME
     * `overallRank` sequence as players — 78 of 474 entries in the measurement recorded in
     * `lib/chimmy/tools/availablePlayersTool.ts`. Discarding them threw away the only pick
     * prices we have on the same scale as our player prices, so both trade screens graded
     * "a player and a 2027 1st for a player" on the two players alone. That is not neutral:
     * it values the pick at ZERO and mechanically favours whichever side gave it.
     *
     * 🛑 SO EVERY UNSCOPED READER OF THIS TABLE MUST NOW EXCLUDE `position: 'PICK'` ITSELF.
     * A reader constrained by `sleeperId: { in: [...] }` is safe by construction — a synthetic
     * pick id (`DP_0_0`, `FP_2027_early_0`) matches no roster. The unscoped ones were censused
     * when this filter was removed:
     *   • `lib/decision-os/value/marketAdapter.ts` — guarded here, and it was the live risk:
     *     no source or position filter and a `take: 2000` cap that picks would have eaten.
     *   • `lib/trade-intel/valueLedger.ts` — guarded on its unbounded branch, which is
     *     dormant (its sole caller always passes `populationIds`, i.e. roster ids).
     *   • `app/api/cron/domain-os-refresh/route.ts` — selects `distinct (format, qbFormat)`
     *     only, so a pick row carries nothing it does not already see. Unaffected.
     *   • `lib/decision-os/grounding/intentToWant.ts` — names this table in a COMMENT and
     *     issues no query. Unaffected.
     *
     * ⚠ THE `sleeperId` HALF OF THE OLD PREDICATE IS KEPT. It is what drops rows carrying no
     * id at all; only the position half is gone. Picks DO carry a (synthetic) `sleeperId`.
     */
    const usable = rows.filter((r) => r.player?.sleeperId)

    const data = usable.map((r) => ({
      // IDs are strings even when numeric-looking — cast explicitly.
      sleeperId: String(r.player.sleeperId),
      name: r.player.name,
      position: r.player.position ?? null,
      source: 'FANTASYCALC',
      format: combo.format,
      qbFormat: combo.qbFormat,
      value: Math.round(r.value),
      overallRank: r.overallRank ?? null,
      positionRank: r.positionRank ?? null,
      trend30d: r.trend30Day ?? null,
      // `maybe*` fields are nullable BY DESIGN — null means unknown, never zero.
      tradeFrequency: r.maybeTradeFrequency ?? null,
      marketStdDev: r.maybeMovingStandardDeviation ?? null,
      capturedAt,
    }))

    await prisma.playerValueSnapshot.createMany({ data, skipDuplicates: true })
    stored += data.length
    combos.push({
      format: combo.format,
      qbFormat: combo.qbFormat,
      fetched: rows.length,
      picksStored: usable.filter((r) => r.player?.position === 'PICK').length,
      stored: data.length,
    })
  }

  return { capturedAt: capturedAt.toISOString().slice(0, 10), stored, combos, partial }
}
