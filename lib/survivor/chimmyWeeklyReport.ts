import 'server-only'

import { prisma } from '@/lib/prisma'
import { isChimmyRunning, readManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'
import { readExileRoster } from './exileRosterRules'
import { notifySurvivorCommissionerOnce } from './survivorCommissionerAlerts'

const SEAT_PREFIX = 'orphan-'

export type ChimmyReportRow = {
  name: string
  /** SurvivorPlayer.playerState: active, exile, eliminated, jury, survivor_winner… */
  state: string
  /** Councils Chimmy voted at this week. */
  voted: number
  exileTeam: string | null
}

const STATE_LABEL: Record<string, string> = {
  active: 'still in the game',
  exile: 'on Exile Island',
  eliminated: 'out of the game',
  jury: 'on the jury',
  survivor_winner: 'the Sole Survivor',
}

/**
 * The commissioner's weekly line per team Chimmy runs. Spoiler-safe like every commissioner alert: it
 * says whether Chimmy voted, never for whom, and never mentions an idol (the commissioner may be a
 * player, and who holds an idol is secret).
 */
export function chimmyWeeklyReportBody(week: number, rows: readonly ChimmyReportRow[]): string {
  const lines = rows.map((r) => {
    const parts = [STATE_LABEL[r.state] ?? r.state]
    if (r.voted > 0) parts.push(r.voted === 1 ? 'voted at Tribal Council' : `voted at ${r.voted} Tribal Councils`)
    if (r.exileTeam) parts.push(`played ${r.exileTeam} on Exile`)
    return `${r.name}: ${parts.join(', ')}.`
  })
  return [`Here is what Chimmy did for its ${rows.length === 1 ? 'team' : `${rows.length} teams`} in week ${week}.`, ...lines].join('\n')
}

/**
 * Send the week's Chimmy report to the commissioner, once per week (the alert's own dedupe), when
 * Chimmy runs at least one castaway. Called by the season runner as the week closes; best-effort.
 */
export async function sendChimmyWeeklyReport(leagueId: string, week: number): Promise<boolean> {
  const cast = await prisma.survivorPlayer.findMany({
    where: { leagueId, userId: { startsWith: SEAT_PREFIX } },
    select: { userId: true, displayName: true, playerState: true, redraftRosterId: true },
  })
  if (cast.length === 0) return false
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const managed = readManagedLineups(league?.settings)
  const chimmy = cast.filter((p) => isChimmyRunning(managed, p.redraftRosterId ?? p.userId.slice(SEAT_PREFIX.length), p.userId))
  if (chimmy.length === 0) return false

  const userIds = chimmy.map((p) => p.userId)
  const councils = await prisma.survivorTribalCouncil.findMany({ where: { leagueId, week }, select: { id: true } })
  const councilIds = councils.map((c) => c.id)
  const [votes, entries] = await Promise.all([
    councilIds.length
      ? prisma.survivorVote.findMany({ where: { councilId: { in: councilIds }, voterUserId: { in: userIds } }, select: { councilId: true, voterUserId: true } })
      : Promise.resolve([]),
    prisma.exileWeeklyEntry.findMany({ where: { leagueId, week, userId: { in: userIds } }, select: { userId: true, submittedLineup: true } }),
  ])

  const rows: ChimmyReportRow[] = chimmy.map((p) => {
    const voted = new Set(votes.filter((v) => v.voterUserId === p.userId).map((v) => v.councilId))
    const team = readExileRoster(entries.find((e) => e.userId === p.userId)?.submittedLineup)?.team ?? null
    return { name: p.displayName, state: p.playerState, voted: voted.size, exileTeam: team }
  })
  const sent = await notifySurvivorCommissionerOnce(leagueId, 'chimmy_weekly_report', {
    dedupeKey: String(week),
    week,
    title: `Chimmy's week ${week}`,
    body: chimmyWeeklyReportBody(week, rows),
    deepLinkPath: `/survivor/${leagueId}`,
    urgency: 'medium',
  })
  return sent.sent
}
