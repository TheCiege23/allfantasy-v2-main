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
  /** Commissioner challenges Chimmy answered for this seat this week (optional; older callers omit it). */
  challenges?: number
}

type ReportLang = 'en' | 'es'

const STATE_LABEL: Record<ReportLang, Record<string, string>> = {
  en: {
    active: 'still in the game',
    exile: 'on Exile Island',
    eliminated: 'out of the game',
    jury: 'on the jury',
    survivor_winner: 'the Sole Survivor',
  },
  es: {
    active: 'sigue en el juego',
    exile: 'en la Isla del Exilio',
    eliminated: 'fuera del juego',
    jury: 'en el jurado',
    survivor_winner: 'el Único Superviviente',
  },
}

export function chimmyWeeklyReportTitle(week: number, lang: ReportLang = 'en'): string {
  return lang === 'es' ? `La semana ${week} de Chimmy` : `Chimmy's week ${week}`
}

/**
 * The commissioner's weekly line per team Chimmy runs. Spoiler-safe like every commissioner alert: it
 * says whether Chimmy voted, never for whom, and never mentions an idol (the commissioner may be a
 * player, and who holds an idol is secret).
 */
export function chimmyWeeklyReportBody(week: number, rows: readonly ChimmyReportRow[], lang: ReportLang = 'en'): string {
  const es = lang === 'es'
  const lines = rows.map((r) => {
    const parts = [STATE_LABEL[lang][r.state] ?? r.state]
    if (r.voted > 0) {
      parts.push(es
        ? (r.voted === 1 ? 'votó en el Consejo Tribal' : `votó en ${r.voted} Consejos Tribales`)
        : (r.voted === 1 ? 'voted at Tribal Council' : `voted at ${r.voted} Tribal Councils`))
    }
    if (r.exileTeam) parts.push(es ? `jugó con ${r.exileTeam} en el Exilio` : `played ${r.exileTeam} on Exile`)
    if (r.challenges && r.challenges > 0) parts.push(es ? (r.challenges === 1 ? 'respondió un reto' : `respondió ${r.challenges} retos`) : (r.challenges === 1 ? 'answered a challenge' : `answered ${r.challenges} challenges`))
    return `${r.name}: ${parts.join(', ')}.`
  })
  const intro = es
    ? `Esto es lo que hizo Chimmy por ${rows.length === 1 ? 'su equipo' : `sus ${rows.length} equipos`} en la semana ${week}.`
    : `Here is what Chimmy did for its ${rows.length === 1 ? 'team' : `${rows.length} teams`} in week ${week}.`
  return [intro, ...lines].join('\n')
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
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, language: true } })
  const lang: ReportLang = String(league?.language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en'
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

  // Challenges Chimmy answered for each seat (the challenge builder's audit rows). Best-effort.
  const answered = await import('./survivorChallengeBuilder')
    .then(({ countChimmyChallengeAnswers }) => countChimmyChallengeAnswers(leagueId, week, chimmy.flatMap((p) => (p.redraftRosterId ? [p.redraftRosterId] : []))))
    .catch(() => new Map<string, number>())
  const rows: ChimmyReportRow[] = chimmy.map((p) => {
    const voted = new Set(votes.filter((v) => v.voterUserId === p.userId).map((v) => v.councilId))
    const team = readExileRoster(entries.find((e) => e.userId === p.userId)?.submittedLineup)?.team ?? null
    return { name: p.displayName, state: p.playerState, voted: voted.size, exileTeam: team, challenges: p.redraftRosterId ? answered.get(p.redraftRosterId) ?? 0 : 0 }
  })
  const sent = await notifySurvivorCommissionerOnce(leagueId, 'chimmy_weekly_report', {
    dedupeKey: String(week),
    week,
    title: chimmyWeeklyReportTitle(week, lang),
    body: chimmyWeeklyReportBody(week, rows, lang),
    deepLinkPath: `/survivor/${leagueId}`,
    urgency: 'medium',
  })
  return sent.sent
}
