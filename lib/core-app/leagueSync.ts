import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName, type SectionState } from './leagueHome'

/**
 * League Sync — is THIS league fresh, and what exactly did we read (38a·10).
 *
 * ⚠ THE ACCOUNT-WIDE `/leagues/sync` PAGE IS RETIRED. It was a second import
 * pipeline on the older `/api/league/*` endpoints, skipping the commissioner
 * gate, the attestation step and the team claim; adding a league is /import's
 * job and Yahoo OAuth starts there.
 *
 * This screen is what remains of sync, and it answers a narrower question than
 * that page did: "is THIS league current", which is what you want to know when
 * you are standing inside one. It does not re-sync — `/api/league/sync` still
 * exists and no UI calls it.
 *
 * ── Two honesty rules the schema itself states ───────────────────────────
 *
 * 1. `lastSuccessfulSyncAt` is described in the schema as "AllFantasy's
 *    successful-collection time … AF execution time, NOT a provider-reported
 *    timestamp". So this screen says "we last read this league N ago" and never
 *    "this data is N old" — those are different claims and only the first one
 *    is supported.
 * 2. `sourceDataTimestamp` is RESERVED and deliberately null: Sleeper exposes no
 *    dependable per-league data mtime. Nothing here may populate or infer it.
 *
 * ── The green-when-dead trap ─────────────────────────────────────────────
 *
 * A `SyncJobRun` row stuck in `running` used to make a dead job report amber
 * forever, and healthy for the first two hours after each fire regardless of how
 * old the last success was. `reapAbandonedRuns` now closes rows older than 30
 * minutes — but it only fires when that same job runs AGAIN, so a job that has
 * stopped firing entirely keeps its orphan. The diagnostic tell is checked here
 * directly: `rowsRead === 0 && rowsWritten === 0 && completedAt == null` are the
 * `startRun` defaults, never a measurement, and they prove the row was never
 * updated — which is "killed mid-body", not "ran and found nothing".
 */

export type SyncDataRow = {
  key: 'rosters' | 'transactions' | 'scores' | 'standings' | 'chat'
  label: string
  /** What this row covers, in the user's terms. */
  note: string
  state:
    | { kind: 'fresh'; detail: string }
    | { kind: 'live'; detail: string }
    | { kind: 'stale'; detail: string }
    | { kind: 'never'; detail: string }
    /** Not a failure — a deliberate product decision, and it says so. */
    | { kind: 'by-design'; detail: string }
}

export type LeagueSyncData = {
  league: { id: string; name: string; platform: string }
  /** When this league was first connected to AllFantasy. */
  connectedSince: Date | null
  /** Distinct seasons of history on file. Withheld rather than guessed at 1. */
  seasonsOnFile: SectionState<number>
  /**
   * Overall state. `attention` covers stale auth and repeated failures — the
   * two cases where the user can actually do something.
   */
  status: 'ok' | 'attention' | 'never'
  /** AF's own last successful collection. Never presented as data freshness. */
  lastReadAt: Date | null
  lastAttemptedAt: Date | null
  consecutiveFailures: number
  lastError: string | null
  rows: SyncDataRow[]
  /**
   * True when the freshness above comes from `League.lastSyncedAt` because no
   * `LeagueSyncState` row exists — a coarser signal, and the screen says so
   * rather than presenting it as the same thing.
   */
  coarse: boolean
  /**
   * Set when the most recent telemetry row shows the killed-mid-body signature.
   * Rendered as a warning even if everything else looks fine, because
   * everything else looking fine is exactly the failure mode.
   */
  orphanedRun: { startedAt: Date; jobName: string } | null
}

export type LeagueSyncResult =
  | ({ available: true } & LeagueSyncData)
  | { available: false; leagueName: string; reason: string }

/** Older than this and a league is stale enough to say so. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000

function describeAge(from: Date | null, now: Date): string {
  if (!from) return 'never'
  const mins = Math.floor((now.getTime() - from.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export async function getLeagueSync(
  leagueId: string,
  userId: string,
  now: Date = new Date(),
): Promise<LeagueSyncResult> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      name: true,
      platform: true,
      platformLeagueId: true,
      season: true,
      createdAt: true,
      lastSyncedAt: true,
      syncStatus: true,
    },
  })

  const leagueName = leagueDisplayName(league?.name)
  if (!league) {
    return { available: false, leagueName, reason: 'this league could not be read' }
  }

  /*
   * ⚠ MEMBERSHIP GATE. Sync exposes a league's collection history and error
   * text; it is not sensitive in the way the commissioner surface is, but it is
   * still a league's internals and there is no reason a non-member sees it.
   */
  const member = await prisma.leagueTeam
    .findFirst({ where: { leagueId, claimedByUserId: userId }, select: { id: true } })
    .catch(() => null)
  const roster = member
    ? null
    : await prisma.roster
        .findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } })
        .catch(() => null)

  if (!member && !roster) {
    return {
      available: false,
      leagueName,
      reason: 'you are not a member of this league, so its sync history is not shown',
    }
  }

  const runKey =
    league.platformLeagueId && league.season != null
      ? `${String(league.platform ?? '').toLowerCase()}:${league.platformLeagueId}:${league.season}`
      : null

  const [syncState, rosterLatest, matchupLatest, seasonCount, lastRun] = await Promise.all([
    runKey
      ? prisma.leagueSyncState.findUnique({ where: { runKey } }).catch(() => null)
      : Promise.resolve(null),
    prisma.roster
      .findFirst({ where: { leagueId }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } })
      .catch(() => null),
    league.platformLeagueId
      ? prisma.weeklyMatchup
          .findFirst({
            where: { leagueId: league.platformLeagueId },
            orderBy: { updatedAt: 'desc' },
            select: { updatedAt: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
    prisma.matchupFact
      .findMany({ where: { leagueId }, select: { season: true }, distinct: ['season'] })
      .catch(() => []),
    /*
     * The newest telemetry row for this league's collector. Read purely to
     * detect the orphan signature — the run's own status is not trusted for
     * freshness, because that is the number the stuck row lies about.
     */
    prisma.syncJobRun
      .findFirst({
        where: { jobScope: leagueId },
        orderBy: { startedAt: 'desc' },
        select: {
          jobName: true,
          status: true,
          rowsRead: true,
          rowsWritten: true,
          completedAt: true,
          startedAt: true,
        },
      })
      .catch(() => null),
  ])

  const coarse = syncState == null
  const lastReadAt = syncState?.lastSuccessfulSyncAt ?? league.lastSyncedAt ?? null
  const lastAttemptedAt = syncState?.lastAttemptedSyncAt ?? league.lastSyncedAt ?? null
  const consecutiveFailures = syncState?.consecutiveFailures ?? 0

  const orphanedRun =
    lastRun &&
    lastRun.status === 'running' &&
    lastRun.completedAt == null &&
    lastRun.rowsRead === 0 &&
    lastRun.rowsWritten === 0
      ? { startedAt: lastRun.startedAt, jobName: lastRun.jobName }
      : null

  const ageMs = lastReadAt ? now.getTime() - lastReadAt.getTime() : null
  const isStale = ageMs != null && ageMs > STALE_AFTER_MS

  const status: LeagueSyncData['status'] =
    lastReadAt == null
      ? 'never'
      : consecutiveFailures > 0 || isStale || orphanedRun != null
        ? 'attention'
        : 'ok'

  const completedScopes = new Set(
    Array.isArray(syncState?.completedScopes) ? (syncState.completedScopes as string[]) : [],
  )
  const incompleteScopes = new Set(
    Array.isArray(syncState?.incompleteScopes) ? (syncState.incompleteScopes as string[]) : [],
  )

  /*
   * Per-row state. Each one prefers its OWN table's timestamp over the league's
   * overall sync time — "rosters last changed 2m ago" is a fact about rosters,
   * where the league-level figure is a fact about the collector.
   */
  const rowState = (
    scope: string | null,
    ownTimestamp: Date | null,
  ): SyncDataRow['state'] => {
    if (scope && incompleteScopes.has(scope)) {
      return { kind: 'stale', detail: 'did not complete on the last run' }
    }
    if (ownTimestamp) {
      const age = now.getTime() - ownTimestamp.getTime()
      return age > STALE_AFTER_MS
        ? { kind: 'stale', detail: `last changed ${describeAge(ownTimestamp, now)}` }
        : { kind: 'fresh', detail: `updated ${describeAge(ownTimestamp, now)}` }
    }
    if (scope && completedScopes.has(scope)) {
      return { kind: 'fresh', detail: 'collected on the last run' }
    }
    return { kind: 'never', detail: 'nothing on file' }
  }

  const rows: SyncDataRow[] = [
    {
      key: 'rosters',
      label: 'Rosters',
      note: 'Every roster, bench and IR or taxi slot',
      state: rowState('rosters', rosterLatest?.updatedAt ?? null),
    },
    {
      key: 'transactions',
      label: 'Transactions',
      note: 'Trades, waiver claims and free-agent moves',
      state: rowState('recent_transactions', null),
    },
    {
      key: 'scores',
      label: 'Scores and matchups',
      note: 'Weekly results, and every play while games are live',
      state: matchupLatest
        ? { kind: 'live', detail: `updated ${describeAge(matchupLatest.updatedAt, now)}` }
        : { kind: 'never', detail: 'no weekly results on file' },
    },
    {
      key: 'standings',
      label: 'Standings',
      note: 'Recalculated from results after each week finalises',
      state: rowState('league_state', matchupLatest?.updatedAt ?? null),
    },
    {
      /*
       * ⚠ NOT A GAP AND NOT A FAILURE. League chat is never read, synced or
       * stored, and saying so on the screen that inventories what we DO collect
       * is the strongest place to say it. The Notifications tab depends on this
       * being true — its Mentions filter is hidden for exactly this reason.
       */
      key: 'chat',
      label: 'League chat',
      note: 'Never read, synced or stored',
      state: { kind: 'by-design', detail: 'not synced, by design' },
    },
  ]

  return {
    available: true,
    league: {
      id: league.id,
      name: leagueName,
      platform: String(league.platform ?? 'manual').toLowerCase(),
    },
    connectedSince: league.createdAt ?? null,
    seasonsOnFile:
      seasonCount.length > 0
        ? { available: true, data: seasonCount.filter((s) => s.season != null).length }
        : {
            available: false,
            reason: 'no multi-season history has been backfilled for this league',
          },
    status,
    lastReadAt,
    lastAttemptedAt,
    consecutiveFailures,
    lastError: syncState?.lastError ?? null,
    rows,
    coarse,
    orphanedRun,
  }
}
