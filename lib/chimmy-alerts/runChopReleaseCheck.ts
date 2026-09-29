import 'server-only'

import type { Prisma } from '@prisma/client'

import type { FaabBidPlan } from '@/lib/chimmy/tools/faabBidTool'
import { isCategoryAllowedForLeague } from '@/lib/notifications/leagueOverrides'
import { prisma } from '@/lib/prisma'
import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'
import {
  chopReleaseDedupeKey,
  chopReleaseEnabled,
  chopReleaseMutedBy,
  chopSnapshotKey,
  CHOP_RELEASE_ALERT_TYPE,
  detectChops,
  pairRosters,
  renderChopRelease,
  snapshotChanged,
  snapshotOf,
  type ChopLeagueRows,
  type ChopRosterSnapshot,
} from './chopRelease'
import { categoryOn, CLAIM_TTL_MS, PROACTIVE_CATEGORY, proactiveDeliveryDeps, type ProactiveDeliveryDeps } from './proactiveDelivery'

/**
 * Runs the guillotine chop-release alert (see `chopRelease.ts`). Called by the alert sweep every 15
 * minutes; with `CHOP_RELEASE_ALERTS_ENABLED` unset it returns before reading anything.
 *
 * Per guillotine league: read its rosters, compare them with the snapshot of the last run, and when a
 * roster has gone from players to none, send each SURVIVING member with a claimed AllFantasy account
 * one message built from their own `computeFaabBidPlan`. Settings, the once-a-week claim and the
 * dispatch are the weekly checks' (`proactiveDelivery.ts`), so the rules that protect people from
 * being over-messaged cannot drift between them.
 *
 * ⚠ THE SNAPSHOT MOVES ONLY WHEN A LEAGUE IS FINISHED. If the run's budget ends partway through a
 * league's members, that league's snapshot is left alone: the next run sees the same chop again and
 * the per-user claim skips everyone already messaged, so the rest are reached rather than dropped.
 * A dry run and a single-user run never move it — either would swallow the chop for everyone else.
 *
 * ⚠ AT MOST ONCE, like the weekly checks: a member whose plan throws is reported and not retried.
 */

export type ChopReleaseUserOutcome =
  | 'sent'
  | 'would_send'
  | 'no_plan'
  | 'already_sent'
  | 'category_off'
  | 'muted'
  | 'no_profile'
  | 'error'

export type ChopLeague = { id: string; name: string; platformLeagueId: string | null }

export interface ChopReleaseDeps
  extends Pick<ProactiveDeliveryDeps, 'now' | 'loadSettings' | 'alreadySent' | 'claim' | 'dispatch' | 'baseUrl'> {
  enabled: () => boolean
  /** This season's NFL Sleeper guillotine leagues with at least one claimed team. */
  loadLeagues: (season: number) => Promise<ChopLeague[]>
  readRows: (leagueId: string) => Promise<ChopLeagueRows>
  loadSnapshot: (leagueId: string) => Promise<ChopRosterSnapshot | null>
  saveSnapshot: (leagueId: string, snapshot: ChopRosterSnapshot) => Promise<void>
  resolveWeek: (platformLeagueId: string) => Promise<{ seasonYear: number; week: number } | null>
  computePlan: (leagueId: string, userId: string) => Promise<FaabBidPlan>
}

export type ChopReleaseRun =
  | { ran: false; reason: 'disabled' }
  | { ran: false; reason: 'no_chop'; leagues: number; seeded: number; resets: number }
  | {
      ran: true
      dryRun: boolean
      leagues: number
      seeded: number
      resets: number
      chops: Array<{ leagueId: string; season: number | null; week: number | null; teams: string[]; released: number }>
      outcomes: Partial<Record<ChopReleaseUserOutcome, number>>
      /** Chops whose league week could not be read: noted, not announced. */
      noWeek: number
      /** Stopped by the time budget; the unfinished league is picked up next run. */
      budgetStopped: boolean
      previews: Array<{ userId: string; leagueId: string; title: string; body: string }>
      errors: Array<{ userId: string; leagueId: string; error: string }>
    }

const DEFAULT_BUDGET_MS = 90_000
/** A snapshot outlives an idle off-season week; an expired one only re-seeds, never alerts. */
const SNAPSHOT_TTL_MS = 60 * 24 * 60 * 60 * 1000

/** Guillotine by the league's format rules — never by its name. Survivor Guillotine reads `guillotine` too. */
export function guillotineOnly<
  T extends { leagueType: string | null; leagueVariant: string | null; isDynasty: boolean; settings: unknown },
>(rows: readonly T[]): T[] {
  return rows.filter(
    (l) =>
      readFormatRules({ leagueType: l.leagueType, leagueVariant: l.leagueVariant, isDynasty: l.isDynasty, settings: l.settings })
        .concept === 'guillotine',
  )
}

const defaultDeps: ChopReleaseDeps = {
  now: proactiveDeliveryDeps.now,
  loadSettings: proactiveDeliveryDeps.loadSettings,
  alreadySent: proactiveDeliveryDeps.alreadySent,
  claim: proactiveDeliveryDeps.claim,
  dispatch: proactiveDeliveryDeps.dispatch,
  baseUrl: proactiveDeliveryDeps.baseUrl,
  enabled: () => chopReleaseEnabled(),
  loadLeagues: async (season) => {
    const rows = await prisma.league.findMany({
      where: {
        season,
        sport: 'NFL',
        platform: { equals: 'sleeper', mode: 'insensitive' },
        teams: { some: { claimedByUserId: { not: null } } },
      },
      select: { id: true, name: true, platformLeagueId: true, leagueType: true, leagueVariant: true, isDynasty: true, settings: true },
    })
    return guillotineOnly(rows).map((l) => ({ id: l.id, name: l.name ?? '', platformLeagueId: l.platformLeagueId ?? null }))
  },
  readRows: async (leagueId) => (await import('@/lib/core-app/playerTradeVisual')).readLeagueTradeRows(leagueId),
  loadSnapshot: async (leagueId) => {
    const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: chopSnapshotKey(leagueId) }, select: { data: true } })
    return row ? (row.data as unknown as ChopRosterSnapshot) : null
  },
  saveSnapshot: async (leagueId, snapshot) => {
    const expiresAt = new Date(Date.now() + SNAPSHOT_TTL_MS)
    const data = snapshot as unknown as Prisma.InputJsonValue
    await prisma.sportsDataCache.upsert({
      where: { cacheKey: chopSnapshotKey(leagueId) },
      create: { cacheKey: chopSnapshotKey(leagueId), expiresAt, data },
      update: { expiresAt, data },
    })
  },
  resolveWeek: async (platformLeagueId) =>
    (await import('@/lib/core-app/currentWeek')).resolveCurrentWeekForLeague(platformLeagueId),
  computePlan: async (leagueId, userId) => (await import('@/lib/chimmy/tools/faabBidTool')).computeFaabBidPlan(leagueId, userId),
}

export async function runChopReleaseCheck(
  opts: { dryRun?: boolean; force?: boolean; userId?: string | null; budgetMs?: number } = {},
  overrides: Partial<ChopReleaseDeps> = {},
): Promise<ChopReleaseRun> {
  const deps: ChopReleaseDeps = { ...defaultDeps, ...overrides }
  // 🛑 Before anything else — off means no read, no snapshot, no message.
  if (!deps.enabled()) return { ran: false, reason: 'disabled' }

  const startedAt = Date.now()
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS
  const overBudget = () => Date.now() - startedAt >= budgetMs
  const dryRun = Boolean(opts.dryRun)
  const onlyUser = opts.userId ?? null
  // A dry run or a one-user verification must not advance what the whole league is measured against.
  const mayWriteSnapshot = !dryRun && !onlyUser
  const now = deps.now()

  const leagues = await deps.loadLeagues(now.getUTCFullYear())
  let seeded = 0
  let resets = 0
  let noWeek = 0
  let budgetStopped = false
  const chops: Extract<ChopReleaseRun, { ran: true }>['chops'] = []
  const outcomes: Partial<Record<ChopReleaseUserOutcome, number>> = {}
  const previews: Extract<ChopReleaseRun, { ran: true }>['previews'] = []
  const errors: Extract<ChopReleaseRun, { ran: true }>['errors'] = []
  const tally = (o: ChopReleaseUserOutcome) => (outcomes[o] = (outcomes[o] ?? 0) + 1)

  leagueLoop: for (const league of leagues) {
    if (overBudget()) {
      budgetStopped = true
      break
    }
    const current = pairRosters(await deps.readRows(league.id))
    const previous = await deps.loadSnapshot(league.id)
    const next = snapshotOf(current)
    const detection = detectChops(previous, current)

    if (detection.kind !== 'chop') {
      if (detection.kind === 'seed') seeded += 1
      if (detection.kind === 'reset') resets += 1
      if (mayWriteSnapshot && snapshotChanged(previous, next)) await deps.saveSnapshot(league.id, next)
      continue
    }

    const choppedKeys = new Set(detection.chopped.map((c) => c.teamKey))
    const teams = current.filter((c) => choppedKeys.has(c.teamKey)).map((c) => c.name)
    const releasedIds = [...new Set(detection.chopped.flatMap((c) => c.releasedIds))]
    const week = league.platformLeagueId ? await deps.resolveWeek(league.platformLeagueId).catch(() => null) : null
    chops.push({ leagueId: league.id, season: week?.seasonYear ?? null, week: week?.week ?? null, teams, released: releasedIds.length })

    if (!week) {
      // No week, no once-a-week key: say nothing rather than risk saying it twice, and move on.
      noWeek += 1
      if (mayWriteSnapshot) await deps.saveSnapshot(league.id, next)
      continue
    }
    const dedupePrefix = chopReleaseDedupeKey(league.id, week.seasonYear, week.week)

    const survivors = [
      ...new Set(
        current
          .filter((c) => c.playerIds.length > 0 && !choppedKeys.has(c.teamKey) && c.claimedByUserId)
          .map((c) => c.claimedByUserId as string),
      ),
    ].filter((u) => !onlyUser || u === onlyUser)

    for (const userId of survivors) {
      if (overBudget()) {
        // Leave this league's snapshot where it was: the next run resumes it (claims skip the sent).
        budgetStopped = true
        break leagueLoop
      }
      const key = `${dedupePrefix}:${userId}`
      try {
        if (await deps.alreadySent(key)) {
          tally('already_sent')
          continue
        }
        const settings = await deps.loadSettings(userId)
        if (!settings) {
          tally('no_profile')
          continue
        }
        if (!categoryOn(settings)) {
          tally('category_off')
          continue
        }
        if (
          !isCategoryAllowedForLeague(settings.notifications, PROACTIVE_CATEGORY, league.id) ||
          chopReleaseMutedBy(settings.chimmy, league.id)
        ) {
          tally('muted')
          continue
        }
        const plan = await deps.computePlan(league.id, userId)
        const message = renderChopRelease({
          leagueId: league.id,
          leagueName: league.name,
          choppedTeamNames: teams,
          releasedIds,
          plan,
          baseUrl: deps.baseUrl(),
        })
        if (!message) {
          tally('no_plan')
          continue
        }
        if (dryRun) {
          tally('would_send')
          previews.push({ userId, leagueId: league.id, title: message.title, body: message.body })
          continue
        }
        if (!(await deps.claim(key, new Date(now.getTime() + CLAIM_TTL_MS)))) {
          tally('already_sent')
          continue
        }
        const channels = settings.chimmy?.channelPreferences
        await deps.dispatch({
          userIds: [userId],
          category: PROACTIVE_CATEGORY,
          productType: 'app',
          type: 'chimmy_chop_release',
          title: message.title,
          body: message.body,
          actionHref: message.actionHref,
          actionLabel: 'Ask Chimmy',
          leagueId: league.id,
          severity: 'medium',
          meta: {
            chimmyAlert: true,
            class: 'waiver',
            alertType: CHOP_RELEASE_ALERT_TYPE,
            season: week.seasonYear,
            week: week.week,
            choppedTeams: teams,
            released: releasedIds.length,
            kind: message.kind,
            namedPlayerIds: message.namedIds,
          },
          dedupePrefix,
          skipChannels: { sms: true, email: Boolean(channels?.disableEmail), push: Boolean(channels?.disablePush) },
          emailOverride: message.email,
        })
        tally('sent')
      } catch (e) {
        tally('error')
        errors.push({ userId, leagueId: league.id, error: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160) })
      }
    }

    if (mayWriteSnapshot) await deps.saveSnapshot(league.id, next)
  }

  if (chops.length === 0) return { ran: false, reason: 'no_chop', leagues: leagues.length, seeded, resets }
  return {
    ran: true,
    dryRun,
    leagues: leagues.length,
    seeded,
    resets,
    chops,
    outcomes,
    noWeek,
    budgetStopped,
    previews,
    errors: errors.slice(0, 10),
  }
}
