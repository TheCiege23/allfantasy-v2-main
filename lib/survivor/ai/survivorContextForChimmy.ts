/**
 * Build a short Survivor league context string for Chimmy when user is in a Survivor league.
 * Deterministic data only. Used to ground Chimmy's answers; Chimmy never decides outcomes.
 * PROMPT 348.
 */

import { isSurvivorLeague } from '../SurvivorLeagueConfig'
import { buildSurvivorAIContext } from './SurvivorAIContext'
import { resolveSurvivorCurrentWeek } from '../SurvivorTimelineResolver'

/**
 * Returns a plain-text summary of the Survivor league state for injection into Chimmy's context.
 * If league is not survivor or context fails, returns empty string.
 */
export async function buildSurvivorContextForChimmy(
  leagueId: string,
  userId: string
): Promise<string> {
  const isSurvivor = await isSurvivorLeague(leagueId)
  if (!isSurvivor) return ''

  const currentWeek = await resolveSurvivorCurrentWeek(leagueId)

  const ctx = await buildSurvivorAIContext({
    leagueId,
    currentWeek,
    userId,
  })
  if (!ctx) return ''

  const tribesStr = ctx.tribes
    .map(
      (t) =>
        `${t.name}: ${t.members.map((m) => `${ctx.rosterDisplayNames[m.rosterId] ?? m.rosterId}${m.isLeader ? ' (leader)' : ''}`).join(', ')}`
    )
    .join(' | ')
  const votedOutStr = ctx.votedOutHistory
    .map((e) => `Week ${e.week}: ${ctx.rosterDisplayNames[e.rosterId] ?? e.rosterId}`)
    .join('; ') || 'None'
  // Finale rules and this manager's own finale to-do (counts only; never another juror's question or a ballot).
  const qa = await import('../survivorJuryQaService').then(({ getJuryQaView }) => getJuryQaView(leagueId, userId)).catch(() => null)
  const finaleRules = await import('../survivorFinaleSettings').then(async ({ readSurvivorFinaleSettings }) => {
    const { prisma } = await import('@/lib/prisma')
    const row = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    return readSurvivorFinaleSettings(row?.settings)
  }).catch(() => null)
  const finaleRulesStr = finaleRules
    ? `Finale rules: jury questions ${finaleRules.juryQuestionsEnabled ? 'on (one per juror per finalist)' : 'off'}; closing speeches ${finaleRules.closingSpeechesEnabled ? 'on (one per finalist, editable until the speech window closes)' : 'off'}; sealed immunity ${finaleRules.sealedImmunity ? 'on (individual immunity hidden until every vote is in — never say who holds it)' : 'off'}; ballots due ${finaleRules.votesDueHoursBeforeCeremony > 0 ? `${finaleRules.votesDueHoursBeforeCeremony}h before the Torch Ceremony` : 'at the Torch Ceremony'}; end-of-season ballot reveal ${finaleRules.endOfSeasonBallotReveal ? 'on (only after the champion is crowned)' : 'off'}; reunion chat ${finaleRules.reunionChatEnabled ? 'on' : 'off'}.`
    : ''
  const qaStr = qa
    ? `Finale windows: questions ${qa.windows.questionState}${qa.windows.questionsDeadline ? ` until ${qa.windows.questionsDeadline}` : ''}, answers ${qa.windows.answerState}${qa.windows.answersDeadline ? ` until ${qa.windows.answersDeadline}` : ''}, closing speeches ${qa.windows.speechState}${qa.windows.speechesDeadline ? ` until ${qa.windows.speechesDeadline}` : ''}${qa.windows.votingHeldForSpeeches ? ', jury voting opens when speeches close' : ''}. User's finale to-do: ${qa.viewer.todo.questionsToAsk.length} question(s) to ask, ${qa.viewer.todo.questionsToAnswer.length} to answer, ${qa.viewer.todo.answersToRead.length} answer(s) to mark seen, closing speech ${qa.viewer.todo.speechMissing ? 'not posted' : 'n/a or posted'}.`
    : ''
  const councilStr = ctx.council
    ? `Council week ${ctx.council.week}, phase ${ctx.council.phase}, deadline ${ctx.council.voteDeadlineAt.toISOString()}, closed: ${!!ctx.council.closedAt}`
    : 'No council this week'

  return `[SURVIVOR LEAGUE CONTEXT - for explanation only; you never decide who is eliminated, vote validity, idol validity, immunity, or exile return]
League ${leagueId}. Week ${ctx.currentWeek}. Sport: ${ctx.sport}. Mode: ${ctx.config.mode}. Merge: ${ctx.merged ? 'Yes' : 'No'}.
Tribes: ${tribesStr}.
Voted out: ${votedOutStr}.
Jury: ${ctx.jury.map((j) => ctx.rosterDisplayNames[j.rosterId] ?? j.rosterId).join(', ') || 'None'}.
${councilStr}.
Exile return: ${ctx.config.exileReturnEnabled}, tokens needed: ${ctx.config.exileReturnTokens}.
Finale: ${ctx.finale ? `open ${ctx.finale.open}, finalists ${ctx.finale.finalists.map((rosterId) => ctx.rosterDisplayNames[rosterId] ?? rosterId).join(', ') || 'None'}, jury votes ${ctx.finale.juryVotesSubmitted}/${ctx.finale.juryVotesRequired}, winner ${ctx.finale.winnerRosterId ? (ctx.rosterDisplayNames[ctx.finale.winnerRosterId] ?? ctx.finale.winnerRosterId) : 'TBD'}` : 'Not in finale yet'}.
${finaleRulesStr}
${qaStr}
User's roster: ${ctx.myRosterId ? ctx.rosterDisplayNames[ctx.myRosterId] ?? ctx.myRosterId : 'N/A'}. User's idols: ${ctx.myIdols.map((i) => i.powerType).join(', ') || 'None'}.
User's active effects: ${ctx.myActiveEffects.map((effect) => `${effect.rewardType}${effect.appliedMode === 'queued' ? ' (queued)' : effect.appliedMode === 'record_only' ? ' (tracked)' : ''}`).join(', ') || 'None'}.
User's exile status: ${ctx.myExileStatus ? `tokens ${ctx.myExileStatus.tokens}, eliminated ${ctx.myExileStatus.eliminated}, eligible to return ${ctx.myExileStatus.eligibleToReturn}` : 'N/A'}.
Official commands (suggest wording only; engine processes): @Chimmy vote [manager], @Chimmy jury vote [finalist], @Chimmy play idol [idol], @Chimmy play idol [idol] on [manager], @Chimmy play idol steal_player on [manager] pick [player], @Chimmy play idol swap_starter on [manager] swap [bench] for [starter], @Chimmy submit challenge [choice], @Chimmy confirm tribe decision [choice].`
}
