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
  /** Side games (survivorSideGameRunner.ts): Token Pool picks, a Survivor Pool pick, auction bids. */
  tokenPoolPicks?: number
  poolPicked?: boolean
  auctionBids?: number
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

/** The finale's progress for the commissioner: counts only, never whose question or whose ballot. */
export type FinaleReportProgress = {
  questionsAsked: number
  questionsAnswered: number
  speechesPosted: number
  finalists: number
  votesIn: number
  votesRequired: number
}

/** The jury/finale line in the commissioner's report while the finale is open. EN and ES. */
export function finaleReportLine(p: FinaleReportProgress, lang: ReportLang = 'en'): string {
  if (lang === 'es') {
    return `Final: ${p.questionsAsked} ${p.questionsAsked === 1 ? 'pregunta' : 'preguntas'} del jurado, ${p.questionsAnswered} ${p.questionsAnswered === 1 ? 'respondida' : 'respondidas'}; ${p.speechesPosted} de ${p.finalists} discursos finales publicados; ${p.votesIn} de ${p.votesRequired} votos del jurado recibidos.`
  }
  return `Finale: ${p.questionsAsked} jury ${p.questionsAsked === 1 ? 'question' : 'questions'} asked, ${p.questionsAnswered} answered; ${p.speechesPosted} of ${p.finalists} closing speeches posted; ${p.votesIn} of ${p.votesRequired} jury votes in.`
}

export function chimmyWeeklyReportTitle(week: number, lang: ReportLang = 'en'): string {
  return lang === 'es' ? `La semana ${week} de Chimmy` : `Chimmy's week ${week}`
}

/**
 * The commissioner's weekly line per team Chimmy runs. Spoiler-safe like every commissioner alert: it
 * says whether Chimmy voted, never for whom, and never mentions an idol (the commissioner may be a
 * player, and who holds an idol is secret).
 */
export function chimmyWeeklyReportBody(
  week: number,
  rows: readonly ChimmyReportRow[],
  lang: ReportLang = 'en',
  sideGameLine: string | null = null,
  finaleLine: string | null = null,
  rewardsLine: string | null = null,
): string {
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
    if (r.tokenPoolPicks) parts.push(es ? `hizo ${r.tokenPoolPicks} ${r.tokenPoolPicks === 1 ? 'elección' : 'elecciones'} en el Pozo de Fichas` : `made ${r.tokenPoolPicks} Token Pool ${r.tokenPoolPicks === 1 ? 'pick' : 'picks'}`)
    if (r.poolPicked) parts.push(es ? 'eligió en el Pozo Survivor' : 'made its Survivor Pool pick')
    if (r.auctionBids) parts.push(es ? `pujó ${r.auctionBids} ${r.auctionBids === 1 ? 'vez' : 'veces'} en subastas` : `placed ${r.auctionBids} auction ${r.auctionBids === 1 ? 'bid' : 'bids'}`)
    return `${r.name}: ${parts.join(', ')}.`
  })
  const intro = es
    ? `Esto es lo que hizo Chimmy por ${rows.length === 1 ? 'su equipo' : `sus ${rows.length} equipos`} en la semana ${week}.`
    : `Here is what Chimmy did for its ${rows.length === 1 ? 'team' : `${rows.length} teams`} in week ${week}.`
  // During the finale the report can go out with no Chimmy seat at all: then it is the finale line
  // (and the league-wide side-game / rewards lines) without the per-seat intro.
  if (rows.length === 0) {
    return [...(finaleLine ? [finaleLine] : []), ...(sideGameLine ? [sideGameLine] : []), ...(rewardsLine ? [rewardsLine] : [])].join('\n')
  }
  // Side games, then rewards, then the finale line, which always rides at the end.
  return [intro, ...lines, ...(sideGameLine ? [sideGameLine] : []), ...(rewardsLine ? [rewardsLine] : []), ...(finaleLine ? [finaleLine] : [])].join('\n')
}

/**
 * Send the week's Chimmy report to the commissioner, once per week (the alert's own dedupe), when
 * Chimmy runs at least one castaway. Called by the season runner as the week closes; best-effort.
 */
export async function sendChimmyWeeklyReport(leagueId: string, week: number, opts: { finale?: boolean; dedupeKey?: string } = {}): Promise<boolean> {
  const cast = await prisma.survivorPlayer.findMany({
    where: { leagueId, userId: { startsWith: SEAT_PREFIX } },
    select: { userId: true, displayName: true, playerState: true, redraftRosterId: true },
  })
  if (cast.length === 0 && !opts.finale) return false
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, language: true } })
  const lang: ReportLang = String(league?.language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en'
  const managed = readManagedLineups(league?.settings)
  const chimmy = cast.filter((p) => isChimmyRunning(managed, p.redraftRosterId ?? p.userId.slice(SEAT_PREFIX.length), p.userId))
  // The finale's progress (counts only). Best-effort: a failed read leaves the report as it was.
  const finaleLine = opts.finale ? await loadFinaleReportProgress(leagueId).then((p) => (p ? finaleReportLine(p, lang) : null)).catch(() => null) : null
  if (chimmy.length === 0 && !finaleLine) return false

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
  // Side games: what Chimmy played for each seat, and the league's one-line side-game summary.
  // Best-effort: a failed read leaves the report exactly as it was.
  const { loadSideGameReportData } = await import('./survivorSideGameService')
  const { sideGameWeeklyReportLine } = await import('./survivorSideGameSummary')
  const sideGames = await loadSideGameReportData(leagueId, week).catch(() => null)
  // Rewards: paid this week, pending choices, reversals (counts only). Best-effort.
  const rewardsLine = await Promise.all([import('./survivorRewardEngine'), import('./survivorRewardReport')])
    .then(async ([{ listSurvivorRewards }, { rewardsWeeklyReportLine }]) => rewardsWeeklyReportLine(await listSurvivorRewards(leagueId), week, lang))
    .catch(() => null)
  const rows: ChimmyReportRow[] = chimmy.map((p) => {
    const voted = new Set(votes.filter((v) => v.voterUserId === p.userId).map((v) => v.councilId))
    const team = readExileRoster(entries.find((e) => e.userId === p.userId)?.submittedLineup)?.team ?? null
    const played = sideGames?.chimmy.get(p.userId)
    return {
      name: p.displayName,
      state: p.playerState,
      voted: voted.size,
      exileTeam: team,
      challenges: p.redraftRosterId ? answered.get(p.redraftRosterId) ?? 0 : 0,
      tokenPoolPicks: played?.tokenPoolPicks,
      poolPicked: played?.poolPicked,
      auctionBids: played?.auctionBids,
    }
  })
  const sent = await notifySurvivorCommissionerOnce(leagueId, 'chimmy_weekly_report', {
    dedupeKey: opts.dedupeKey ?? String(week),
    week,
    title: chimmyWeeklyReportTitle(week, lang),
    body: chimmyWeeklyReportBody(week, rows, lang, sideGames ? sideGameWeeklyReportLine(sideGames.input, lang) : null, finaleLine, rewardsLine),
    deepLinkPath: `/survivor/${leagueId}`,
    urgency: 'medium',
  })
  return sent.sent
}

/** Counts for the finale line, from the jury Q&A fold and the finale state. Null when the finale is not open. */
async function loadFinaleReportProgress(leagueId: string): Promise<FinaleReportProgress | null> {
  const { loadJuryQaContext } = await import('./survivorJuryQaService')
  const ctx = await loadJuryQaContext(leagueId)
  if (!ctx.finale.open || ctx.finale.closed) return null
  return {
    questionsAsked: ctx.state.questions.length,
    questionsAnswered: ctx.state.questions.filter((q) => q.answer).length,
    speechesPosted: ctx.state.speeches.length,
    finalists: ctx.finale.finalists.length,
    votesIn: ctx.finale.votesSubmitted,
    votesRequired: ctx.finale.votesRequired,
  }
}
