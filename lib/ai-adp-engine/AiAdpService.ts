/**
 * AI ADP service: run aggregation + computation, persist snapshots, and read for draft room.
 */

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { aggregateLiveDraftPicks, aggregateMockDraftResults, mergeSegmentPicks } from './aggregate-draft-picks'
import { computeAdpFromPicks, buildSnapshotDataAndMeta } from './compute-adp'
import type { AiAdpPlayerEntry } from './types'
import { LOW_SAMPLE_THRESHOLD_DEFAULT, MIN_SAMPLE_SIZE_DEFAULT } from './types'
import { resolveAiAdpSegmentContext } from './segment-resolver'
import { AI_ADP_MIN_DRAFTS_TO_PUBLISH, isAiAdpConsumerEnabled } from './aiAdpConsumerFlag'

export interface RunAiAdpJobResult {
  segmentsUpdated: number
  segmentsConsidered: number
  totalPicksProcessed: number
  cutoffApplied: string
  errors: string[]
}

export interface RunAiAdpJobOptions {
  since?: Date
  lookbackDays?: number
  lowSampleThreshold?: number
  minSampleSize?: number
  runReason?: string
  scheduledAtUtc?: string | null
  now?: Date
}

const DEFAULT_LOOKBACK_DAYS = 120
const STALE_AFTER_HOURS = 36

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function resolveRunOptions(
  input?: Date | RunAiAdpJobOptions,
  lowSampleThresholdLegacy?: number
): Required<Pick<RunAiAdpJobOptions, 'lowSampleThreshold' | 'minSampleSize' | 'lookbackDays' | 'runReason' | 'scheduledAtUtc' | 'now'>> & {
  since?: Date
} {
  if (input instanceof Date) {
    return {
      since: input,
      lookbackDays: DEFAULT_LOOKBACK_DAYS,
      lowSampleThreshold: clampInt(
        Number(lowSampleThresholdLegacy ?? LOW_SAMPLE_THRESHOLD_DEFAULT),
        2,
        25
      ),
      minSampleSize: MIN_SAMPLE_SIZE_DEFAULT,
      runReason: 'manual',
      scheduledAtUtc: null,
      now: new Date(),
    }
  }

  const source = input ?? {}
  return {
    since: source.since,
    lookbackDays: clampInt(
      Number(source.lookbackDays ?? DEFAULT_LOOKBACK_DAYS),
      30,
      365
    ),
    lowSampleThreshold: clampInt(
      Number(source.lowSampleThreshold ?? LOW_SAMPLE_THRESHOLD_DEFAULT),
      2,
      25
    ),
    minSampleSize: clampInt(
      Number(source.minSampleSize ?? MIN_SAMPLE_SIZE_DEFAULT),
      1,
      25
    ),
    runReason: String(source.runReason ?? 'cron'),
    scheduledAtUtc: source.scheduledAtUtc ?? null,
    now: source.now ?? new Date(),
  }
}

function resolveCutoffDate(options: { since?: Date; lookbackDays: number; now: Date }): Date {
  if (options.since && !Number.isNaN(options.since.getTime())) return options.since
  return new Date(options.now.getTime() - options.lookbackDays * 24 * 60 * 60 * 1000)
}

async function appendAiAdpHistoryRow(input: {
  sport: string
  leagueType: string
  formatKey: string
  snapshotData: AiAdpPlayerEntry[]
  totalDrafts: number
  totalPicks: number
  computedAt: Date
  runMeta: Record<string, unknown>
}): Promise<void> {
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "ai_adp_snapshot_history"
      ("id", "sport", "leagueType", "formatKey", "snapshotData", "totalDrafts", "totalPicks", "computedAt", "runMeta")
      VALUES ($1, $2, $3, $4, CAST($5 AS JSONB), $6, $7, $8, CAST($9 AS JSONB))
    `,
    randomUUID(),
    input.sport,
    input.leagueType,
    input.formatKey,
    JSON.stringify(input.snapshotData),
    input.totalDrafts,
    input.totalPicks,
    input.computedAt,
    JSON.stringify(input.runMeta)
  )
}

/**
 * Run the full AI ADP job: aggregate picks from live + mock, compute ADP per segment, upsert AiAdpSnapshot.
 * Call from cron daily.
 */
export async function runAiAdpJob(
  input?: Date | RunAiAdpJobOptions,
  lowSampleThresholdLegacy?: number
): Promise<RunAiAdpJobResult> {
  const errors: string[] = []
  let totalPicksProcessed = 0
  const options = resolveRunOptions(input, lowSampleThresholdLegacy)
  const cutoff = resolveCutoffDate({
    since: options.since,
    lookbackDays: options.lookbackDays,
    now: options.now,
  })

  let live: Awaited<ReturnType<typeof aggregateLiveDraftPicks>> = []
  let mock: Awaited<ReturnType<typeof aggregateMockDraftResults>> = []
  try {
    ;[live, mock] = await Promise.all([
      aggregateLiveDraftPicks(cutoff),
      aggregateMockDraftResults(cutoff),
    ])
  } catch (e) {
    errors.push((e as Error).message)
    return {
      segmentsUpdated: 0,
      segmentsConsidered: 0,
      totalPicksProcessed: 0,
      cutoffApplied: cutoff.toISOString(),
      errors,
    }
  }

  const merged = mergeSegmentPicks(live, mock)
  const computed = computeAdpFromPicks(merged, {
    lowSampleThreshold: options.lowSampleThreshold,
    minSampleSize: options.minSampleSize,
  })
  let segmentsUpdated = 0

  for (const [, { segment, entries }] of computed) {
    const segData = merged.find(
      (s) =>
        s.segment.sport === segment.sport &&
        s.segment.leagueType === segment.leagueType &&
        s.segment.formatKey === segment.formatKey
    )
    const totalPicks = segData?.picks.length ?? 0
    const totalDrafts = segData?.draftCount ?? 0
    if (entries.length === 0) continue
    /*
     * 🛑 A SEGMENT BUILT FROM TOO FEW DRAFTS IS NOT PUBLISHED AT ALL.
     *
     * `minSampleSize` (default 2) is a PER-PLAYER filter and is the only enforced gate in
     * this engine — `lowSample` is stamped onto every entry and then read by no consumer, so
     * annotating a thin board protects nothing. Without a segment floor, two completed drafts
     * sharing 16 picks publish a snapshot that downstream code treats exactly like a
     * well-sampled one, including in the draft recommender where it OUTRANKS the real board.
     */
    if (totalDrafts < AI_ADP_MIN_DRAFTS_TO_PUBLISH) {
      errors.push(
        `skipped ${segment.sport}/${segment.leagueType}/${segment.formatKey}: ${totalDrafts} draft(s) < ${AI_ADP_MIN_DRAFTS_TO_PUBLISH}`
      )
      continue
    }
    totalPicksProcessed += totalPicks
    const { snapshotData, meta } = buildSnapshotDataAndMeta(
      entries,
      totalDrafts,
      totalPicks,
      options.lowSampleThreshold,
      options.minSampleSize
    )
    const runMeta = {
      ...meta,
      source: segData?.source ?? null,
      runReason: options.runReason,
      scheduledAtUtc: options.scheduledAtUtc,
      cutoffApplied: cutoff.toISOString(),
    }
    const computedAt = new Date()

    try {
      await prisma.aiAdpSnapshot.upsert({
        where: {
          sport_leagueType_formatKey: {
            sport: segment.sport,
            leagueType: segment.leagueType,
            formatKey: segment.formatKey,
          },
        },
        create: {
          sport: segment.sport,
          leagueType: segment.leagueType,
          formatKey: segment.formatKey,
          snapshotData: snapshotData as any,
          totalDrafts,
          totalPicks,
          meta: runMeta as any,
          computedAt,
        },
        update: {
          snapshotData: snapshotData as any,
          totalDrafts,
          totalPicks,
          meta: runMeta as any,
          computedAt,
        },
      })
      try {
        await appendAiAdpHistoryRow({
          sport: segment.sport,
          leagueType: segment.leagueType,
          formatKey: segment.formatKey,
          snapshotData,
          totalDrafts,
          totalPicks,
          computedAt,
          runMeta,
        })
      } catch (historyError) {
        errors.push(
          `History ${segment.sport}/${segment.leagueType}/${segment.formatKey}: ${
            (historyError as Error).message
          }`
        )
      }
      segmentsUpdated++
    } catch (e) {
      errors.push(`Segment ${segment.sport}/${segment.leagueType}/${segment.formatKey}: ${(e as Error).message}`)
    }
  }

  return {
    segmentsUpdated,
    segmentsConsidered: computed.size,
    totalPicksProcessed,
    cutoffApplied: cutoff.toISOString(),
    errors,
  }
}

/**
 * Get AI ADP for a segment. Returns entries with lowSample flag; null if no snapshot.
 */
export async function getAiAdp(
  sport: string,
  leagueType: string = 'redraft',
  formatKey: string = 'default'
): Promise<{
  entries: AiAdpPlayerEntry[]
  totalDrafts: number
  totalPicks: number
  computedAt: Date | null
  lowSampleThreshold?: number
  stale: boolean
  ageHours: number | null
} | null> {
  /*
   * 🛑 THE GATE LIVES HERE, NOT AT THE CALL SITES — I got this wrong the first time.
   *
   * `isAiAdpConsumerEnabled()` was originally applied only to the two HTTP routes, and the
   * commit message claimed every reader was covered. It was not: FOUR server-side readers
   * reach this table without passing through a route —
   *   lib/live-draft-engine/autopickBestAvailableSubmit.ts (LIVE DRAFT AUTOPICK)
   *   lib/workers/adp-blender.ts
   *   lib/workers/adp-importer.ts (its own direct prisma read, gated separately)
   *   lib/post-draft-manager-ranking/adpResolver.ts
   * Nothing had broken only because the table was still empty; the first cron write would
   * have switched autopick over silently.
   *
   * Gating the READ instead of the callers makes coverage structural: a reader added later
   * is covered by construction rather than by remembering to enumerate it.
   */
  if (!isAiAdpConsumerEnabled()) return null

  const segment = resolveAiAdpSegmentContext({
    sport,
    leagueType,
    settings: { formatKey },
  })
  const snapshot = await prisma.aiAdpSnapshot.findUnique({
    where: {
      sport_leagueType_formatKey: {
        sport: segment.sport,
        leagueType: segment.leagueType,
        formatKey: segment.formatKey,
      },
    },
  })
  if (!snapshot) return null
  const data = (snapshot.snapshotData as unknown as AiAdpPlayerEntry[]) ?? []
  const meta = (snapshot.meta as Record<string, unknown>) ?? {}
  const computedAt = snapshot.computedAt ?? null
  const ageHours = computedAt
    ? (Date.now() - computedAt.getTime()) / (60 * 60 * 1000)
    : null
  const stale = ageHours != null ? ageHours >= STALE_AFTER_HOURS : true
  return {
    entries: data,
    totalDrafts: snapshot.totalDrafts,
    totalPicks: snapshot.totalPicks,
    computedAt,
    lowSampleThreshold: meta.lowSampleThreshold as number | undefined,
    stale,
    ageHours: ageHours != null ? Math.round(ageHours * 10) / 10 : null,
  }
}

/**
 * Get best-matching AI ADP for a league (sport, isDynasty, format from settings).
 * Falls back to sport + redraft + default if exact segment missing.
 */
export async function getAiAdpForLeague(
  sport: string,
  isDynasty: boolean,
  formatKey?: string
): Promise<{
  entries: AiAdpPlayerEntry[]
  totalDrafts: number
  totalPicks: number
  computedAt: Date | null
  segment: { sport: string; leagueType: string; formatKey: string }
  lowSampleThreshold?: number
  stale: boolean
  ageHours: number | null
} | null> {
  const baseSegment = resolveAiAdpSegmentContext({
    sport,
    isDynasty,
    settings: { formatKey: formatKey ?? 'default' },
  })
  let result = await getAiAdp(
    baseSegment.sport,
    baseSegment.leagueType,
    baseSegment.formatKey
  )
  if (result) {
    return {
      ...result,
      segment: baseSegment,
    }
  }

  result = await getAiAdp(baseSegment.sport, baseSegment.leagueType, 'default')
  if (result) {
    return {
      ...result,
      segment: {
        sport: baseSegment.sport,
        leagueType: baseSegment.leagueType,
        formatKey: 'default',
      },
    }
  }

  const sameLeagueType = await prisma.aiAdpSnapshot.findMany({
    where: {
      sport: baseSegment.sport,
      leagueType: baseSegment.leagueType,
    },
    orderBy: [{ totalDrafts: 'desc' }, { computedAt: 'desc' }],
    take: 1,
  })
  if (sameLeagueType[0]) {
    result = await getAiAdp(
      baseSegment.sport,
      baseSegment.leagueType,
      sameLeagueType[0].formatKey
    )
    if (result) {
      return {
        ...result,
        segment: {
          sport: baseSegment.sport,
          leagueType: baseSegment.leagueType,
          formatKey: sameLeagueType[0].formatKey,
        },
      }
    }
  }

  /*
   * 🛑 A DYNASTY LEAGUE IS NEVER SERVED A REDRAFT BOARD.
   *
   * The two remaining legs cross leagueType, and for dynasty that is not a graceful
   * degradation — it is a different market. Redraft ADP prices this season; dynasty prices
   * a career, so rookies and ageing veterans invert between them. Production has 45 NFL
   * dynasty leagues against 49 redraft, `draftUISettings.aiAdpEnabled` defaults TRUE, and
   * nothing downstream renders the `segment` field returned below — so before this guard a
   * dynasty manager was shown a redraft board with no way to tell, and the draft recommender
   * ranked it above their real ADP.
   *
   * Returning null puts them back on standard ADP, which is correct rather than merely safe.
   */
  if (baseSegment.leagueType === 'dynasty') return null

  result = await getAiAdp(baseSegment.sport, 'redraft', 'default')
  if (result) {
    return {
      ...result,
      segment: {
        sport: baseSegment.sport,
        leagueType: 'redraft',
        formatKey: 'default',
      },
    }
  }

  const anySportSegment = await prisma.aiAdpSnapshot.findFirst({
    where: { sport: baseSegment.sport },
    orderBy: [{ totalDrafts: 'desc' }, { computedAt: 'desc' }],
  })
  if (anySportSegment) {
    result = await getAiAdp(
      anySportSegment.sport,
      anySportSegment.leagueType,
      anySportSegment.formatKey
    )
    if (result) {
      return {
        ...result,
        segment: {
          sport: anySportSegment.sport,
          leagueType: anySportSegment.leagueType,
          formatKey: anySportSegment.formatKey,
        },
      }
    }
  }

  return null
}

export async function getRecentAiAdpHistory(limit: number = 25): Promise<
  Array<{
    id: string
    sport: string
    leagueType: string
    formatKey: string
    totalDrafts: number
    totalPicks: number
    computedAt: string
    entryCount: number
    runMeta: Record<string, unknown> | null
  }>
> {
  const safeLimit = clampInt(Number(limit), 1, 200)
  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: string
        sport: string
        leagueType: string
        formatKey: string
        totalDrafts: number
        totalPicks: number
        computedAt: Date
        entryCount: number
        runMeta: Record<string, unknown> | null
      }>
    >(
      `
        SELECT
          h."id",
          h."sport",
          h."leagueType",
          h."formatKey",
          h."totalDrafts",
          h."totalPicks",
          h."computedAt",
          jsonb_array_length(h."snapshotData") AS "entryCount",
          h."runMeta"
        FROM "ai_adp_snapshot_history" h
        ORDER BY h."computedAt" DESC
        LIMIT $1
      `,
      safeLimit
    )
    return rows.map((row) => ({
      ...row,
      computedAt: row.computedAt.toISOString(),
      entryCount: Number(row.entryCount ?? 0),
      runMeta: row.runMeta ?? null,
    }))
  } catch {
    // History table may not exist before migration is applied.
    return []
  }
}
