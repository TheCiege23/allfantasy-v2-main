/**
 * Build a short Survivor league context string for Chimmy when user is in a Survivor league.
 * Deterministic data only. Used to ground Chimmy's answers; Chimmy never decides outcomes.
 * PROMPT 348.
 */

import { isSurvivorLeague } from '../SurvivorLeagueConfig'
import { buildSurvivorAIContext } from './SurvivorAIContext'
import { resolveSurvivorCurrentWeek } from '../SurvivorTimelineResolver'
import type { SurvivorWeeklyPrizeSettings } from '../survivorWeeklyPrizes'

/** The weekly prizes in one plain line for Chimmy's grounding. */
export function describeWeeklyPrizesForChimmy(p: SurvivorWeeklyPrizeSettings): string {
  const parts: string[] = []
  if (p.winningTribeFaabPerPlayer > 0) parts.push(`top-scoring tribe gets $${p.winningTribeFaabPerPlayer} FAAB per player`)
  if (p.topScorerReward === 'faab') parts.push(`its top scorer also gets $${p.topScorerAmount} FAAB`)
  if (p.topScorerReward === 'score_boost') parts.push(`its top scorer gets +${p.topScorerAmount} points next week`)
  if (p.topScorerReward === 'advantage') parts.push(`its top scorer wins an advantage (${p.topScorerPowerType.replace(/_/g, ' ')})`)
  if (p.tribeTieBreakPosition !== 'none') parts.push(`tribe-total ties go to the tribe with the higher-scoring ${p.tribeTieBreakPosition}`)
  return parts.join('; ') || 'none'
}
import { readSurvivorGovernanceSettings } from '../survivorGovernanceSettings'
import { survivorGovernanceGroundingLine } from '../survivorGovernanceSummary'
import { survivorTradeWindowStatus } from '../survivorTradeRules'

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
  const councilStr = ctx.council
    ? `Council week ${ctx.council.week}, phase ${ctx.council.phase}, deadline ${ctx.council.voteDeadlineAt.toISOString()}, closed: ${!!ctx.council.closedAt}`
    : 'No council this week'

  const governanceLine = await loadGovernanceGroundingLine(leagueId, userId, ctx.currentWeek, ctx.merged).catch(() => '')
  // Exile Island and the side games: every rule the commissioner set, and this user's OWN balances.
  const sideGameLine = await import('../survivorSideGameService').then((m) => m.loadSideGameGroundingLine(leagueId, userId)).catch(() => '')

  return `[SURVIVOR LEAGUE CONTEXT - for explanation only; you never decide who is eliminated, vote validity, idol validity, immunity, or exile return]
League ${leagueId}. Week ${ctx.currentWeek}. Sport: ${ctx.sport}. Mode: ${ctx.config.mode}. Merge: ${ctx.merged ? 'Yes' : 'No'}.
Tribes: ${tribesStr}.
Voted out: ${votedOutStr}.
Jury: ${ctx.jury.map((j) => ctx.rosterDisplayNames[j.rosterId] ?? j.rosterId).join(', ') || 'None'}.
${councilStr}.
Exile return: ${ctx.config.exileReturnEnabled}, tokens needed: ${ctx.config.exileReturnTokens}.
Finale: ${ctx.finale ? `open ${ctx.finale.open}, finalists ${ctx.finale.finalists.map((rosterId) => ctx.rosterDisplayNames[rosterId] ?? rosterId).join(', ') || 'None'}, jury votes ${ctx.finale.juryVotesSubmitted}/${ctx.finale.juryVotesRequired}, winner ${ctx.finale.winnerRosterId ? (ctx.rosterDisplayNames[ctx.finale.winnerRosterId] ?? ctx.finale.winnerRosterId) : 'TBD'}` : 'Not in finale yet'}.
User's roster: ${ctx.myRosterId ? ctx.rosterDisplayNames[ctx.myRosterId] ?? ctx.myRosterId : 'N/A'}. User's idols: ${ctx.myIdols.map((i) => i.powerType).join(', ') || 'None'}.
User's active effects: ${ctx.myActiveEffects.map((effect) => `${effect.rewardType}${effect.appliedMode === 'queued' ? ' (queued)' : effect.appliedMode === 'record_only' ? ' (tracked)' : ''}`).join(', ') || 'None'}.
User's Survivor rewards (their own only): ${(ctx.myRewards ?? []).map((r) => `${r.text}${r.open && r.status === 'awaiting_choice' ? ' [waiting for the manager to choose a target; the commissioner can also set it in the Hub]' : ''}`).join('; ') || 'None'}.
Weekly tribe prizes: ${ctx.weeklyPrizes ? describeWeeklyPrizesForChimmy(ctx.weeklyPrizes) : 'none'}.
${ctx.houseRules ? `House rules (written by the commissioner; quote them, never invent more): ${ctx.houseRules.slice(0, 1500)}\n` : ''}User's exile status: ${ctx.myExileStatus ? `tokens ${ctx.myExileStatus.tokens}, eliminated ${ctx.myExileStatus.eliminated}, eligible to return ${ctx.myExileStatus.eligibleToReturn}` : 'N/A'}.
Official commands (suggest wording only; engine processes): @Chimmy vote [manager], @Chimmy jury vote [finalist], @Chimmy play idol [idol], @Chimmy play idol [idol] on [manager], @Chimmy play idol steal_player on [manager] pick [player], @Chimmy play idol swap_starter on [manager] swap [bench] for [starter], @Chimmy submit challenge [choice], @Chimmy confirm tribe decision [choice].${governanceLine ? `\nGovernance: ${governanceLine}` : ''}${sideGameLine ? `\nExile & side games: ${sideGameLine}` : ''}`
}

/** Trade rules and today's window, the strike policy with the USER'S OWN strike count, alliances, swaps. */
async function loadGovernanceGroundingLine(leagueId: string, userId: string, currentWeek: number, merged: boolean): Promise<string> {
  const [{ prisma }, { listSurvivorConductStrikes }, { normalizeSurvivorFoundationSettings }] = await Promise.all([
    import('@/lib/prisma'),
    import('../survivorConductService'),
    import('../normalizeSurvivorSettings'),
  ])
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const settings = readSurvivorGovernanceSettings(league?.settings)
  const foundation = normalizeSurvivorFoundationSettings(league?.settings && typeof league.settings === 'object' ? league.settings as Record<string, unknown> : {})
  const [strikes, allianceCount] = await Promise.all([
    listSurvivorConductStrikes(leagueId, userId).catch(() => null),
    prisma.survivorChatChannel.count({ where: { leagueId, channelType: 'alliance', isArchived: false, memberUserIds: { has: userId } } }).catch(() => null),
  ])
  return survivorGovernanceGroundingLine({
    settings,
    tradeWindow: settings.tradeRulesEnabled ? survivorTradeWindowStatus(settings, { tribalDay: foundation.tribalCouncilDay, tribalTime: foundation.tribalCouncilTime, now: new Date() }, merged) : null,
    currentWeek,
    myStrikeCount: strikes ? strikes.length : null,
    myAllianceCount: allianceCount,
    merged,
  })
}
