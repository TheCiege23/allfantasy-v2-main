import 'server-only'

import { prisma } from '@/lib/prisma'
import { isChimmyRunning, readManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'
import { readExileRoster } from './exileRosterRules'
import { notifySurvivorCommissionerOnce } from './survivorCommissionerAlerts'
import { readSurvivorGovernanceSettings } from './survivorGovernanceSettings'
import { castawayNameWithTribeEmoji, tribeEmojiFor } from './survivorTribeEmoji'

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

export function chimmyWeeklyReportTitle(week: number, lang: ReportLang = 'en'): string {
  return lang === 'es' ? `La semana ${week} de Chimmy` : `Chimmy's week ${week}`
}

/**
 * The commissioner's weekly line per team Chimmy runs. Spoiler-safe like every commissioner alert: it
 * says whether Chimmy voted, never for whom, and never mentions an idol (the commissioner may be a
 * player, and who holds an idol is secret).
 */
export function chimmyWeeklyReportBody(week: number, rows: readonly ChimmyReportRow[], lang: ReportLang = 'en', sideGameLine: string | null = null): string {
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
  return [intro, ...lines, ...(sideGameLine ? [sideGameLine] : [])].join('\n')
}

/**
 * Send the week's Chimmy report to the commissioner, once per week (the alert's own dedupe), when
 * Chimmy runs at least one castaway. Called by the season runner as the week closes; best-effort.
 */
export async function sendChimmyWeeklyReport(leagueId: string, week: number): Promise<boolean> {
  const cast = await prisma.survivorPlayer.findMany({
    where: { leagueId, userId: { startsWith: SEAT_PREFIX } },
    select: { userId: true, displayName: true, playerState: true, redraftRosterId: true, tribeId: true },
  })
  if (cast.length === 0) return false
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, language: true } })
  const lang: ReportLang = String(league?.language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en'
  const managed = readManagedLineups(league?.settings)
  const chimmy = cast.filter((p) => isChimmyRunning(managed, p.redraftRosterId ?? p.userId.slice(SEAT_PREFIX.length), p.userId))
  if (chimmy.length === 0) return false

  // "Tribe emoji in names" (display only): a castaway still in a tribe shows its emoji, before the merge.
  const emojiOn = readSurvivorGovernanceSettings(league?.settings).tribeEmojiInNames
  const tribeRows = emojiOn
    ? await prisma.survivorTribe.findMany({ where: { leagueId, id: { in: chimmy.map((p) => p.tribeId).filter((id): id is string => Boolean(id)) } }, select: { id: true, name: true, catalogId: true, isMerged: true } }).catch(() => [])
    : []
  const emojiName = (p: { displayName: string; tribeId: string | null; playerState: string }) => {
    const tribe = p.playerState === 'active' ? tribeRows.find((t) => t.id === p.tribeId && !t.isMerged) : undefined
    return castawayNameWithTribeEmoji(p.displayName, tribeEmojiFor(tribe ?? null), Boolean(tribe))
  }
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
  const rows: ChimmyReportRow[] = chimmy.map((p) => {
    const voted = new Set(votes.filter((v) => v.voterUserId === p.userId).map((v) => v.councilId))
    const team = readExileRoster(entries.find((e) => e.userId === p.userId)?.submittedLineup)?.team ?? null
    const played = sideGames?.chimmy.get(p.userId)
    return {
      name: emojiName(p),
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
    dedupeKey: String(week),
    week,
    title: chimmyWeeklyReportTitle(week, lang),
    body: chimmyWeeklyReportBody(week, rows, lang, sideGames ? sideGameWeeklyReportLine(sideGames.input, lang) : null),
    deepLinkPath: `/survivor/${leagueId}`,
    urgency: 'medium',
  })
  return sent.sent
}
