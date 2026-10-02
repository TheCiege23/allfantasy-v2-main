import 'server-only'

import { resolveCurrentWeek } from './currentWeek'
import {
  getAutoCoachReceipts,
  getTradeReceipts,
  getWaiverReceipts,
  resolveChimmyAdviceOutcomes,
  type ReceiptsLeague,
} from './decisionReceipts'
import { buildDecisionRecord, type DecisionRecord } from './decisionRecordModel'

/**
 * The Career decision record's reads — this season's Chimmy and AutoCoach calls, and your own trades
 * and waiver adds, resolved by the Receipts card's own resolvers with the window widened from 45 days
 * to the season and the five-row cap lifted. Nothing new is stored and no rule is restated (see
 * `decisionRecordModel.ts`).
 *
 * The current week comes from `resolveCurrentWeek`, the home's own source, so a week still being
 * played is pending here exactly when it is pending on the Receipts card.
 *
 * THREE ANSWERS, AND THE SCREEN TREATS THEM DIFFERENTLY:
 *   a record   the record
 *   null       read fine, nothing resolved yet — the card says how to start one
 *   undefined  a read FAILED — no card at all. Half a record reads as "you rarely took advice", and
 *              the "start one" card would tell someone with a record that they have none; both are
 *              claims, not gaps.
 */
export async function getDecisionRecord(args: {
  userId: string
  leagues: readonly ReceiptsLeague[]
  /** The season the record covers — the user's newest. */
  season: number
  /** Your Sleeper user id — the only way to tell which side of a trade was yours. */
  ownerSleeperId?: string | null
}): Promise<(DecisionRecord & { season: number }) | null | undefined> {
  const platformIds = args.leagues.map((l) => l.platformLeagueId ?? '').filter(Boolean)
  const currentWeek = await resolveCurrentWeek(platformIds)
    .then((v) => v?.week ?? null)
    .catch(() => null)
  // August 1: early enough for any preseason advice, never last season's.
  const since = new Date(Date.UTC(args.season, 7, 1))

  const all = Number.POSITIVE_INFINITY
  const [chimmy, autocoach, trades, waivers] = await Promise.all([
    resolveChimmyAdviceOutcomes({ userId: args.userId, leagues: args.leagues, currentWeek, since }).catch(() => undefined),
    getAutoCoachReceipts({ userId: args.userId, leagues: args.leagues, currentWeek, since, limit: all }).catch(() => undefined),
    getTradeReceipts({ leagues: args.leagues, ownerSleeperId: args.ownerSleeperId ?? null, currentWeek, limit: all }).catch(
      () => undefined,
    ),
    getWaiverReceipts({ userId: args.userId, leagues: args.leagues, currentWeek, limit: all }).catch(() => undefined),
  ])
  // `undefined` = the read threw; `null` from the receipts = nothing to read (no table, no leagues).
  if (chimmy === undefined || autocoach === undefined || trades === undefined || waivers === undefined) return undefined

  const inSeason = <T extends { season: number }>(rows: readonly T[]) => rows.filter((r) => r.season === args.season)
  const record = buildDecisionRecord({
    chimmy: inSeason(chimmy?.startSits ?? []),
    autocoach: inSeason(autocoach?.autocoach ?? []),
    adds: inSeason(chimmy?.adds ?? []),
    // A trade's season is the grader's string ("2026"); the cache holds every season it graded.
    trades: trades
      ? { receipts: trades.trades.filter((t) => String(t.season) === String(args.season)), tooEarly: trades.tooEarly }
      : null,
    waivers: waivers
      ? { receipts: inSeason(waivers.waivers), tooEarly: waivers.tooEarly, unscored: waivers.unscored }
      : null,
  })
  return record ? { ...record, season: args.season } : null
}
