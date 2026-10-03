import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  buildPlatformHealth,
  buildWireLeagues,
  decorateChanges,
  latestSeasonOnly,
  runKeyFor,
  type CareerWireData,
  type WireLeagueInput,
  type WireSyncState,
} from './careerWireModel'
import {
  diffStandings,
  nextVisitMarker,
  resolveVisitWindow,
  snapshotStandings,
  type VisitMarker,
  type VisitSnapshot,
} from './sinceLastVisit'

/**
 * Career Wire — the I/O half. Three bounded reads, all Postgres, no provider:
 *
 *   1. `LeagueSyncState` for both lanes of every synced league (one `findMany`).
 *   2. Your claimed team's record and rank per league (`snapshotStandings`, the home brief's read).
 *   3. The Career visit marker in `SportsDataCache`.
 *
 * ⚠ ITS OWN VISIT MARKER, NOT THE HOME'S. `core-visit:v1:` is the Core home's "since your last
 * visit"; sharing it would make a Career visit erase the home's window (and the reverse), so each
 * screen would only ever show changes the other one had not already "seen". The window and diff
 * logic are the home's own functions — only the key differs. The marker's injury snapshot is left
 * empty: the Wire does not report injuries, and the home already does.
 */

export const CAREER_VISIT_KEY_PREFIX = 'core-career-visit:v1:'
const MARKER_TTL_MS = 60 * 24 * 60 * 60_000

function isMarker(value: unknown): value is VisitMarker {
  const v = value as Partial<VisitMarker> | null
  return Boolean(v && v.version === 1 && typeof v.lastSeenAt === 'string' && typeof v.sinceAt === 'string')
}

async function readMarker(userId: string): Promise<VisitMarker | null> {
  const row = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: `${CAREER_VISIT_KEY_PREFIX}${userId}` }, select: { data: true } })
    .catch(() => null)
  return isMarker(row?.data) ? (row!.data as unknown as VisitMarker) : null
}

async function writeMarker(userId: string, marker: VisitMarker, now: Date): Promise<void> {
  const data = marker as unknown as object
  const expiresAt = new Date(now.getTime() + MARKER_TTL_MS)
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey: `${CAREER_VISIT_KEY_PREFIX}${userId}` },
      update: { data, expiresAt },
      create: { cacheKey: `${CAREER_VISIT_KEY_PREFIX}${userId}`, data, expiresAt },
    })
    .catch(() => undefined)
}

async function readSyncStates(leagues: WireLeagueInput[]): Promise<Map<string, WireSyncState>> {
  const keys = leagues.flatMap((l) => {
    const k = runKeyFor(l)
    return k ? [k, `${k}:active`] : []
  })
  if (keys.length === 0) return new Map()
  const rows = await prisma.leagueSyncState
    .findMany({
      where: { runKey: { in: keys } },
      select: {
        runKey: true,
        lastSuccessfulSyncAt: true,
        lastAttemptedSyncAt: true,
        consecutiveFailures: true,
        syncStatus: true,
        lastError: true,
        seasonState: true,
      },
    })
    .catch(() => [] as WireSyncState[])
  return new Map(rows.map((r) => [r.runKey, r]))
}

/**
 * ⚠ THE LIST'S `season` IS A DISPLAY YEAR, NOT `League.season`. The dashboard list resolves it
 * from redraft and history rows (`resolveLeagueListSeasonYear`), so it can differ from the column
 * the sync run key is built from — and a run key built on the display year matches no
 * `LeagueSyncState` row, which reads as "never synced". The columns the key needs are re-read here
 * from `League` itself. Rows that are not in `League` (legacy Sleeper rows) keep what was passed.
 */
async function withLeagueColumns(input: WireLeagueInput[]): Promise<WireLeagueInput[]> {
  if (input.length === 0) return input
  const rows = await prisma.league
    .findMany({
      where: { id: { in: input.map((l) => l.id) } },
      select: { id: true, platform: true, platformLeagueId: true, season: true, sport: true, lastSyncedAt: true },
    })
    .catch(() => [])
  const byId = new Map(rows.map((r) => [r.id, r]))
  return input.map((l) => {
    const r = byId.get(l.id)
    if (!r) return l
    return {
      ...l,
      platform: r.platform ?? l.platform,
      platformLeagueId: r.platformLeagueId ?? l.platformLeagueId,
      season: r.season ?? l.season,
      sport: r.sport ?? l.sport ?? null,
      lastSyncedAt: r.lastSyncedAt ?? l.lastSyncedAt ?? null,
    }
  })
}

export async function getCareerWire(args: {
  userId: string
  /** The leagues the user plays — the page's `playedLeagues`, already loaded. */
  leagues: WireLeagueInput[]
  pausedLeagueIds: ReadonlySet<string>
  now: Date
  /** False for a prefetch or any speculative render: read the Wire, never move the visit. */
  recordVisit: boolean
}): Promise<CareerWireData> {
  const { userId, now } = args
  const leagues = latestSeasonOnly(await withLeagueColumns(args.leagues))
  const marker = await readMarker(userId)
  const window = resolveVisitWindow(marker, now)

  const [states, standings] = await Promise.all([
    readSyncStates(leagues),
    snapshotStandings(
      userId,
      leagues.map((l) => l.id),
    ),
  ])

  const current: VisitSnapshot = { takenAt: now.toISOString(), standings, injuries: {} }
  if (args.recordVisit) await writeMarker(userId, nextVisitMarker(window, current, now), now)

  const wireLeagues = buildWireLeagues({ leagues, states, pausedLeagueIds: args.pausedLeagueIds, standings, now })
  const names = new Map(wireLeagues.map((l) => [l.leagueId, l.leagueName]))

  return {
    platforms: buildPlatformHealth(wireLeagues),
    leagues: wireLeagues,
    changes: decorateChanges(diffStandings(window.baseline, current, names), wireLeagues),
    sinceAt: window.sinceAt.toISOString(),
    firstVisit: window.firstVisit,
    windowCapped: window.windowCapped,
    comparisonPending: window.baseline == null,
  }
}
