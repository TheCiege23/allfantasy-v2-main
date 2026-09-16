import 'server-only'

/**
 * Commissioner Hub — the reports that stream in after the page (items 5 and 6).
 *
 * The activity charts and the audit timeline are the two most expensive reads on
 * the screen, and neither is urgent: task cards and health come first. So each is
 * rendered in its own Suspense boundary and loaded here.
 *
 * ⚠ BOTH TAKE A `CommissionerGrant`, NOT A LEAGUE ID. Only `getCommissionerHub`
 * can produce one, and only after the commissioner gate has passed, so neither
 * report can be rendered for a league its viewer does not run.
 */

import { prisma } from '@/lib/prisma'
import type { CommissionerGrant } from '@/lib/core-app/commissionerHub'
import { platformLabel } from '@/lib/core-app/platformLinks'
import {
  activityChart,
  dedupeActivity,
  tradesChart,
  waiverParticipationChart,
  type ActivityRow,
  type HubChart,
} from './charts'
import {
  collapseQuietSyncs,
  fromAuditLog,
  fromAutomationRun,
  fromBroadcast,
  fromFeedEvent,
  fromImportRun,
  fromSyncRun,
  mergeTimeline,
  type TimelineEntry,
} from './timeline'
import type { SectionState } from '@/lib/core-app/leagueHome'

/**
 * Imported activity for this league, in either id space.
 *
 * One provider league produces one AllFantasy league row per importing user, and
 * activity attaches to only one of them — matching on provider + provider id as
 * well as `afLeagueId` is what lets every sibling read its own league's history.
 * The same rule as `lib/league-history/leagueWarehouseReads.ts`.
 */
function activityWhere(grant: CommissionerGrant) {
  return {
    OR: [
      { afLeagueId: grant.leagueId },
      { providerLeagueId: grant.leagueId },
      ...(grant.platformLeagueId
        ? [{ provider: grant.platform, providerLeagueId: grant.platformLeagueId }]
        : []),
    ],
  }
}

function managerKeysOf(normalized: unknown): string[] {
  const keys = (normalized as { managerKeys?: unknown } | null)?.managerKeys
  return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : []
}

/**
 * Start of this league's season for "this season" questions. The activity table
 * has no season column, so the season is a date window: from August 1 of the
 * league's season year, which covers every NFL fantasy calendar.
 */
function seasonStart(season: number | null, now: Date): Date {
  const year = season ?? now.getUTCFullYear()
  return new Date(Date.UTC(year, 7, 1))
}

export type ActivityCharts = SectionState<{
  activity: HubChart
  trades: HubChart
  waivers: HubChart | null
  newest: string | null
}>

export async function loadActivityCharts(grant: CommissionerGrant, now = new Date()): Promise<ActivityCharts> {
  try {
    const since = new Date(Math.min(seasonStart(grant.season, now).getTime(), now.getTime() - 8 * 7 * 86_400_000))
    const raw = await prisma.decisionOsImportedActivity.findMany({
      where: { ...activityWhere(grant), occurredAt: { gte: since } },
      select: { activityType: true, occurredAt: true, normalized: true },
      orderBy: { occurredAt: 'desc' },
      take: 5000,
    })
    const rows: ActivityRow[] = dedupeActivity(
      raw.map((r) => ({ activityType: r.activityType, occurredAt: r.occurredAt, managerKeys: managerKeysOf(r.normalized) })),
    )
    const thisSeason = rows.filter((r) => r.occurredAt >= seasonStart(grant.season, now))
    const managers = grant.teams
      .filter((t) => t.platformUserId)
      .map((t) => ({ key: t.platformUserId as string, name: t.name }))

    return {
      available: true,
      data: {
        activity: activityChart(rows, now),
        trades: tradesChart(rows, now),
        waivers: managers.length > 0 ? waiverParticipationChart(thisSeason, managers) : null,
        newest: rows[0]?.occurredAt.toISOString() ?? null,
      },
    }
  } catch {
    return { available: false, reason: 'League activity couldn’t be read just now.' }
  }
}

export async function loadAuditTimeline(grant: CommissionerGrant, limit = 40): Promise<SectionState<TimelineEntry[]>> {
  const pl = platformLabel(grant.platform)
  const syncScope =
    grant.platformLeagueId && grant.season != null
      ? `${grant.platform}:${grant.platformLeagueId}:${grant.season}`
      : null

  const [imports, syncs, audits, feed, broadcasts, automation] = await Promise.all([
    prisma.importRun
      .findMany({
        where: { leagueId: grant.leagueId },
        select: { id: true, provider: true, season: true, status: true, error: true, startedAt: true, completedAt: true },
        orderBy: { startedAt: 'desc' },
        take: 15,
      })
      .then((rows) => rows.map((r) => fromImportRun(r, pl)))
      .catch(() => null),
    syncScope
      ? prisma.syncJobRun
          .findMany({
            where: { jobScope: { startsWith: syncScope } },
            select: { id: true, status: true, rowsWritten: true, errorMessage: true, startedAt: true, completedAt: true },
            orderBy: { startedAt: 'desc' },
            take: 30,
          })
          .then((rows) => rows.map((r) => fromSyncRun(r, pl)))
          .catch(() => null)
      : Promise.resolve([] as TimelineEntry[]),
    prisma.leagueAuditLog
      .findMany({
        where: { leagueId: grant.leagueId },
        select: {
          id: true,
          actionType: true,
          entityType: true,
          metadata: true,
          createdAt: true,
          user: { select: { displayName: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
      })
      .then((rows) =>
        rows.map((r) =>
          fromAuditLog({ ...r, actorName: r.user?.displayName?.trim() || r.user?.username || null }),
        ),
      )
      .catch(() => null),
    prisma.auditFeedEntry
      .findMany({
        where: { leagueId: grant.leagueId, type: 'governance.settings.changed' },
        select: { id: true, type: true, summary: true, actorType: true, occurredAt: true },
        orderBy: { occurredAt: 'desc' },
        take: 10,
      })
      .then((rows) => rows.map(fromFeedEvent))
      .catch(() => null),
    prisma.leagueChatMessage
      .findMany({
        where: { leagueId: grant.leagueId, type: 'broadcast' },
        select: {
          id: true,
          message: true,
          createdAt: true,
          user: { select: { displayName: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })
      .then((rows) =>
        rows.map((r) =>
          fromBroadcast({ ...r, actorName: r.user?.displayName?.trim() || r.user?.username || null }),
        ),
      )
      .catch(() => null),
    prisma.automationRun
      .findMany({
        where: { leagueId: grant.leagueId },
        select: { id: true, jobType: true, status: true, startedAt: true, finishedAt: true, metadata: true },
        orderBy: { startedAt: 'desc' },
        take: 15,
      })
      .then((rows) => rows.map(fromAutomationRun))
      .catch(() => null),
  ])

  const parts = [imports, syncs, audits, feed, broadcasts, automation]
  if (parts.every((p) => p === null)) {
    return { available: false, reason: 'The league’s history couldn’t be read just now.' }
  }
  const merged = collapseQuietSyncs(mergeTimeline(parts.flatMap((p) => p ?? []), limit * 2)).slice(0, limit)
  return { available: true, data: merged }
}
