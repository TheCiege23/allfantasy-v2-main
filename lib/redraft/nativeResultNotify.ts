import type { PrismaClient } from '@prisma/client'

import { isNativePlatform } from '@/lib/league/isNativeLeague'

/**
 * "Week 4 final — you won" — the result push for a league AllFantasy scores itself (2026-10-02).
 *
 * An imported league's results reach people through its provider's sync; a native league has no
 * provider, so until this a native game ended in silence. It fires from the one place a native week
 * is known to be over: `finalizeRedraftWeek`, once EVERY game of the week is `final` — the same gate
 * that queues the tanking scan — so a week the finalizer refuses never announces a score.
 *
 * Category `matchup_results`, the category the weekly story push already uses (user decision
 * 2026-10-01), so whoever muted results gets none of this and there is no new settings row.
 *
 * ⚠ ONLY GAMES AGAINST A MANAGER, ONLY TO PEOPLE. A bye (no away roster) and a median game are not a
 * result against anyone, and a native roster's `ownerId` is an AppUser id only once a person holds
 * the seat — open seats carry `open-slot-*` / `orphan-*` / `roster:*` keys, which are not notified.
 *
 * ⚠ ONCE PER PERSON PER WEEK, CHECKED BEFORE DISPATCH. `PlatformNotification.sourceKey` dedupes the
 * in-app row, but the dispatcher still pushes on a duplicate, so the keys are read first and a failed
 * read sends nothing — the finalizer re-runs on a schedule, and a repeated push is worse than a
 * missed one. Its own device tag per league and week, so it never REPLACES the weekly story push
 * (or another league's result) on the lock screen.
 *
 * ⚠ IT NEVER THROWS. It runs at the tail of a completed scoring week; nothing here may undo that.
 */

export const NATIVE_RESULT_PREFIX = 'native-result'

/** `NATIVE_RESULT_PUSH=off` silences it without a deploy of code — the class recap's convention. */
export function isNativeResultPushDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.NATIVE_RESULT_PUSH ?? '').trim().toLowerCase() === 'off'
}

export type NativeResultGame = {
  homeOwnerId: string
  homeTeam: string
  homeScore: number
  awayOwnerId: string
  awayTeam: string
  awayScore: number
}

export type NativeResultMessage = { userId: string; title: string; body: string }

const pts = (n: number) => (Math.round(n * 10) / 10).toFixed(1)

/** One message per person in a game, from their own side. Pure; exported for tests. */
export function nativeResultMessages(args: {
  games: readonly NativeResultGame[]
  people: ReadonlySet<string>
  leagueName: string
  week: number
}): NativeResultMessage[] {
  const out: NativeResultMessage[] = []
  for (const g of args.games) {
    const sides = [
      { me: g.homeOwnerId, mine: g.homeScore, opp: g.awayTeam, theirs: g.awayScore },
      { me: g.awayOwnerId, mine: g.awayScore, opp: g.homeTeam, theirs: g.homeScore },
    ]
    for (const s of sides) {
      if (!args.people.has(s.me)) continue
      const score = `${pts(s.mine)}–${pts(s.theirs)}`
      const won = s.mine > s.theirs
      const tied = s.mine === s.theirs
      out.push({
        userId: s.me,
        title: `Week ${args.week} final — ${won ? 'you won' : tied ? 'a tie' : 'you lost'}`,
        body: tied
          ? `${args.leagueName}: you tied ${s.opp} ${score}.`
          : `${args.leagueName}: ${won ? 'you beat' : 'you fell to'} ${s.opp} ${score}.`,
      })
    }
  }
  return out
}

type Dispatch = typeof import('@/lib/notifications/NotificationDispatcher').dispatchNotification

export async function notifyNativeWeekResults(args: {
  prisma: PrismaClient
  seasonId: string
  week: number
  env?: NodeJS.ProcessEnv
  /** Injected for tests; the real dispatcher is loaded on first use. */
  dispatch?: Dispatch
}): Promise<{ targeted: number; sent: number; skipped: number }> {
  const none = { targeted: 0, sent: 0, skipped: 0 }
  if (isNativeResultPushDisabled(args.env)) return none
  try {
    const { prisma, seasonId, week } = args
    const season = await prisma.redraftSeason.findUnique({
      where: { id: seasonId },
      select: { leagueId: true, league: { select: { name: true, platform: true } } },
    })
    // An import's results are its provider's to announce; a missing league is nothing to say.
    if (!season?.league || !isNativePlatform(season.league.platform)) return none

    const rows = await prisma.redraftMatchup.findMany({
      where: { seasonId, week, status: 'final', isMedianMatchup: false, awayRosterId: { not: null } },
      select: {
        homeScore: true,
        awayScore: true,
        homeRoster: { select: { ownerId: true, teamName: true, ownerName: true } },
        awayRoster: { select: { ownerId: true, teamName: true, ownerName: true } },
      },
    })
    const team = (r: { teamName: string | null; ownerName: string } | null) => r?.teamName?.trim() || r?.ownerName?.trim() || 'your opponent'
    const games: NativeResultGame[] = rows
      .filter((r) => r.awayRoster)
      .map((r) => ({
        homeOwnerId: r.homeRoster.ownerId,
        homeTeam: team(r.homeRoster),
        homeScore: r.homeScore,
        awayOwnerId: r.awayRoster!.ownerId,
        awayTeam: team(r.awayRoster),
        awayScore: r.awayScore,
      }))
    const ownerIds = [...new Set(games.flatMap((g) => [g.homeOwnerId, g.awayOwnerId]))]
    if (ownerIds.length === 0) return none
    const people = new Set(
      (await prisma.appUser.findMany({ where: { id: { in: ownerIds } }, select: { id: true } })).map((u) => u.id),
    )

    const leagueName = season.league.name?.trim() || 'Your league'
    const messages = nativeResultMessages({ games, people, leagueName, week })
    if (messages.length === 0) return none

    const prefix = `${NATIVE_RESULT_PREFIX}:${seasonId}:${week}`
    const existing = await prisma.platformNotification
      .findMany({ where: { sourceKey: { in: messages.map((m) => `${prefix}:${m.userId}`) } }, select: { sourceKey: true } })
      .catch(() => null)
    if (existing == null) return { targeted: messages.length, sent: 0, skipped: messages.length }
    const done = new Set(existing.map((e) => e.sourceKey))
    const todo = messages.filter((m) => !done.has(`${prefix}:${m.userId}`))

    const dispatch = args.dispatch ?? (await import('@/lib/notifications/NotificationDispatcher')).dispatchNotification
    const href = `/core/matchup?league=${encodeURIComponent(season.leagueId)}`
    let sent = 0
    for (const m of todo) {
      try {
        await dispatch({
          userIds: [m.userId],
          category: 'matchup_results',
          type: 'native_week_result',
          title: m.title,
          body: m.body,
          actionHref: href,
          actionLabel: 'See the game',
          severity: 'low',
          dedupePrefix: prefix,
          // A push and an in-app row — never an email or a text for one game.
          skipChannels: { email: true, sms: true },
          meta: { leagueId: season.leagueId, week, pushTag: `${NATIVE_RESULT_PREFIX}:${season.leagueId}:${week}` },
        })
        sent += 1
      } catch {
        // One person's failed dispatch must not cost the rest of the league theirs.
      }
    }
    return { targeted: messages.length, sent, skipped: messages.length - todo.length }
  } catch (err) {
    console.error('[native-result] notify failed', err instanceof Error ? err.message : 'unknown')
    return none
  }
}
