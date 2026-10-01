import 'server-only'

import { resolveCurrentWeek } from './currentWeek'
import { getAutoCoachReceipts, resolveChimmyAdviceOutcomes, type ReceiptsLeague } from './decisionReceipts'
import { buildDecisionRecord, type DecisionRecord } from './decisionRecordModel'

/**
 * The Career decision record's reads — this season's Chimmy and AutoCoach calls, resolved by the
 * Receipts card's own resolvers with the window widened from 45 days to the season and the five-row
 * cap lifted. Nothing new is stored and no rule is restated (see `decisionRecordModel.ts`).
 *
 * The current week comes from `resolveCurrentWeek`, the home's own source, so a week still being
 * played is pending here exactly when it is pending on the Receipts card.
 *
 * Null when there is nothing to say, or when either read failed in a way that would make the record
 * understate itself — a missing half reads as "you rarely took advice", which is a claim, not a gap.
 */
export async function getDecisionRecord(args: {
  userId: string
  leagues: readonly ReceiptsLeague[]
  /** The season the record covers — the user's newest. */
  season: number
}): Promise<(DecisionRecord & { season: number }) | null> {
  const platformIds = args.leagues.map((l) => l.platformLeagueId ?? '').filter(Boolean)
  const currentWeek = await resolveCurrentWeek(platformIds)
    .then((v) => v?.week ?? null)
    .catch(() => null)
  // August 1: early enough for any preseason advice, never last season's.
  const since = new Date(Date.UTC(args.season, 7, 1))

  const [chimmy, autocoach] = await Promise.all([
    resolveChimmyAdviceOutcomes({ userId: args.userId, leagues: args.leagues, currentWeek, since }).catch(() => undefined),
    getAutoCoachReceipts({
      userId: args.userId,
      leagues: args.leagues,
      currentWeek,
      since,
      limit: Number.POSITIVE_INFINITY,
    }).catch(() => undefined),
  ])
  // `undefined` = the read threw; `null` from the receipts = nothing to read (no table, no leagues).
  if (chimmy === undefined || autocoach === undefined) return null

  const inSeason = <T extends { season: number }>(rows: readonly T[]) => rows.filter((r) => r.season === args.season)
  const record = buildDecisionRecord({
    chimmy: inSeason(chimmy?.startSits ?? []),
    autocoach: inSeason(autocoach?.autocoach ?? []),
    adds: inSeason(chimmy?.adds ?? []),
  })
  return record ? { ...record, season: args.season } : null
}
