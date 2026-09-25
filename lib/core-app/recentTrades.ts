import 'server-only'

import { prisma } from '@/lib/prisma'
import type { TradeGradesPayload, GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import { getReconciledTradeGrades } from '@/lib/core-app/sleeperTradeHistory'
import { loadTradeExpectation } from '@/lib/trade-intel/tradeExpectationLoader'
import { hasNoSignal } from '@/lib/trade-intel/tradeGradeEmail'
import { attachPlayerMediaBatch, buildPlayerMedia, type ResolvedPlayerMedia } from '@/lib/player-media'
import { sleeperAvatarUrl } from '@/lib/sleeper-avatar'
import { oneGradeForCompletedTrade } from '@/lib/decision-os/trade/completedTradeGrade'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { scanPendingSleeperTrades } from '@/lib/provider-trades/scanPendingSleeperTrades'
import { publicTradeDecisionReceipt } from '@/lib/league-trade-engine/tradeDecisionReceipt'

/**
 * Trades that landed in your leagues recently.
 *
 * ⚠ THE DATA WAS NEVER MISSING. The /core home carries a coverage note saying
 * trades are not ingested, and the league home hard-codes its activity feed
 * unavailable "because league transactions are not ingested for this platform
 * yet". Both statements are false: `lib/trade-intel/sleeperTradeGradeService`
 * resolves BOTH sides of a Sleeper trade down to individual players and draft
 * picks, grades them, and caches the result. Two surfaces have been declining
 * to look, and one of them says so in words that are wrong.
 *
 * This reads that cache. One `in` query over the account's Sleeper league ids,
 * no provider call, no per-league fan-out, nothing recomputed.
 *
 * WHAT FILLS THAT CACHE, measured rather than assumed — an earlier version of this note asserted
 * under a 🛑 that nothing did, and that was FALSE. `/api/cron/trade-grade-notify` runs every fifteen minutes
 * (cron-schedule.json, and it is in the live fast-tier loop) and calls `detectAndNotifyAll(12, 8)`,
 * which reaches `getTradeGrades(id, { force: true })` through lib/trade-intel/tradeNotifyService
 * and force-upserts this exact row. Twelve leagues per fire by cursor — so every imported Sleeper
 * league is reached eventually — plus the eight most recently viewed, every fire. It diffs the
 * league's OWN transaction feed, so a trade between two other managers is what triggers it.
 *
 * ⚠ THE CENSUS THAT GOT THIS WRONG IS WORTH MORE THAN THE FACT. It was
 * `grep -rln getTradeGrades app/api/cron` → empty → "no scheduled caller". The cron reaches it one
 * module away, through `tradeNotifyService`. A grep scoped to a directory answers "does this
 * directory MENTION the symbol", never "does anything in it REACH the symbol" — the same failure
 * CLAUDE.md already records four times.
 *
 * ⚠ STILL TRUE, AND THE REASON THIS CACHE IS LOAD-BEARING: the live Sleeper top-up below cannot
 * supply a trade the viewer is not in. `scanPendingSleeperTrades` keeps only transactions whose
 * `roster_ids` include the viewer's, and `liveCompletedTrade` hard-codes one side as "You". So
 * every trade between two OTHER managers reaches this loader through the cache or not at all, and
 * this loader never builds it.
 *
 * ⚠ AND THE CRON REACHING A LEAGUE IS NOT ENOUGH TO WARM IT. `detectAndNotifyLeague` grades only
 * when the feed shows an id it has not seen, and its FIRST fire for a league takes the bootstrap
 * path — it records the seen-set and grades nothing. So a league whose trades all predate that
 * first fire never gets a row from this cron, and a trade landing between import and that fire
 * is marked seen without ever being built. A cold row stays cold until a trade the cron has not
 * seen lands in that league.
 *
 * ⚠ THE SWEEP'S OWN LETTER IS NOT USED, AND THAT IS THE POINT. It is a
 * RETROSPECTIVE grade scored on points already realised: days after a trade it
 * is measuring almost nothing, and a 2027 pick contributes exactly zero
 * because that draft has not happened. Publishing it here would be the "C
 * means we have no data" failure this codebase has already been bitten by.
 *
 * The deal verdict attached below is a different question, asked prospectively: was
 * this deal balanced ON THE DAY, by market value of what each side received?
 * That one CAN be answered now, it is the question a manager actually asks the
 * hour a trade lands, and the canonical engine prices a future pick properly
 * (a 2027 4th is 320 discounted for being a year out, not zero). It is
 * published only when every asset on both sides priced — see gradeOf. Each side
 * also carries its own market or realized letter and an explicit scope note;
 * incomplete contextual evidence never masquerades as a complete league grade.
 */

/** A trade older than this is history, not news. */
const RECENT_DAYS = 14
const CACHE_PREFIX = 'trade-grades:v2:'

export type RecentTradeAsset = {
  kind: 'player' | 'pick' | 'faab'
  playerId: string | null
  name: string
  position: string | null
  team: string | null
  headshotUrl: string | null
  teamLogoUrl: string | null
}

export type RecentTradeSide = {
  rosterId: number | string
  managerName: string
  teamName: string | null
  avatarUrl: string | null
  received: RecentTradeAsset[]
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | null
  gradeBasis: 'Market' | 'Realized' | null
  gradeReason: string
}

/**
 * A prospective verdict on the deal as struck — market value of what each side
 * received, picks included. NOT the retrospective letter the sweep computes
 * from realised points: see the grade note in the loader below.
 */
export type RecentTradeVerdict = {
  /** Legacy vocabulary: "Fair", "Slightly favors A", … */
  verdict: string
  /** 0–100. Stated beside the verdict, never on its own. */
  fairness: number | null
  /** 0–100 confidence the engine reports in its own inputs. */
  confidence: number
  /** Roster id the verdict favours, or null when it reads as fair. */
  favoursRosterId: number | null
}

export type RecentTrade = {
  id: string
  leagueId: string
  leagueName: string
  leagueAvatarUrl: string | null
  sport?: string
  platformLeagueId: string
  acceptedAt: string
  sides: RecentTradeSide[]
  /** True when a side's assets could not all be named — the card says so. */
  partial: boolean
  /**
   * Present only when every asset on both sides could be priced. Absent means
   * exactly that — never a neutral grade standing in for missing data.
   */
  verdict: RecentTradeVerdict | null
  /** Native lifecycle state. Provider history omits it because those rows are completed. */
  status?: string
}

export type RecentTradesLeague = {
  id: string
  name: string
  platformLeagueId: string | null
  platform?: string | null
  avatarUrl?: string | null
  sport?: string | null
}

export type RecentTradesLiveOptions = {
  /** App user viewing Core; required to keep private negotiations participant-only. */
  viewerUserId?: string | null
  ownerSleeperId?: string | null
  currentWeek?: number | null
  /** Reconcile the cache with the provider before presenting the latest trades. */
  reconcileLive?: boolean
  /** Add league-specific projected context when realized grading is not available. */
  enrichLeagueContext?: boolean
  /** Provider reads are bounded; the cache remains the source for the rest. */
  maxLeagues?: number
  /**
   * The same scan also finds offers WAITING ON YOU. They are not trades that
   * "landed", so this loader does not render them — but the Trades urgency badge
   * needs them, and a second provider read to learn what this one already knows
   * would be pure cost. Called once per completed pass with every league whose
   * scan actually answered; a league that did not answer is absent, never "0".
   */
  onPendingOffers?: (scanned: Array<{ leagueId: string; waiting: number }>) => void
  /**
   * 🛑 THIS READ RESOLVES WHILE MISSING TRADES, AND ALWAYS HAS. Every source below degrades
   * rather than throwing: the grade-cache query falls back to `[]`, each league's live scan
   * catches its own failure, and a scan that answered for only SOME of its weeks still
   * reports `scanned: true` (see `weeksUnanswered` on PendingTradeScan). So a caller that
   * watches only for a REJECTION cannot tell "nothing traded" from "we could not see most
   * of it".
   *
   * That difference decides whether /core closes the "since your last visit" window, and
   * closing it over trades this read never saw means they never appear in any brief. Called
   * once per OCCURRENCE — three unanswered leagues fire three times — before the returned
   * promise settles. `reason` is a closed vocabulary: never a league id, a provider id or an
   * error message.
   *
   * ⚠ NOR IS IT CALLED FOR ANYTHING PERMANENT, and that rule has three separate applications —
   * the `maxLeagues` cap, a non-Sleeper league, and a scan that came back `unscannedKind:
   * 'identity'` (no roster of yours in that league). A permanent bound reported as a transient
   * failure holds the caller's window open for the life of the league, with nothing able to
   * clear it. Their reasons are all DIFFERENT, and two earlier versions of this note got one or
   * another of them wrong:
   *   - `unscannedKind: 'identity'` costs nothing. The grade cache is read for that league anyway
   *     (`byPlatformId` is built before any filter) and `trade-grades:v2:*` is LEAGUE-scoped, not
   *     viewer-scoped. The live scan could never have added anything either: `completedTrades` is
   *     filtered by the viewer's roster id, and there is no roster id.
   *   - A non-Sleeper league has no trade source here AT ALL. The cache is keyed by Sleeper league
   *     id and written only by lib/trade-intel/sleeperTradeGradeService, so an ESPN or Yahoo
   *     league has no row and never will — it is not "covered by the cache".
   *   - 🛑 THE `maxLeagues` CAP *IS* A BLIND SPOT, AND THIS NOTE SAID OTHERWISE. It claimed "the
   *     exposure is only a trade newer than the 30-minute grade sweep" — the cadence is every fifteen minutes
   *     and the coverage is a cursor page plus the recently-viewed lane (see the module note), but
   *     the shape of the claim was right and only the number was wrong. What it got wrong is that
   *     the exposure is not bounded, it is LOST: a trade lands in capped league #12 at T−5min;
   *     this render does not live-scan it and the cache does not have it yet, so the caller's
   *     boundary closes at T; when the cache is next built, `tradesSince` filters on
   *     `acceptedAt > T` and T−5min never qualifies. The league list is sorted by name, so it is
   *     the same leagues every render.
   *
   *     ⚠ AND THE CAP IS NOT THE ONLY WAY IN. The same loss happens with no cap, on a healthy
   *     read, for a trade between two other managers that lands between the cron reaching that
   *     league and this render — because the live scan cannot see those trades at all. This
   *     callback's complete/incomplete shape cannot express it: a read can be "complete" and still
   *     be vouching for a cache built some minutes ago. What the boundary actually wants is the
   *     instant the read can stand behind, not a boolean. Recorded, not fixed here.
   * What all three share is being PERMANENT and deterministic. Reporting a permanent bound as a
   * transient failure would hold the trade boundary open for the life of the league.
   */
  onIncomplete?: (reason: 'grade-cache-unreadable' | 'league-scan-unanswered' | 'league-scan-partial-weeks') => void
}

/** Native proposals use the same AfLeagueTrade id carried by notifications and league cards. */
async function loadNativeRecentTrades(leagues: RecentTradesLeague[], cutoff: Date, viewerUserId?: string | null): Promise<RecentTrade[]> {
  const client = prisma as typeof prisma & {
    afLeagueTrade?: typeof prisma.afLeagueTrade
    tradeDecisionSnapshot?: typeof prisma.tradeDecisionSnapshot
    roster?: typeof prisma.roster
    appUser?: typeof prisma.appUser
    leagueTeam?: typeof prisma.leagueTeam
  }
  if (!client.afLeagueTrade || !client.roster || !client.appUser) return []
  const leagueById = new Map(leagues.map((league) => [league.id, league]))
  const rows = await client.afLeagueTrade.findMany({
    where: { leagueId: { in: [...leagueById.keys()] }, updatedAt: { gte: cutoff } },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: {
      id: true, leagueId: true, status: true, proposerRosterId: true, receiverRosterId: true,
      createdAt: true, updatedAt: true, acceptedAt: true, processedAt: true, rejectedAt: true, cancelledAt: true,
      items: { select: { id: true, itemType: true, itemReference: true, fromRosterId: true, toRosterId: true, faabAmount: true, metadata: true } },
    },
  }).catch(() => [])
  if (!rows.length) return []

  const rosterIds = [...new Set(rows.flatMap((row) => [
    row.proposerRosterId, row.receiverRosterId, ...row.items.flatMap((item) => [item.fromRosterId, item.toRosterId]),
  ]))]
  const rosters = await client.roster.findMany({ where: { id: { in: rosterIds } }, select: { id: true, platformUserId: true } }).catch(() => [])
  const identityIds = [...new Set(rosters.map((row) => row.platformUserId))]
  const [users, teams, snapshots] = await Promise.all([
    client.appUser.findMany({ where: { id: { in: identityIds } }, select: { id: true, displayName: true, username: true, avatarUrl: true } }).catch(() => []),
    client.leagueTeam
      ? client.leagueTeam.findMany({
          where: { leagueId: { in: [...leagueById.keys()] }, OR: [
            { externalId: { in: rosterIds } }, { platformUserId: { in: identityIds } }, { claimedByUserId: { in: identityIds } },
          ] },
          select: { leagueId: true, externalId: true, platformUserId: true, claimedByUserId: true, ownerName: true, teamName: true, avatarUrl: true },
        }).catch(() => [])
      : Promise.resolve([]),
    client.tradeDecisionSnapshot
      ? client.tradeDecisionSnapshot.findMany({ where: { tradeId: { in: rows.map((row) => row.id) } } }).catch(() => [])
      : Promise.resolve([]),
  ])
  const rosterById = new Map(rosters.map((row) => [row.id, row]))
  const userById = new Map(users.map((row) => [row.id, row]))
  const teamByIdentity = new Map<string, (typeof teams)[number]>()
  for (const team of teams) {
    teamByIdentity.set(`${team.leagueId}:${team.externalId}`, team)
    if (team.platformUserId) teamByIdentity.set(`${team.leagueId}:${team.platformUserId}`, team)
    if (team.claimedByUserId) teamByIdentity.set(`${team.leagueId}:${team.claimedByUserId}`, team)
  }
  const receiptByTradeId = new Map(snapshots.map((row) => [row.tradeId, publicTradeDecisionReceipt(row)]))

  const asset = (item: (typeof rows)[number]['items'][number], sport: string): RecentTradeAsset => {
    const meta = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
      ? item.metadata as Record<string, unknown> : {}
    const type = item.itemType.toLowerCase()
    const player = type.includes('player') || type === 'keeper' || type === 'devy'
    const faab = type === 'faab'
    const playerId = player ? item.itemReference : null
    const team = typeof meta.team === 'string' && meta.team.trim() ? meta.team.trim().toUpperCase() : null
    const media = player ? buildPlayerMedia(playerId, team, sport) : { headshotUrl: null, teamLogoUrl: null }
    return {
      kind: faab ? 'faab' : player ? 'player' : 'pick',
      playerId,
      name: faab ? `${item.faabAmount ?? 0} FAAB` : String(meta.playerName ?? meta.pickLabel ?? meta.label ?? item.itemReference ?? 'Asset'),
      position: typeof meta.position === 'string' ? meta.position : null,
      team,
      headshotUrl: typeof meta.headshotUrl === 'string' && meta.headshotUrl.trim() ? meta.headshotUrl : media.headshotUrl,
      teamLogoUrl: media.teamLogoUrl,
    }
  }

  return rows.flatMap((row) => {
    const league = leagueById.get(row.leagueId)
    if (!league) return []
    const participants = [...new Set([row.proposerRosterId, row.receiverRosterId, ...row.items.flatMap((item) => [item.fromRosterId, item.toRosterId])])]
    const publicLeagueFact = row.status === 'processed' || row.status === 'reversed'
    const viewerParticipates = viewerUserId != null && participants.some((rosterId) => {
      const identity = rosterById.get(rosterId)?.platformUserId ?? ''
      const team = teamByIdentity.get(`${row.leagueId}:${rosterId}`) ?? teamByIdentity.get(`${row.leagueId}:${identity}`)
      return identity === viewerUserId || team?.claimedByUserId === viewerUserId
    })
    if (!publicLeagueFact && !viewerParticipates) return []
    const receipt = receiptByTradeId.get(row.id) ?? null
    const sides = participants.map((rosterId): RecentTradeSide => {
      const identity = rosterById.get(rosterId)?.platformUserId ?? ''
      const user = userById.get(identity)
      const team = teamByIdentity.get(`${row.leagueId}:${rosterId}`) ?? teamByIdentity.get(`${row.leagueId}:${identity}`)
      const decision = receipt?.participantDecisions.find((entry) => entry.rosterId === rosterId) ?? null
      return {
        rosterId,
        managerName: user?.displayName?.trim() || user?.username || team?.ownerName || 'Manager',
        teamName: team?.teamName || null,
        avatarUrl: team?.avatarUrl ?? user?.avatarUrl ?? null,
        received: row.items.filter((item) => item.toRosterId === rosterId).map((item) => asset(item, league.sport ?? 'nfl')),
        grade: decision?.grade && ['A', 'B', 'C', 'D', 'F'].includes(decision.grade) ? decision.grade as RecentTradeSide['grade'] : null,
        gradeBasis: decision?.grade ? 'Market' : null,
        gradeReason: decision?.reason ?? 'Original grade unavailable — this trade predates complete decision evidence.',
      }
    })
    return [{
      id: row.id,
      leagueId: row.leagueId,
      leagueName: league.name,
      leagueAvatarUrl: league.avatarUrl ?? null,
      sport: league.sport ?? 'nfl',
      platformLeagueId: `native:${row.leagueId}`,
      acceptedAt: (row.processedAt ?? row.acceptedAt ?? row.rejectedAt ?? row.cancelledAt ?? row.updatedAt ?? row.createdAt).toISOString(),
      sides,
      partial: sides.some((side) => side.received.length === 0),
      verdict: null,
      status: row.status,
    }]
  })
}

/**
 * Report a gap in what this read could see. A throwing listener must never cost the trades
 * this loader exists to return — same rule as `onPendingOffers`, and the same reason.
 */
function reportIncomplete(
  live: RecentTradesLiveOptions | undefined,
  reason: Parameters<NonNullable<RecentTradesLiveOptions['onIncomplete']>>[0],
): void {
  try {
    live?.onIncomplete?.(reason)
  } catch {
    // A listener's failure is not this read's failure.
  }
}

function liveCompletedTrade(
  league: RecentTradesLeague,
  trade: NonNullable<Awaited<ReturnType<typeof scanPendingSleeperTrades>>['completedTrades']>[number],
): RecentTrade | null {
  if (!league.platformLeagueId || !trade.proposedAt) return null
  const viewerRosterId = Number(trade.viewerRosterExternalId)
  const otherRosterId = Number(trade.counterpartyRosterExternalId)
  const toAsset = (asset: (typeof trade.assetsReceived)[number]): RecentTradeAsset => ({
    kind: asset.isPick ? 'pick' : 'player',
    playerId: asset.isPick ? null : asset.playerId ?? null,
    name: asset.isPick ? (asset.pickRound ?? asset.playerName) : asset.playerName,
    position: asset.isPick ? null : asset.position || null,
    team: null,
    headshotUrl: null,
    teamLogoUrl: null,
  })
  const sides: RecentTradeSide[] = [
    {
      rosterId: Number.isFinite(viewerRosterId) ? viewerRosterId : 0,
      managerName: 'You',
      teamName: null,
      avatarUrl: null,
      received: trade.assetsReceived.map(toAsset),
      grade: null,
      gradeBasis: null,
      gradeReason: 'League-specific grade is still being prepared.',
    },
    {
      rosterId: Number.isFinite(otherRosterId) ? otherRosterId : -1,
      managerName: trade.proposedBy || 'Another team',
      teamName: null,
      avatarUrl: null,
      received: trade.assetsGiven.map(toAsset),
      grade: null,
      gradeBasis: null,
      gradeReason: 'League-specific grade is still being prepared.',
    },
  ]
  return {
    id: trade.transactionId,
    leagueId: league.id,
    leagueName: league.name,
    leagueAvatarUrl: league.avatarUrl ?? null,
    platformLeagueId: league.platformLeagueId,
    acceptedAt: trade.proposedAt,
    sides,
    partial: sides.some((side) => side.received.length === 0),
    verdict: null,
  }
}

function assetsOf(side: GradedTrade['sides'][number]): RecentTradeAsset[] {
  const players: RecentTradeAsset[] = side.playersIn.map((p) => ({
    kind: 'player' as const,
    playerId: p.playerId,
    name: p.name,
    position: p.position,
    team: null,
    headshotUrl: null,
    teamLogoUrl: null,
  }))
  /*
   * A pick is named by its own label ("2027 4th"), never by whoever it later
   * became — the trade was made for the pick, and resolving it to a player
   * would rewrite what the two managers actually agreed.
   */
  const picks: RecentTradeAsset[] = side.picksIn.map((p) => ({
    kind: 'pick' as const,
    playerId: null,
    name: p.label,
    position: null,
    team: null,
    headshotUrl: null,
    teamLogoUrl: null,
  }))
  return [...players, ...picks]
}

/**
 * The verdict sentence for a two-sided trade, read off THE grade, or null.
 *
 * 🛑 IT WAS A SECOND GRADE (until 2026-09-25): `buildLegacyCanonicalGrade` over prices read from
 * `PlayerValueSnapshot` with no format or QB filter — the newest FantasyCalc row per player, dynasty
 * or redraft, 1QB or superflex, whichever was written last — so the band's sentence could disagree
 * with the letter printed on the same card. Now the sentence and the letters come from one grade:
 * `oneGradeForCompletedTrade`, on this league's own chart, today.
 *
 * ⚠ NULL WHEN THERE IS NO GRADE — a withheld grade (an unpriced player, a used pick, a three-team
 * deal) publishes no verdict, never a neutral one standing in for missing data.
 */
function gradeOf(trade: GradedTrade, grade: TradeGradeView | null): RecentTradeVerdict | null {
  const sides = trade.sides ?? []
  if (sides.length !== 2 || trade.multiTeam || !grade || !grade.graded) return null
  const [a, b] = sides
  const strong = grade.letter === 'A' || grade.letter === 'F'
  const favours = grade.letter === 'C' ? null : grade.percentDiff > 0 ? a.rosterId : b.rosterId
  return {
    verdict: favours == null ? 'Fair' : `${strong ? 'Strongly' : 'Slightly'} favors ${favours === a.rosterId ? 'A' : 'B'}`,
    // The one grade carries no separate fairness or confidence number; the card states neither.
    fairness: null,
    confidence: 0,
    favoursRosterId: favours,
  }
}

export async function getRecentTrades(
  leagues: RecentTradesLeague[],
  now: Date = new Date(),
  limit = 3,
  live?: RecentTradesLiveOptions,
): Promise<RecentTrade[]> {
  const byPlatformId = new Map<string, RecentTradesLeague>()
  for (const l of leagues) {
    if (l.platformLeagueId) byPlatformId.set(l.platformLeagueId, l)
  }
  const cutoff = now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000
  const nativeRecent = await loadNativeRecentTrades(leagues, new Date(cutoff), live?.viewerUserId)

  const keys = [...byPlatformId.keys()].map((id) => `${CACHE_PREFIX}${id}`)
  /*
   * ⚠ THIS FALLBACK IS THE READ'S LARGEST BLIND SPOT, NOT A CORNER CASE — it is the PRIMARY
   * source, and the live scan below only tops it up for Sleeper. Failing to `[]` keeps the
   * card up, which is right; letting the caller believe that `[]` meant "nothing traded" is
   * not. A pool timeout here is exactly how /core would close the visit window over every
   * graded trade it holds, so the failure is reported rather than swallowed.
   */
  let rows = keys.length > 0
    ? await prisma.sportsDataCache
      .findMany({ where: { cacheKey: { in: keys } }, select: { cacheKey: true, data: true } })
      .catch(() => {
        reportIncomplete(live, 'grade-cache-unreadable')
        return [] as { cacheKey: string; data: unknown }[]
      })
    : []

  if (live?.reconcileLive) {
    const liveRows: { cacheKey: string; data: unknown }[] = []
    const ids = [...byPlatformId.keys()]
    for (let i = 0; i < ids.length; i += 4) {
      const chunk = ids.slice(i, i + 4)
      const settled = await Promise.all(chunk.map(async (id) => ({
        id,
        result: await getReconciledTradeGrades(id).catch(() => null),
      })))
      for (const item of settled) {
        if (item.result?.grades) liveRows.push({ cacheKey: `${CACHE_PREFIX}${item.id}`, data: item.result.grades })
      }
    }
    if (liveRows.length > 0) {
      const liveKeys = new Set(liveRows.map((r) => r.cacheKey))
      rows = [...liveRows, ...rows.filter((r) => !liveKeys.has(r.cacheKey))]
    }
  }

  const out: RecentTrade[] = [...nativeRecent]
  /** The raw graded rows, kept so only the visible ones get priced. */
  const graded = new Map<string, GradedTrade>()

  for (const row of rows) {
    const payload =
      row.data && typeof row.data === 'object' && !Array.isArray(row.data)
        ? (row.data as unknown as TradeGradesPayload)
        : null
    if (!payload || payload.version !== 2) continue

    const platformLeagueId = row.cacheKey.slice(CACHE_PREFIX.length)
    const league = byPlatformId.get(platformLeagueId)
    if (!league) continue

    for (const trade of payload.trades ?? []) {
      const at = new Date(trade.createdIso).getTime()
      if (!Number.isFinite(at) || at < cutoff) continue

      const sides: RecentTradeSide[] = (trade.sides ?? []).map((s) => ({
        rosterId: s.rosterId,
        managerName: s.managerName,
        teamName: s.teamName,
        avatarUrl: sleeperAvatarUrl(s.avatar),
        received: assetsOf(s),
        grade: null,
        gradeBasis: null,
        gradeReason: 'Grade context is being checked.',
      }))
      /*
       * A side that received nothing we can name is not renderable as a swap —
       * saying so beats drawing an arrow into an empty column.
       */
      const partial = sides.some((s) => s.received.length === 0)
      if (sides.length < 2) continue

      out.push({
        id: trade.id,
        leagueId: league.id,
        leagueName: league.name,
        leagueAvatarUrl: league.avatarUrl ?? null,
        platformLeagueId,
        acceptedAt: new Date(at).toISOString(),
        sides,
        partial,
        /* Filled below, once every traded player has been priced in one read. */
        verdict: null,
      })
      graded.set(`${platformLeagueId}:${trade.id}`, trade)
    }
  }

  /*
   * The durable grade cache is filled by the background pipeline. For leagues
   * the manager is actively using, also read the current and adjacent Sleeper
   * transaction weeks. Three weeks per league finds a just-accepted trade in
   * minutes without repeating the old 18-weeks × every-league request fan-out.
   * SleeperCacheLayer persists each transaction response for five minutes, so
   * this remains DB-first on repeated dashboard loads.
   */
  if (live?.ownerSleeperId) {
    const week = Math.min(18, Math.max(1, live.currentWeek ?? 1))
    const weeks = [...new Set([week - 1, week, week + 1].filter((value) => value >= 1 && value <= 18))]
    const liveLeagues = leagues
      .filter((league) => String(league.platform ?? '').toLowerCase() === 'sleeper' && league.platformLeagueId)
      .slice(0, live.maxLeagues ?? 8)
    const scans: Array<Awaited<ReturnType<typeof scanPendingSleeperTrades>> | null> = new Array(liveLeagues.length).fill(null)
    const concurrency = 4
    for (let start = 0; start < liveLeagues.length; start += concurrency) {
      await Promise.all(liveLeagues.slice(start, start + concurrency).map(async (league, offset) => {
        scans[start + offset] = await scanPendingSleeperTrades({
          platformLeagueId: league.platformLeagueId!,
          ownerSleeperId: live.ownerSleeperId!,
          sport: 'NFL',
          weeks,
        }).catch(() => null)
      }))
    }
    /*
     * What this pass could NOT see, reported before anything is returned. `scanned` alone hides
     * all of it: a league whose scan threw is `null`, one Sleeper refused is `scanned: false`, and
     * one that answered for a single week of three is `scanned: TRUE` with `weeksUnanswered > 0` —
     * its own docblock says "nothing waiting" is weaker than it looks there.
     *
     * ⚠ `scanned: false` is NOT uniformly reportable, though; see the split below.
     */
    for (const scan of scans) {
      if (!scan?.scanned) {
        /*
         * 🛑 ONLY A PROVIDER FAILURE IS WORTH REPORTING. `scanned: false` also covers "this
         * account owns no roster in this league", "we do not know which Sleeper account is
         * yours", and "the league no longer exists on Sleeper" (a 404/410 on the rosters read)
         * — `unscannedKind: 'identity'`, and all three are permanent: same input, same answer,
         * every render for the life of the league. Reporting one as a transient failure holds
         * /core's trade window open forever, which is the rule this file states two hunks up and
         * the reason the `maxLeagues` cap is not reported either.
         *
         * A `null` scan is the loader's own `.catch` on the provider call, so it is `provider`.
         */
        if (scan?.unscannedKind !== 'identity') reportIncomplete(live, 'league-scan-unanswered')
      } else if (scan.weeksUnanswered > 0) reportIncomplete(live, 'league-scan-partial-weeks')
    }
    if (live.onPendingOffers) {
      /*
       * Only leagues whose scan ANSWERED are reported. A scan that failed tells us
       * nothing, and reporting it as zero would clear a badge for an offer that may
       * still be waiting.
       */
      const scanned: Array<{ leagueId: string; waiting: number }> = []
      for (let i = 0; i < liveLeagues.length; i += 1) {
        const scan = scans[i]
        if (!scan?.scanned) continue
        scanned.push({
          leagueId: liveLeagues[i]!.id,
          waiting: scan.trades.filter((t) => !t.proposedByViewer && t.lifecycleStatus !== 'complete').length,
        })
      }
      try {
        live.onPendingOffers(scanned)
      } catch {
        // Recording a badge must never cost the trades this loader exists to return.
      }
    }
    /*
     * 🛑 KEYED ON THE TRANSACTION, NOT ON EACH SOURCE'S OWN ID (2026-09-25). A trade from the
     * graded cache is id'd `<seasonLeagueId>:<transactionId>`; the same trade read live is id'd
     * `<transactionId>`. Keying on the raw id, the two never matched, so a just-accepted trade
     * showed TWICE in the band — once graded, once "still being prepared" — for as long as both
     * sources had it. `leagueHome.ts` already matches on the transaction id; this now does too.
     */
    const txOf = (id: string) => id.slice(id.lastIndexOf(':') + 1)
    const seen = new Set(out.map((trade) => `${trade.platformLeagueId}:${txOf(trade.id)}`))
    for (let i = 0; i < liveLeagues.length; i += 1) {
      for (const trade of scans[i]?.completedTrades ?? []) {
        const converted = liveCompletedTrade(liveLeagues[i], trade)
        if (!converted) continue
        if (new Date(converted.acceptedAt).getTime() < cutoff) continue
        const key = `${converted.platformLeagueId}:${txOf(converted.id)}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(converted)
      }
    }
  }

  out.sort((a, b) => new Date(b.acceptedAt).getTime() - new Date(a.acceptedAt).getTime())
  const visible = out.slice(0, limit)

  /*
   * ⚠ ONE READ, FOR THE VISIBLE TRADES ONLY. Prices are looked up by the
   * Sleeper player id the trade assets already carry — the indexed column —
   * rather than by name, which has no index and would collide across the two
   * athletes this repo already refuses to confuse. Only the trades that will
   * actually render are priced: grading rows nobody sees is pure cost.
   */
  const playerIds = new Set<string>()
  for (const t of visible) {
    const src = graded.get(`${t.platformLeagueId}:${t.id}`)
    for (const side of src?.sides ?? []) {
      for (const p of side.playersIn) if (p.playerId) playerIds.add(p.playerId)
    }
  }

  const currentSeason = now.getUTCFullYear()
  let mediaByPlayerId = new Map<string, ResolvedPlayerMedia>()
  if (playerIds.size > 0) {
    mediaByPlayerId = await attachPlayerMediaBatch(
      [...playerIds].map((playerId) => ({ playerId, sport: 'nfl' })),
    ).catch(() => new Map<string, ResolvedPlayerMedia>())
  }
  for (const t of visible) {
    const src = graded.get(`${t.platformLeagueId}:${t.id}`)
    if (!src) continue
    t.verdict = gradeOf(src, await oneGradeForCompletedTrade(t.leagueId, src, currentSeason).catch(() => null))
    for (const side of t.sides) {
      for (const asset of side.received) {
        if (!asset.playerId) continue
        const media = mediaByPlayerId.get(asset.playerId)
        asset.team = media?.teamAbbr ?? null
        asset.headshotUrl = media?.media.headshotUrl ?? null
        asset.teamLogoUrl = media?.media.teamLogoUrl ?? null
      }
    }

    if (live?.enrichLeagueContext && hasNoSignal(src)) {
      const expectation = await loadTradeExpectation(t.platformLeagueId, src, { afLeagueId: t.leagueId }).catch(() => null)
      for (const side of t.sides) {
        const exp = expectation?.sides.find((s) => s.rosterId === side.rosterId)
        side.grade = exp?.projected?.letter ?? null
        side.gradeBasis = exp?.projected ? 'Market' : null
        const edge = exp?.projected ? Math.round(exp.projected.valueEdge * 100) : null
        const needs = exp?.starterGaps == null
          ? 'Roster needs unavailable.'
          : exp.starterGaps.length === 0
            ? 'No required starter gaps detected.'
            : `Starter gaps: ${exp.starterGaps.map((g) => `${g.position} ${g.rostered}/${g.required}`).join(', ')}.`
        side.gradeReason = expectation?.evaluation.withheldReason
          ?? (edge == null
            ? `No complete market grade is available for ${expectation?.leagueNote ?? 'this league'}.`
            : `${edge >= 0 ? '+' : ''}${edge}% market-value edge in ${expectation?.leagueNote}. ${needs} Full context remains withheld until playoff probability and every required league input are available.`)
      }
    } else {
      const srcByRoster = new Map(src.sides.map((s) => [String(s.rosterId), s]))
      for (const side of t.sides) {
        const realized = srcByRoster.get(String(side.rosterId))
        const hasRealizedGrade = Boolean(realized?.currentGrade && typeof realized.cumulativeNet === 'number')
        side.grade = hasRealizedGrade ? realized!.currentGrade : null
        side.gradeBasis = hasRealizedGrade ? 'Realized' : null
        side.gradeReason = hasRealizedGrade
          ? `Net ${realized!.cumulativeNet.toFixed(1)} fantasy points under this league's scoring while the assets were held.`
          : 'No grade is available for this side.'
      }
    }
  }

  return visible
}
