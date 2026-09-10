/**
 * DEPRECATED SHIM — superseded by `./maxPfReads.ts`.
 *
 * 🛑 THE VERSION THAT LIVED HERE CARRIED AN ID-SPACE BUG AND IT IS RECORDED RATHER THAN QUIETLY
 * DELETED. It queried `prisma.weeklyMatchup.findMany({ where: { leagueId: input.leagueId } })` with
 * the AllFantasy `League.id`. **`WeeklyMatchup.leagueId` is the PLATFORM (Sleeper) league id** —
 * every other reader in the repo passes `league.platformLeagueId`. The query matched ZERO rows, the
 * status resolved to `missing`, and the freeze would have been permanently unavailable with nothing
 * red anywhere. It failed in the SAFE direction, fabricating no number, which is exactly why it
 * could have survived: "not ready yet" is a plausible thing for a league to report. It was found by
 * auditing the writer, not by any test.
 *
 * It also summed `WeeklyMatchup.pointsFor` — points ACTUALLY SCORED. That metric is not Max PF and
 * is the thing this phase replaced.
 *
 * ⚠ THIS FILE STILL EXISTS BECAUSE A PUBLISHED TEMPLATE VERSION NAMES IT.
 * `efl_promotion_relegation_dynasty@1.1.0` lists it in `composedEngines`, and a published version
 * must not be edited in place. Deleting the module would leave that pinned contract pointing at
 * nothing. So the path stays truthful and now resolves to the corrected implementation.
 *
 * New code should import from `./maxPfReads.ts` directly.
 */

export {
  readMaxPfFreezeStatus,
  starterSeatsFromTemplate,
  type MaxPfDataProvenance,
  type ReadMaxPfFreezeResult,
  type ReadMaxPfInput,
} from '@/lib/commissioner-os/efl/maxPfReads'
