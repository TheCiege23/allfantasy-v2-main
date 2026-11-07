import 'server-only'

import type { PrismaClient } from '@prisma/client'

import { leagueWeekFromSettings, playoffSpots, regularSeasonWeeks } from '@/lib/core-app/seasonTimeline'
import { assessContention } from './contention'

/**
 * "Your rebuild plan is ready" — once a season, to a manager whose team is mathematically out of the
 * race in a dynasty or keeper league (owner decision 2026-11-06). The plan itself is the Trade Center's
 * rebuild card (lib/trade-intel/rebuildAdvisor.ts); this only points a manager at it at the moment it
 * matters, as the healthy alternative to tanking.
 *
 * Run from the week finalizer, beside the tanking scan, once every game of the week is final.
 *
 * ⚠ ONLY `selling` — mathematically out — NEVER `bubble`. Telling a manager who can still make the
 * playoffs to rebuild is the advice this file exists not to give.
 * ⚠ ONLY TO A MANAGER WHO CAN OPEN IT. The plan is AF Pro; a notice that lands on a lock is an upsell
 * wearing a helpful message's clothes. Without AF Pro, nothing is sent.
 * ⚠ ONCE A SEASON, BY THE NOTICE'S OWN SOURCE KEY, so the finalizer's re-runs of a closed week and every
 * later week of the same season repeat nothing.
 */

export type RebuildNoticeDeps = {
  hasAfPro: (userId: string) => Promise<boolean>
  dispatch: (input: Record<string, unknown>) => Promise<unknown>
}

const defaultDeps: RebuildNoticeDeps = {
  hasAfPro: async (userId) => {
    const { resolveCoreDepth } = await import('@/lib/core-app/corePaywall')
    return (await resolveCoreDepth(userId, 'trade_depth')).unlocked === true
  },
  dispatch: async (input) => {
    const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
    return dispatchNotification(input as never)
  },
}

export const rebuildNoticePrefix = (leagueId: string, season: number) => `rebuild-plan-ready:${leagueId}:${season}`

/** Dynasty or keeper: the league types where rebuilding has a next year to build for. */
export function rebuildsMakeSense(league: { leagueType?: string | null; leagueVariant?: string | null; isDynasty?: boolean | null }): boolean {
  const type = `${league.leagueType ?? ''} ${league.leagueVariant ?? ''}`.toLowerCase()
  return league.isDynasty === true || type.includes('dynasty') || type.includes('keeper')
}

export async function notifyRebuildPlans(
  args: { prisma: PrismaClient; seasonId: string },
  deps: Partial<RebuildNoticeDeps> = {},
): Promise<{ notified: number }> {
  const d = { ...defaultDeps, ...deps }
  const season = await args.prisma.redraftSeason.findUnique({
    where: { id: args.seasonId },
    select: {
      leagueId: true,
      season: true,
      league: { select: { name: true, settings: true, leagueType: true, leagueVariant: true, isDynasty: true } },
    },
  })
  if (!season?.league || !rebuildsMakeSense(season.league)) return { notified: 0 }

  const rosters = await args.prisma.redraftRoster.findMany({
    where: { seasonId: args.seasonId },
    select: { id: true, ownerId: true, wins: true, losses: true, ties: true },
  })
  if (rosters.length < 4) return { notified: 0 }

  const settings = season.league.settings
  const standings = [...rosters]
    .sort((a, b) => b.wins + b.ties / 2 - (a.wins + a.ties / 2) || a.losses - b.losses)
    .map((r) => ({ teamId: r.id, wins: r.wins, losses: r.losses, ties: r.ties }))
  const shape = { playoffSpots: playoffSpots(settings), seasonWeeks: regularSeasonWeeks(settings), currentWeek: leagueWeekFromSettings(settings) }

  const prefix = rebuildNoticePrefix(season.leagueId, season.season)
  let notified = 0
  for (const r of rosters) {
    const state = assessContention({ standings, teamId: r.id, ...shape })
    if (state?.posture !== 'selling') continue
    const userId = r.ownerId ?? ''
    if (!userId || userId.startsWith('orphan-') || userId.startsWith('ai-manager-')) continue
    const sent = await args.prisma.platformNotification.findFirst({ where: { sourceKey: `${prefix}:${userId}` }, select: { id: true } })
    if (sent) continue
    if (!(await d.hasAfPro(userId).catch(() => false))) continue
    const leagueName = season.league.name ?? 'your league'
    await d.dispatch({
      userIds: [userId],
      category: 'league_announcements',
      type: 'rebuild_plan_ready',
      title: 'Your rebuild plan is ready',
      body: `You are out of the playoff race in ${leagueName}. Instead of playing out the string, see what to sell, what to keep, and which contenders want what you have.`,
      smsBody: `AllFantasy: your ${leagueName} rebuild plan is ready. Open the Trade Center to see it.`,
      actionHref: `/core/trades?league=${encodeURIComponent(season.leagueId)}`,
      actionLabel: 'See my rebuild plan',
      leagueId: season.leagueId,
      severity: 'low',
      dedupePrefix: prefix,
      meta: { leagueId: season.leagueId, season: season.season, rosterId: r.id },
    })
    notified += 1
  }
  return { notified }
}
