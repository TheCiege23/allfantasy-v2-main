import { prisma } from '@/lib/prisma'
import { fetchNFLDepthCharts } from '@/lib/rolling-insights'

/**
 * Fill the `depth_charts` table, which had readers and no writer.
 *
 * `lib/depth-charts.ts` is cache-only by design — it never calls a provider —
 * and `lib/trade-intel/depthChartRole.ts` reads it. Neither was ever going to
 * return anything, because nothing populated the table. This is the missing
 * half.
 *
 * ⚠ AN INGESTION MODULE, DELIBERATELY. The DB-first boundary allows a provider
 * call here and nowhere else; every read path stays on Postgres. See CLAUDE.md.
 *
 * ⚠ PLAYER NAMES ARE STORED, NOT PROVIDER IDS, and that is a considered choice
 * rather than laziness. The reader matches on a normalised name or on a SLEEPER
 * id; Rolling Insights issues neither, so storing its own ids would make every
 * lookup miss. Names are the only join available without an RI→Sleeper
 * crosswalk, and their weakness is documented at the matcher.
 *
 * ⚠ THE ORDER IS THE ENTIRE PAYLOAD. `players[0]` is the starter and everything
 * downstream depends on that; the provider's ordering is preserved exactly and
 * never sorted.
 */

/** How long a chart is trusted before it should be refetched. */
const TTL_HOURS = 12

/**
 * Positions worth persisting.
 *
 * ⚠ THE OFFENSIVE LINE IS INCLUDED ON PURPOSE. LT/LG/C/RG/RT are not fantasy
 * positions and nothing starts them, but line quality is a real input to a
 * running back's value and the value ledger lists it as a gap. Dropping them
 * here would close a door that is currently open for free.
 */
const KEEP_POSITIONS = new Set([
  'QB', 'RB', 'FB', 'WR', 'WR1', 'WR2', 'WR3', 'TE', 'K', 'P',
  'LT', 'LG', 'C', 'RG', 'RT',
  'DE', 'DT', 'NT', 'DL', 'EDGE', 'LB', 'ILB', 'OLB', 'CB', 'S', 'SS', 'FS',
])

export type DepthChartIngestResult = {
  teamsFetched: number
  rowsWritten: number
  positionsSkipped: number
  /** Present only when the run did not complete. */
  error?: string
}

export async function ingestDepthCharts(args?: {
  sport?: string
  source?: string
}): Promise<DepthChartIngestResult> {
  const sport = (args?.sport ?? 'NFL').toUpperCase()
  const source = args?.source ?? 'rolling_insights'

  let charts: Awaited<ReturnType<typeof fetchNFLDepthCharts>>
  try {
    charts = await fetchNFLDepthCharts()
  } catch (e) {
    /*
     * ⚠ NEVER SURFACE THE ERROR VERBATIM. Rolling Insights passes RSC_token as a
     * QUERY PARAMETER, so a thrown fetch error can carry the full URL and with
     * it a long-lived credential. Only the error's name reaches the caller.
     */
    return {
      teamsFetched: 0,
      rowsWritten: 0,
      positionsSkipped: 0,
      error: e instanceof Error ? e.name : 'depth chart fetch failed',
    }
  }

  if (charts.length === 0) {
    return { teamsFetched: 0, rowsWritten: 0, positionsSkipped: 0 }
  }

  const expiresAt = new Date(Date.now() + TTL_HOURS * 60 * 60 * 1000)
  let rowsWritten = 0
  let positionsSkipped = 0

  for (const chart of charts) {
    const team = (chart.abbrv || chart.team || '').trim()
    if (!team) continue

    for (const [rawPosition, players] of Object.entries(chart.positions ?? {})) {
      const position = rawPosition.toUpperCase().trim()
      if (!KEEP_POSITIONS.has(position)) {
        positionsSkipped += 1
        continue
      }
      if (!Array.isArray(players) || players.length === 0) continue

      /*
       * Order preserved exactly as the provider gave it. Names only — see the
       * header for why ids would break every lookup.
       */
      const names = players
        .map((p) => (p?.player ?? '').trim())
        .filter((n) => n.length > 0)
      if (names.length === 0) continue

      try {
        await prisma.depthChart.upsert({
          where: {
            sport_team_position_source: { sport, team, position, source },
          },
          create: {
            sport,
            team,
            teamId: chart.teamId || null,
            position,
            players: names,
            source,
            expiresAt,
          },
          update: {
            teamId: chart.teamId || null,
            players: names,
            fetchedAt: new Date(),
            expiresAt,
          },
        })
        rowsWritten += 1
      } catch {
        /*
         * One bad row must not lose the other four hundred. Counted by absence
         * rather than thrown — the caller compares rowsWritten against what it
         * expected.
         */
      }
    }
  }

  return { teamsFetched: charts.length, rowsWritten, positionsSkipped }
}
