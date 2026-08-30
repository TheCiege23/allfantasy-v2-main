import 'server-only'

import { prisma } from '@/lib/prisma'
import { buildContextHash, type DraftContext, type DraftMode } from '@/lib/adp/computeAllFantasyAdp'
import { buildCrossSizeBoard, type CrossSizeRow } from '@/lib/adp/crossSizeAdp'

/**
 * THE one place an AllFantasy ADP board is loaded for a league context.
 *
 * 🛑 THERE WERE THREE COPIES OF THE CONTEXT DERIVATION AND THEY DISAGREED. `buildDraftContext`
 * fixed that. This module exists so the same thing does not happen to the QUERY: the reader
 * (`readSnapshotForLeague`) and the draft-room pool (`getResolvedDraftPoolForLeague`) both need a
 * board, and if each writes its own two-tier lookup they will drift on which tier wins and what
 * counts as thin. One loader, two callers.
 *
 * TWO TIERS, in order:
 *
 *   exact       rows whose contextHash matches the league exactly. Highest fidelity — a real
 *               14-team board knows 14-team tier breaks that no projection can infer.
 *   cross_size  every board for the same sport / leagueType / scoring / rosterFormat / season at
 *               ANY team count, normalised to rounds and projected into this league's size.
 *               See lib/adp/crossSizeAdp.ts for why rounds are the comparable unit.
 *
 * ⚠ CROSS-SIZE ONLY FILLS PLAYERS THE EXACT BOARD DOES NOT CARRY. It never overwrites an exact
 * value, however thin. A surface that wants to weigh a 2-sample exact figure against a
 * 400-sample projection has `sampleSize` and `source` on every entry to do it with; silently
 * preferring the bigger number here would throw away the one thing the exact board is better at.
 *
 * ⚠ AND IT IS THE FILL THAT UNQUARANTINES THE IMPORTED CORPUS. Imported drafts carry
 * `draftType: 'imported'` because DraftFact records no draft type, so no league resolves to them
 * exactly — 25,261 of 27,742 production rows, serving nobody. The cross-size tier pools by
 * everything EXCEPT draftType and teamCount, so those rows finally reach readers, with the
 * auction caveat handled by the weighted median in crossSizeAdp.ts.
 */

export type AdpBoardSource = 'exact' | 'cross_size'

export interface AdpBoardEntry {
  playerKey: string
  playerName: string
  adp: number
  sampleSize: number
  averageRound: number | null
  averagePickInRound: number | null
  minPick: number | null
  maxPick: number | null
  standardDeviation: number | null
  sevenDayTrend: number | null
  thirtyDayTrend: number | null
  /** Which tier produced this number. `cross_size` is a projection, not a measurement. */
  source: AdpBoardSource
  /** Cross-size only: the league sizes that contributed. Null for exact rows. */
  contributingTeamCounts: number[] | null
  lastUpdatedAt: Date | null
}

export interface AdpBoard {
  entries: AdpBoardEntry[]
  contextHash: string
  draftMode: DraftMode
  exactCount: number
  crossSizeCount: number
  computedAt: Date | null
}

/** Cap on rows pulled for the cross-size tier. Generous, but not unbounded. */
const CROSS_SIZE_ROW_LIMIT = 60_000

export interface LoadAdpBoardOptions {
  draftMode?: DraftMode
  /** Set false to skip the cross-size tier entirely (diagnostics, or a strict-exact surface). */
  includeCrossSize?: boolean
}

export async function loadAdpBoard(
  context: DraftContext,
  options: LoadAdpBoardOptions = {},
): Promise<AdpBoard> {
  const draftMode = options.draftMode ?? 'real'
  const contextHash = buildContextHash(context)

  const exactRows = await prisma.allFantasyAdpSnapshot.findMany({
    where: { contextHash, draftMode },
    orderBy: { averageOverallPick: 'asc' },
    select: {
      playerKey: true,
      playerName: true,
      sampleSize: true,
      averageOverallPick: true,
      averageRound: true,
      averagePickInRound: true,
      minOverallPick: true,
      maxOverallPick: true,
      standardDeviation: true,
      sevenDayTrend: true,
      thirtyDayTrend: true,
      lastUpdatedAt: true,
    },
  })

  const entries: AdpBoardEntry[] = exactRows.map((r) => ({
    playerKey: r.playerKey,
    playerName: r.playerName,
    adp: r.averageOverallPick,
    sampleSize: r.sampleSize,
    averageRound: r.averageRound,
    averagePickInRound: r.averagePickInRound,
    minPick: r.minOverallPick,
    maxPick: r.maxOverallPick,
    standardDeviation: r.standardDeviation,
    sevenDayTrend: r.sevenDayTrend,
    thirtyDayTrend: r.thirtyDayTrend,
    source: 'exact' as const,
    contributingTeamCounts: null,
    lastUpdatedAt: r.lastUpdatedAt,
  }))

  let computedAt: Date | null = null
  for (const r of exactRows) {
    if (!computedAt || r.lastUpdatedAt > computedAt) computedAt = r.lastUpdatedAt
  }

  const exactCount = entries.length
  let crossSizeCount = 0

  if (options.includeCrossSize !== false) {
    const have = new Set(entries.map((e) => e.playerKey))

    /*
     * Deliberately NOT filtered on teamCount or draftType — those are the two axes being pooled.
     * Everything else must still match, because a PPR board is not a standard board and a dynasty
     * board is not a redraft board no matter how the league is sized.
     */
    const poolRows = await prisma.allFantasyAdpSnapshot.findMany({
      where: {
        draftMode,
        sport: context.sport,
        leagueType: context.leagueType,
        scoringFormat: context.scoringFormat,
        rosterFormat: context.rosterFormat,
        season: context.season,
      },
      select: {
        playerKey: true,
        playerName: true,
        teamCount: true,
        draftType: true,
        averageOverallPick: true,
        sampleSize: true,
        lastUpdatedAt: true,
      },
      take: CROSS_SIZE_ROW_LIMIT,
    })

    const projected = buildCrossSizeBoard(poolRows as CrossSizeRow[], {
      targetTeamCount: context.teamCount,
      targetDraftType: context.draftType,
    })

    for (const [playerKey, entry] of projected) {
      if (have.has(playerKey)) continue
      entries.push({
        playerKey,
        playerName: entry.playerName,
        adp: entry.adp,
        sampleSize: entry.sampleSize,
        /*
         * Null rather than derived. Round and pick-in-round could be computed from the projected
         * overall, but they would be arithmetic dressed as observation - we did not measure this
         * player's round in THIS league size. A caller that needs a round can divide; a caller
         * reading these fields is reading measurements, and must get null when there is none.
         */
        averageRound: null,
        averagePickInRound: null,
        minPick: null,
        maxPick: null,
        standardDeviation: null,
        sevenDayTrend: null,
        thirtyDayTrend: null,
        source: 'cross_size' as const,
        contributingTeamCounts: entry.contributingTeamCounts,
        lastUpdatedAt: null,
      })
      crossSizeCount++
    }

    if (computedAt == null) {
      for (const r of poolRows) {
        if (!computedAt || r.lastUpdatedAt > computedAt) computedAt = r.lastUpdatedAt
      }
    }
  }

  entries.sort((a, b) => a.adp - b.adp)

  return { entries, contextHash, draftMode, exactCount, crossSizeCount, computedAt }
}
