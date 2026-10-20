import { prisma } from '@/lib/prisma'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { buildWeeklyChecklist, isStarterSlot, isUnavailable, type ChecklistItem } from './weeklyChecklist'

/**
 * Reads for the weekly commissioner checklist (./weeklyChecklist). Redraft only, for now: the
 * league must be an AllFantasy-run redraft league with a season under way.
 */

const RUNNING_SEASON = new Set(['active', 'in_season', 'playoffs'])

/** An allow-list, not a deny-list: a new specialty variant must not slip in as "redraft". */
export function isPlainRedraft(league: {
  platform: string | null
  leagueType: string | null
  leagueVariant: string | null
  isDynasty: boolean | null
  bestBallMode: boolean | null
  guillotineMode: boolean | null
}): boolean {
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') return false
  if (String(league.leagueType ?? '').trim().toLowerCase() !== 'redraft') return false
  if (league.isDynasty || league.bestBallMode || league.guillotineMode) return false
  const variant = String(league.leagueVariant ?? '').trim().toLowerCase()
  return variant === '' || variant === 'redraft'
}

export type WeeklyChecklistView =
  | { applies: false; reason: 'not_redraft' | 'no_season' | 'not_in_season' }
  | { applies: true; week: number; items: ChecklistItem[] }

export async function readWeeklyChecklist(leagueId: string, now = new Date()): Promise<WeeklyChecklistView | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      platform: true, leagueType: true, leagueVariant: true, isDynasty: true, bestBallMode: true, guillotineMode: true,
      sport: true, settings: true, tradeDeadlineWeek: true,
    },
  })
  if (!league) return null
  if (!isPlainRedraft(league)) return { applies: false, reason: 'not_redraft' }

  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { season: 'desc' },
    select: { id: true, season: true, status: true, currentWeek: true, totalWeeks: true, playoffStartWeek: true },
  })
  if (!season) return { applies: false, reason: 'no_season' }
  if (!RUNNING_SEASON.has(String(season.status).toLowerCase()) || season.currentWeek < 1) return { applies: false, reason: 'not_in_season' }

  const week = season.currentWeek
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000)
  const [lastWeekMatchups, pendingClaims, processedClaimsLast7Days, rosters, tradesAwaitingReview, teams] = await Promise.all([
    week > 1
      ? prisma.redraftMatchup.findMany({ where: { seasonId: season.id, week: week - 1 }, select: { status: true } })
      : Promise.resolve([] as Array<{ status: string }>),
    prisma.redraftWaiverClaim.findMany({ where: { seasonId: season.id, status: 'pending' }, select: { submittedAt: true } }),
    prisma.redraftWaiverClaim.count({ where: { seasonId: season.id, status: { not: 'pending' }, processedAt: { gte: weekAgo } } }),
    prisma.redraftRoster.findMany({
      where: { seasonId: season.id },
      select: {
        id: true, teamName: true, ownerName: true,
        // Slot types are position codes (QB, RB, FLX…) in redraft, so starters are "not a reserve slot".
        players: { where: { droppedAt: null }, select: { playerName: true, slotType: true, injuryStatus: true, byeWeek: true } },
      },
    }),
    // Accepted by both sides, held for the commissioner. A league-vote trade waits on the league, not on you.
    prisma.redraftTradeProposal.count({
      where: { seasonId: season.id, status: 'pending', acceptedAt: { not: null }, vetoMode: 'commissioner' },
    }),
    prisma.leagueTeam.findMany({ where: { leagueId }, select: { id: true, teamName: true } }),
  ])

  // The same layout the scoring engine and the lineup validator size a lineup by.
  const required = [...resolveRedraftRosterConfig(String(league.sport ?? 'NFL'), league.settings).starterCapacities.values()].reduce((a, b) => a + b, 0)
  const lineups = rosters.map((r) => {
    const starters = r.players.filter((p) => isStarterSlot(p.slotType))
    return {
      teamName: r.teamName || r.ownerName || 'Unnamed team',
      required,
      filled: starters.length,
      unavailable: starters.filter((p) => isUnavailable(p, week)).map((p) => p.playerName),
    }
  })

  return {
    applies: true,
    week,
    items: buildWeeklyChecklist(
      {
        leagueId,
        week,
        totalWeeks: season.totalWeeks,
        playoffStartWeek: season.playoffStartWeek,
        lastWeekMatchups,
        pendingClaims,
        processedClaimsLast7Days,
        lineups,
        tradesAwaitingReview,
        tradeDeadlineWeek: league.tradeDeadlineWeek ?? null,
        dues: readDues(league.settings, teams, season.season),
      },
      now,
    ),
  }
}

/**
 * Unpaid teams by the SAME rule the action queue uses (lib/commissioner-workspace/inboxTasks.ts): a
 * team is paid when its entry says `paid`, or lists this season in `paidSeasons`. Null when the
 * league does not track dues.
 */
export function readDues(settings: unknown, teams: Array<{ id: string; teamName: string | null }>, season: number): { unpaid: string[]; total: number } | null {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
  const dues = s.dues_tracker && typeof s.dues_tracker === 'object' ? (s.dues_tracker as Record<string, unknown>) : null
  if (!dues || dues.enabled !== true || !teams.length) return null
  const entries = new Map(
    (Array.isArray(dues.entries) ? dues.entries : []).map((e) => {
      const r = e && typeof e === 'object' ? (e as Record<string, unknown>) : {}
      return [String(r.teamId), r] as const
    }),
  )
  const unpaid = teams.filter((t) => {
    const e = entries.get(t.id)
    return !(e && (e.paid === true || (Array.isArray(e.paidSeasons) && e.paidSeasons.map(Number).includes(season))))
  })
  return { unpaid: unpaid.map((t) => t.teamName ?? 'Unnamed team'), total: teams.length }
}
