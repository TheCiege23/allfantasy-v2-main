import 'server-only'

/**
 * The hourly run for taxi deadline notices (./taxiDeadlineNotices.ts). Leagues whose commissioner
 * switched taxi enforcement on while the owner holds AF Commissioner — the same leagues whose saves are
 * held to the deadlines (`loadTaxiEnforcement`). Each notice is deduplicated per league, season, week
 * and deadline, so the hourly run sends it once.
 */
import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { loadTaxiEnforcement } from './taxiRulesService'
import { TAXI_RULES_ENFORCED_KEY, taxiSeasonPhase } from './taxiMoveRules'
import { taxiDeadlineMessages, taxiDeadlinesClosingThisWeek } from './taxiDeadlineNotices'

const TAXI_SLOTS = ['TAXI', 'taxi', 'Taxi']

export type TaxiDeadlineRunResult = { leagues: number; notified: number; skipped: Record<string, number>; failures: { leagueId: string; error: string }[] }

export async function runTaxiDeadlineNotices(opts?: { limit?: number; deadline?: number }): Promise<TaxiDeadlineRunResult> {
  const deadline = opts?.deadline ?? Date.now() + 20_000
  const result: TaxiDeadlineRunResult = { leagues: 0, notified: 0, skipped: {}, failures: [] }
  const skip = (reason: string) => (result.skipped[reason] = (result.skipped[reason] ?? 0) + 1)
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM leagues WHERE settings ->> ${TAXI_RULES_ENFORCED_KEY} = 'true'
    ORDER BY id LIMIT ${Math.max(1, Math.min(opts?.limit ?? 200, 1000))}`

  for (const { id: leagueId } of ids) {
    if (Date.now() >= deadline) break
    result.leagues += 1
    try {
      const enforcement = await loadTaxiEnforcement(leagueId)
      if (!enforcement?.season) {
        skip(enforcement ? 'no_season' : 'not_enforced')
        continue
      }
      const { rules, season } = enforcement
      const week = Math.max(1, season.currentWeek ?? 1)
      const kinds = taxiDeadlinesClosingThisWeek(rules, taxiSeasonPhase(season, week), week)
      if (kinds.length === 0) {
        skip('no_deadline_this_week')
        continue
      }
      const [league, rosters] = await Promise.all([
        prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, name: true } }),
        prisma.redraftRoster.findMany({
          where: { leagueId, seasonId: season.id },
          select: { ownerId: true, teamName: true, players: { where: { droppedAt: null, slotType: { in: TAXI_SLOTS } }, select: { playerName: true } } },
        }),
      ])
      if (!league) continue
      const messages = taxiDeadlineMessages({
        kinds,
        week,
        leagueName: league.name ?? 'your league',
        commissionerId: league.userId,
        teams: rosters
          .filter((r) => r.ownerId && !/^(orphan-|ai-manager-)/.test(r.ownerId))
          .map((r) => ({ ownerId: r.ownerId, teamName: r.teamName, taxiPlayers: r.players.map((p) => p.playerName) })),
      })
      for (const msg of messages) {
        await dispatchNotification({
          userIds: [msg.userId],
          category: msg.audience === 'commissioner' ? 'commissioner_alerts' : 'league_announcements',
          type: `taxi_deadline_${msg.kind}`,
          title: msg.title,
          body: msg.body,
          severity: 'medium',
          leagueId,
          actionHref: msg.audience === 'commissioner' ? `/league/${leagueId}` : `/league/${leagueId}?tab=team`,
          actionLabel: msg.audience === 'commissioner' ? 'Open league' : 'Open my team',
          dedupePrefix: `taxi-deadline:${leagueId}:${season.id}:${week}:${msg.kind}:${msg.audience}:${msg.userId}`,
          meta: { leagueId, week, kind: msg.kind },
        }).catch(() => {})
        result.notified += 1
      }
    } catch (e) {
      result.failures.push({ leagueId, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}
