import 'server-only'

import { prisma } from '@/lib/prisma'
import { deriveSurvivorFinaleSignals } from '@/lib/decision-os/survivorFinaleSignals'
import type { DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'
import { loadCouncilContext } from './survivorCouncilService'
import { getJuryQaView } from './survivorJuryQaService'

/**
 * Read the persisted Survivor state the finale signals interpret (lib/decision-os/survivorFinaleSignals.ts)
 * for one manager across their leagues. Read-only, DB-only, never throws: a league that fails to read
 * simply contributes no signal. Only Survivor leagues are touched, so a manager with none costs one query.
 */
export async function loadSurvivorFinaleSignals(userId: string, leagueIds: readonly string[], now = new Date()): Promise<DecisionOsAttentionSignal[]> {
  if (!leagueIds.length) return []
  const leagues = await prisma.league.findMany({ where: { id: { in: [...leagueIds] }, survivorMode: true }, select: { id: true } }).catch(() => [])
  const out: DecisionOsAttentionSignal[] = []
  await Promise.all(leagues.map(async ({ id: leagueId }) => {
    try {
      const [qa, council] = await Promise.all([
        getJuryQaView(leagueId, userId, now).catch(() => null),
        loadCouncilContext(leagueId).catch(() => null),
      ])
      let ballotOwed = false
      let ballotsDueAt: string | null = null
      if (council && council.council.status === 'voting_open' && council.eligibility.voterUserIds.includes(userId)) {
        const voterRosterId = council.userToRoster[userId]
        const own = voterRosterId ? await prisma.survivorVote.findUnique({ where: { councilId_voterRosterId: { councilId: council.council.id, voterRosterId } }, select: { id: true } }) : null
        ballotOwed = !own
        ballotsDueAt = (council.ballotsDueAt ?? council.council.voteDeadlineAt).toISOString()
      }
      const live = Boolean(qa?.finaleOpen && !qa.voteComplete)
      out.push(...deriveSurvivorFinaleSignals({
        leagueId,
        now,
        questionsToAsk: live && qa?.settings.juryQuestionsEnabled ? qa.viewer.todo.questionsToAsk.length : 0,
        questionsDeadline: qa?.windows.questionsDeadline ?? null,
        questionWindowOpen: qa?.windows.questionState === 'open',
        questionsToAnswer: live && qa?.settings.juryQuestionsEnabled ? qa.viewer.todo.questionsToAnswer.length : 0,
        answersDeadline: qa?.windows.answersDeadline ?? null,
        answerWindowOpen: qa?.windows.answerState === 'open',
        speechMissing: live && Boolean(qa?.viewer.todo.speechMissing),
        speechesDeadline: qa?.windows.speechesDeadline ?? null,
        speechWindowOpen: qa?.windows.speechState === 'open',
        ballotOwed,
        ballotsDueAt,
      }))
    } catch {
      // honest degradation: no signal for this league
    }
  }))
  return out
}
