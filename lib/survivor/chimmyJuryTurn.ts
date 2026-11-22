import 'server-only'

import { prisma } from '@/lib/prisma'
import { isChimmyRunning } from '@/lib/inactive-manager/inactiveManagerMode'
import { readPlayableChimmyLineups } from '@/lib/inactive-manager/chimmyPlayable'
import { isSeatPlaceholderUserId } from '@/lib/orphan-ai-manager/orphan-platform-ids'
import { submitJuryVote } from './SurvivorFinaleEngine'
import { getSeasonPointsFromRosterPerformance } from './SurvivorVoteEngine'
import { juryVotingHeldForSpeeches } from './survivorFinaleSettings'
import { juryQuestionId } from './survivorJuryQa'
import { answerJuryQuestion, askJuryQuestion, loadJuryQaContext, markJuryAnswerSeen, postClosingSpeech } from './survivorJuryQaService'
import { chimmyClosingSpeech, chimmyFinalistAnswer, chimmyJurorVote, chimmyJuryQuestion, chimmyLang, type ChimmyFinalistRecord } from './chimmyJury'

/** A Chimmy juror still waiting on answers votes anyway this close to the jury deadline. */
export const CHIMMY_VOTE_BEFORE_CLOSE_MS = 3 * 3_600_000

export type ChimmyFinaleTurn = { asked: number; answered: number; speeches: number; seen: number; voted: string[]; skipped: Record<string, string> }

/**
 * Chimmy's finale turn for every juror and finalist it runs. Idempotent: every write goes through the
 * same service a person uses (one question per finalist, one closing speech, one jury vote), and a
 * refused write is simply skipped. Called by the season runner on every finale tick; best-effort.
 */
export async function runChimmyFinaleTurn(leagueId: string, now = new Date()): Promise<ChimmyFinaleTurn> {
  const turn: ChimmyFinaleTurn = { asked: 0, answered: 0, speeches: 0, seen: 0, voted: [], skipped: {} }
  const ctx = await loadJuryQaContext(leagueId)
  if (!ctx.finale.open || ctx.finale.closed) return turn
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, userId: true, language: true } })
  if (!league) return turn
  const managed = await readPlayableChimmyLineups(league)
  const ids = [...new Set([...ctx.finale.finalists, ...ctx.finale.juryRosterIds])]
  const rosters = await prisma.roster.findMany({ where: { leagueId, id: { in: ids } }, select: { id: true, platformUserId: true } })
  const userOf = new Map(rosters.map((r) => [r.id, r.platformUserId]))
  const chimmyRuns = (rosterId: string) => {
    const userId = userOf.get(rosterId)
    return Boolean(userId) && isSeatPlaceholderUserId(userId) && isChimmyRunning(managed, rosterId, userId)
  }
  const chimmyJurors = ctx.finale.juryRosterIds.filter(chimmyRuns)
  const chimmyFinalists = ctx.finale.finalists.filter(chimmyRuns)
  if (!chimmyJurors.length && !chimmyFinalists.length) return turn

  const lang = chimmyLang(league.language)
  const records: ChimmyFinalistRecord[] = await Promise.all(ctx.finale.finalists.map(async (rosterId) => {
    const userId = userOf.get(rosterId) ?? null
    const [seasonPoints, immunityWins] = await Promise.all([
      getSeasonPointsFromRosterPerformance(leagueId, rosterId, ctx.week).catch(() => 0),
      userId ? prisma.survivorWeeklyScore.count({ where: { leagueId, userId, OR: [{ wonIndividualImmunity: true }, { wonTribeImmunity: true }] } }).catch(() => 0) : Promise.resolve(0),
    ])
    return { rosterId, name: ctx.names.get(rosterId) ?? 'Finalist', seasonPoints, immunityWins }
  }))

  // Finalists first: answer what was asked, then the closing speech.
  for (const rosterId of chimmyFinalists) {
    const self = records.find((r) => r.rosterId === rosterId)!
    for (const q of ctx.state.questions.filter((x) => x.finalistRosterId === rosterId && !x.answer)) {
      const res = await answerJuryQuestion(leagueId, { finalistRosterId: rosterId, jurorRosterId: q.jurorRosterId, text: chimmyFinalistAnswer(lang, self), source: 'chimmy_finale_turn' }, now)
      if (res.ok) turn.answered++
    }
    if (ctx.settings.closingSpeechesEnabled && !ctx.state.speeches.some((s) => s.finalistRosterId === rosterId)) {
      const res = await postClosingSpeech(leagueId, { finalistRosterId: rosterId, text: chimmyClosingSpeech(lang, self), source: 'chimmy_finale_turn' }, now)
      if (res.ok) turn.speeches++
      else turn.skipped[rosterId] = res.code
    }
  }

  // Jurors: one question per finalist, read the answers, then vote once voting is not held back.
  const held = juryVotingHeldForSpeeches(ctx.settings, ctx.windows, now)
  for (const rosterId of chimmyJurors) {
    for (const finalist of records) {
      if (finalist.rosterId === rosterId || ctx.state.questions.some((q) => q.id === juryQuestionId(rosterId, finalist.rosterId))) continue
      const res = await askJuryQuestion(leagueId, { jurorRosterId: rosterId, finalistRosterId: finalist.rosterId, text: chimmyJuryQuestion(lang, rosterId, finalist, records), source: 'chimmy_finale_turn' }, now)
      if (res.ok) turn.asked++
    }
    for (const q of ctx.state.questions.filter((x) => x.jurorRosterId === rosterId && x.answer && !x.seenAt)) {
      const res = await markJuryAnswerSeen(leagueId, { jurorRosterId: rosterId, finalistRosterId: q.finalistRosterId }, now)
      if (res.ok) turn.seen++
    }
    if (held || ctx.finale.votingComplete || ctx.finale.votes.some((v) => v.jurorRosterId === rosterId)) continue
    // Vote once its questions are answered, the answer window has closed, or the jury vote is
    // about to close — so Chimmy hears the finalists out but never misses the vote.
    const mine = ctx.state.questions.filter((q) => q.jurorRosterId === rosterId)
    const heardOut = mine.length > 0 && mine.every((q) => q.answer)
    const answersClosed = !ctx.settings.juryQuestionsEnabled || (ctx.windows.answersDeadline != null && now.getTime() >= new Date(ctx.windows.answersDeadline).getTime())
    // No deadline means nothing would ever close the vote: do not wait at all.
    const closingSoon = ctx.finale.votingDeadline == null || ctx.finale.votingDeadline.getTime() - now.getTime() <= CHIMMY_VOTE_BEFORE_CLOSE_MS
    if (!heardOut && !answersClosed && !closingSoon) { turn.skipped[rosterId] = 'waiting_for_answers'; continue }
    const target = chimmyJurorVote(records, rosterId)
    if (!target) { turn.skipped[rosterId] = 'no_finalist'; continue }
    const result = await submitJuryVote({ leagueId, jurorRosterId: rosterId, finalistRosterId: target, week: ctx.week, source: 'chimmy_finale_turn' })
    if (result.ok) turn.voted.push(rosterId)
    else turn.skipped[rosterId] = result.code ?? 'refused'
  }
  return turn
}
