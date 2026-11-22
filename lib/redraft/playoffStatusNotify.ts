import 'server-only'

import type { PrismaClient } from '@prisma/client'

import { isNativePlatform } from '@/lib/league/isNativeLeague'

/**
 * "You clinched a playoff spot" / "Your playoff race is over" — once a season per manager, in a league
 * AllFantasy scores itself (2026-11-15: "build the league-moment alerts").
 *
 * The standings screen already says "In" and "Out" (Season Outlook's `mathStatus`); nobody was TOLD.
 * This tells them, at the one moment the answer can change: the week finalizer, once every game of the
 * week is final — the same gate as the result push (nativeResultNotify.ts).
 *
 * 🛑 NO SECOND MODEL. The verdict is Season Outlook's own, read through `loadOutlookInputs` and
 * `mathStatus`, and only where it would print it: `statusCanBeCertified` (a complete qualification
 * schedule, no median game, no divisions). Anything it cannot certify sends nothing. Arithmetic only —
 * clinched means no remaining result can keep you out; eliminated means none can get you in.
 *
 * Native leagues only. An imported league's own app (Sleeper, Yahoo, …) tells its managers; a second
 * alert from us would be the same news twice. Elimination formats (guillotine, survivor) are withheld by
 * Season Outlook and never reach this.
 *
 * ⚠ ONCE PER PERSON PER LEAGUE-SEASON, READ BEFORE SENDING, like the result push: the dispatcher dedupes
 * the bell row but would still buzz the phone on a re-run. Clinched and eliminated are each final, so
 * whichever one a manager got is the only one they ever get.
 *
 * ⚠ A MANAGER ALREADY TOLD "your rebuild plan is ready" (lib/trade-intel/rebuildPlanNotice.ts, which
 * opens "You are out of the playoff race") is not told it again here.
 *
 * Category `matchup_results`, like the result push, so whoever muted results gets none of this. Never
 * throws: it runs at the tail of a completed scoring week.
 */

export type PlayoffStatus = 'clinched' | 'eliminated'

export const playoffStatusPrefix = (leagueId: string, season: number) => `playoff-status:${leagueId}:${season}`

export function playoffStatusCopy(status: PlayoffStatus, teamName: string, leagueName: string): { title: string; body: string } {
  const team = teamName.trim() || 'Your team'
  const league = leagueName.trim() || 'your league'
  return status === 'clinched'
    ? { title: `You clinched a playoff spot in ${league}`, body: `${team} is in. Every game from here is about seeding.` }
    : {
        title: `Your playoff race is over in ${league}`,
        body: `${team} can no longer reach the playoffs. Your games still decide your opponents' seasons, so keep setting your lineup.`,
      }
}

type Deps = {
  loadStatuses: (leagueId: string) => Promise<{ season: number; statuses: Map<string, PlayoffStatus> } | null>
  dispatch: (input: Record<string, unknown>) => Promise<unknown>
}

const defaultDeps: Deps = {
  loadStatuses: async (leagueId) => {
    const [{ loadOutlookInputs }, { mathStatus }, { prisma }] = await Promise.all([
      import('@/lib/core-app/seasonOutlook'),
      import('@/lib/core-app/outlookSim'),
      import('@/lib/prisma'),
    ])
    const row = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, name: true, platform: true, platformLeagueId: true, settings: true, sport: true, leagueType: true },
    })
    if (!row) return null
    const inputs = await loadOutlookInputs('', [{ ...row, platform: String(row.platform), sport: row.sport ? String(row.sport) : null }])
    const p = inputs?.prepared[0]
    if (!p || !p.statusCanBeCertified) return null
    const statuses = new Map<string, PlayoffStatus>()
    for (const t of p.sim.teams) {
      const s = mathStatus(p.sim, t.rosterId)
      if (s) statuses.set(t.rosterId, s)
    }
    return { season: p.season, statuses }
  },
  dispatch: async (input) => {
    const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
    return dispatchNotification(input as never)
  },
}

const isPerson = (id: string | null | undefined): id is string =>
  typeof id === 'string' && id.length > 0 && !/^(open-slot-|orphan-|roster:)/.test(id)

export async function notifyNativePlayoffStatus(
  args: { prisma: PrismaClient; seasonId: string },
  deps: Partial<Deps> = {},
): Promise<{ notified: number }> {
  const d = { ...defaultDeps, ...deps }
  try {
    if (String(process.env.PLAYOFF_STATUS_PUSH ?? '').trim().toLowerCase() === 'off') return { notified: 0 }
    const season = await args.prisma.redraftSeason.findUnique({
      where: { id: args.seasonId },
      select: { leagueId: true, season: true, league: { select: { name: true, platform: true } } },
    })
    if (!season?.league || !isNativePlatform(season.league.platform)) return { notified: 0 }

    const loaded = await d.loadStatuses(season.leagueId)
    if (!loaded || loaded.statuses.size === 0) return { notified: 0 }

    const rosters = await args.prisma.redraftRoster.findMany({
      where: { id: { in: [...loaded.statuses.keys()] } },
      select: { id: true, ownerId: true, teamName: true, ownerName: true },
    })
    const candidates = rosters.filter((r) => isPerson(r.ownerId))
    if (candidates.length === 0) return { notified: 0 }

    // Keyed on the redraft season, exactly as the rebuild notice is, so the two keys line up.
    const prefix = playoffStatusPrefix(season.leagueId, season.season)
    const { rebuildNoticePrefix } = await import('@/lib/trade-intel/rebuildPlanNotice')
    const rebuildPrefix = rebuildNoticePrefix(season.leagueId, season.season)
    const keysFor = (userId: string) => [`${prefix}:clinched:${userId}`, `${prefix}:eliminated:${userId}`, `${rebuildPrefix}:${userId}`]
    // A failed read sends nothing: a repeated buzz is worse than a missed one, and the next week re-checks.
    const existing = await args.prisma.platformNotification.findMany({
      where: { sourceKey: { in: candidates.flatMap((r) => keysFor(r.ownerId!)) } },
      select: { sourceKey: true },
    })
    const done = new Set(existing.map((e) => e.sourceKey))

    let notified = 0
    for (const r of candidates) {
      const userId = r.ownerId!
      const status = loaded.statuses.get(r.id)!
      if (keysFor(userId).some((k) => done.has(k))) continue
      const copy = playoffStatusCopy(status, r.teamName ?? r.ownerName ?? '', season.league.name ?? '')
      await d.dispatch({
        userIds: [userId],
        category: 'matchup_results',
        productType: 'app',
        type: status === 'clinched' ? 'playoff_clinched' : 'playoff_eliminated',
        title: copy.title,
        body: copy.body,
        actionHref: `/league/${encodeURIComponent(season.leagueId)}/standings`,
        actionLabel: 'See standings',
        leagueId: season.leagueId,
        severity: 'medium',
        dedupePrefix: `${prefix}:${status}`,
        meta: { leagueId: season.leagueId, season: season.season, playoffStatus: status, rosterId: r.id },
      })
      notified += 1
    }
    return { notified }
  } catch (error) {
    console.error('[playoff-status] notice failed', { seasonId: args.seasonId, error: error instanceof Error ? error.message : String(error) })
    return { notified: 0 }
  }
}
