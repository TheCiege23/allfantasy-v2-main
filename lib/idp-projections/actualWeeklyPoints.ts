import type { PrismaClient } from '@prisma/client'

import { computeLeagueProjectedPoints } from '@/lib/projections/leagueScoring'

/**
 * What a player ACTUALLY scored in a given week, under a given league's own scoring.
 *
 * The projection stack scores a projected stat line against `scoring_settings`. Nothing scored
 * the REAL one — so every surface that wanted "what did he put up for me last week" either had
 * no answer or invented one. `lib/ai/sim/groundedTradeDelta.ts` writes `actualPoints: 0` in two
 * places for exactly this reason, which is the zero-for-unknown substitution this codebase keeps
 * having to undo.
 *
 * The arithmetic is identical to the projection path — `computeLeagueProjectedPoints` is a dot
 * product of a stat line against the league's weights, and it does not care whether the line was
 * predicted or observed. Using the same function is the point: a projected 12.4 and an actual
 * 12.4 are then guaranteed to mean the same thing, which they would not be if a second scorer
 * existed with its own view of `STAT_ALIASES`.
 */

export type ActualWeekOutcome =
  | { scored: true; points: number; matchedKeys: number }
  /**
   * ⚠ THE TWO ABSENCES ARE DIFFERENT AND A READER ACTS ON THEM DIFFERENTLY. `no_game` means we
   * hold no line for him that week — bye, inactive, or simply not ingested yet — and the honest
   * display is a dash. `unscored` means we hold the line and this league's settings priced none
   * of it, which is a scoring-configuration answer, not a player answer. Collapsing either into
   * 0.0 tells a manager his starter blanked.
   */
  | {
      scored: false
      reason: 'no_game' | 'unscored'
      /**
       * How many keys the stored line carried, for `unscored` only.
       *
       * ⚠ IT SEPARATES TWO CULPRITS THAT LOOK IDENTICAL. A line rich in stats that this league
       * prices at nothing is a SCORING-SETTINGS answer. A line holding only `def_snp` and
       * `tm_def_snp` — which is most of what we ingest for defensive backs — is an INGEST answer:
       * he recorded tackles, we just do not hold them. Measured on production, the second case is
       * the common one, and telling a manager his league does not score his cornerback would send
       * him to change settings that were never the problem.
       */
      lineKeys?: number
    }

export interface LoadActualWeeklyPointsArgs {
  prisma: Pick<PrismaClient, 'playerGameStat'>
  sport?: string
  season: number
  /** The week to score. A COMPLETED week — scoring one in progress reports a partial as a total. */
  week: number
  playerIds: readonly string[]
  /** The league's own `scoring_settings`. Never a default: an unpriced league gets nothing. */
  scoring: Record<string, unknown> | null | undefined
}

export async function loadActualWeeklyPoints(
  args: LoadActualWeeklyPointsArgs,
): Promise<Map<string, ActualWeekOutcome>> {
  const out = new Map<string, ActualWeekOutcome>()
  const ids = [...new Set(args.playerIds.filter((x) => typeof x === 'string' && x.length > 0))]
  if (ids.length === 0) return out

  /*
   * No scoring settings means we cannot say what a stat line was worth HERE, and a league-scored
   * number computed against someone else's weights is worse than no number. Every player comes
   * back unscored rather than the caller receiving a half-answer it cannot distinguish.
   */
  if (!args.scoring || typeof args.scoring !== 'object') {
    for (const id of ids) out.set(id, { scored: false, reason: 'unscored' })
    return out
  }

  const rows = await args.prisma.playerGameStat
    .findMany({
      where: {
        sportType: args.sport ?? 'NFL',
        season: args.season,
        weekOrRound: args.week,
        playerId: { in: ids },
      },
      select: { playerId: true, normalizedStatMap: true },
    })
    .catch(() => [] as Array<{ playerId: string; normalizedStatMap: unknown }>)

  const lineByPlayer = new Map<string, unknown>()
  for (const r of rows) if (!lineByPlayer.has(r.playerId)) lineByPlayer.set(r.playerId, r.normalizedStatMap)

  for (const id of ids) {
    const line = lineByPlayer.get(id)
    if (line == null) {
      out.set(id, { scored: false, reason: 'no_game' })
      continue
    }
    const result = computeLeagueProjectedPoints(line as Record<string, unknown>, args.scoring)
    /*
     * `computeLeagueProjectedPoints` returns null when no scoring key matched the line — the
     * same refusal it makes for projections. A defender in a league with no IDP scoring lands
     * here, and the answer is that this league does not price what he did, not that he did
     * nothing.
     */
    if (!result) {
      const keys = typeof line === 'object' && line ? Object.keys(line as object).length : 0
      out.set(id, { scored: false, reason: 'unscored', lineKeys: keys })
      continue
    }
    out.set(id, {
      scored: true,
      points: Math.round(result.points * 100) / 100,
      matchedKeys: result.coverage?.matchedKeys ?? 0,
    })
  }

  return out
}
