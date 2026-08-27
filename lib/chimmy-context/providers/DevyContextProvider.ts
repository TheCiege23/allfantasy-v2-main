/**
 * DevyContextProvider — college/devy prospect grounding for Chimmy.
 *
 * WHY THIS EXISTS. Chimmy had ZERO devy references. Measured 2026-08-27, no
 * module under `lib/chimmy*` or `lib/ai/` touched `DevyPlayer` at all, so a user
 * asking "should I trade for Julian Sayin" got an answer with no access to the
 * 1,718-player pool, the stat lines, or the ranked board — all of which sit in
 * Postgres and are refreshed by the import-players cron.
 *
 * Rules, matching the other providers:
 *   - DB-first (Prisma only, through the canonical board builder).
 *   - Never throws; a failure returns `{ ok: false, data: null }` with a short
 *     reason, and the engine records it in `meta.providers`.
 *   - Returns `data: null` when the pool is empty rather than an empty board,
 *     so "we have no devy data" is distinguishable from "no prospects exist".
 *
 * ⚠ RANK IS RELATIVE, SO THE BOARD IS BUILT FROM THE WHOLE POOL. Ranking only
 * the rows we intend to show would make the best of them the number one devy
 * asset in the world — `legacy/devy-board` calls this out as a shortlist that
 * "reads as a class of blue chips". The board is built from the eligible pool
 * and only then sliced for display.
 *
 * ⚠ AND IT CARRIES ITS OWN COVERAGE. `requireProjection` drops players nothing
 * has scouted rather than ranking them off the bottom, so the board is a
 * MINORITY of the pool by design. Chimmy is told how big that minority is,
 * because "the best available devy QB" and "the best of the ones we can rank"
 * are different claims and only one of them is true.
 */

import type {
  ChimmyContextProvider,
  ChimmyContextRequest,
  DevyContextSlice,
  DevyProspect,
  ProviderResult,
} from '@/lib/chimmy-context/types'
import { getEligibleDevyPlayers } from '@/lib/devy-classification'
import { buildDevyValueBoard } from '@/lib/devy/devyValueBoard'

/** How many prospects to hand the prompt. The board is built from the full pool. */
const TOP_N = 25

export class DevyContextProvider implements ChimmyContextProvider<DevyContextSlice> {
  readonly name = 'devy'
  /**
   * Longer than the matchup providers on purpose: the board only moves when the
   * devy ingest phases run, which is at most daily.
   */
  readonly defaultTtlMs = 30 * 60 * 1000

  async load(_request: ChimmyContextRequest): Promise<ProviderResult<DevyContextSlice>> {
    const startedAt = Date.now()
    const fetchedAt = new Date().toISOString()

    try {
      const pool = await getEligibleDevyPlayers({ requireProjection: true, limit: 2000 })

      if (!Array.isArray(pool) || pool.length === 0) {
        // null, not an empty board: "we hold no devy data" is a different answer
        // from "there are no prospects", and Chimmy must not conflate them.
        return { ok: true, data: null, fetchedAt, durationMs: Date.now() - startedAt }
      }

      const board = buildDevyValueBoard(
        (pool as Array<Record<string, unknown>>).map((p) => ({
          id: String(p.id ?? ''),
          name: String(p.name ?? ''),
          position: (p.position as string) ?? null,
          school: (p.school as string) ?? null,
          draftEligibleYear: (p.draftEligibleYear as number) ?? null,
          classYear: (p.classYear as number) ?? null,
          draftProjectionScore: (p.draftProjectionScore as number) ?? null,
          recruitingComposite: (p.recruitingComposite as number) ?? null,
          breakoutAge: (p.breakoutAge as number) ?? null,
          projectedDraftRound: (p.projectedDraftRound as number) ?? null,
          devyAdp: (p.devyAdp as number) ?? null,
        })),
        new Date().getFullYear(),
      )

      const topProspects: DevyProspect[] = board.entries
        .filter((e) => e.devyRank != null)
        .slice(0, TOP_N)
        .map((e) => ({
          name: e.name,
          position: e.position,
          school: e.school,
          classYear: null,
          draftEligibleYear: null,
          devyRank: e.devyRank,
          // Board points, null when unranked — never 0. See DevyContextSlice.
          value: e.value.value,
        }))

      return {
        ok: true,
        data: {
          topProspects,
          ranked: board.ranked,
          unranked: board.unranked,
          coverage: board.coverage,
          gaps: board.gaps,
        },
        fetchedAt,
        durationMs: Date.now() - startedAt,
      }
    } catch (error) {
      // Never reject: one provider failing must not take the bundle down, and a
      // named failure in meta.providers beats a silently absent slice.
      return {
        ok: false,
        data: null,
        error: error instanceof Error ? error.message.slice(0, 160) : 'devy board unavailable',
        fetchedAt,
        durationMs: Date.now() - startedAt,
      }
    }
  }
}
