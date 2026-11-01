/**
 * Private @Chimmy routing — never leaks hidden game state.
 * Handles: idol plays, voting, status checks, rule questions.
 * Settings-aware: reads commissioner config to answer league-specific questions.
 *
 * COMMISSIONER BLIND MODE: If commissioner is participating as a player,
 * @Chimmy NEVER reveals who has idols, vote counts, or any hidden info to them.
 * The system handles vote counting autonomously.
 */

import { prisma } from '@/lib/prisma'
import { applyIdolPower } from './SurvivorIdolRegistry'
import { resolveSurvivorCurrentWeek } from './SurvivorTimelineResolver'
import { getCouncil } from './SurvivorTribalCouncilService'
import { postIdolPlayAnnouncement } from './leagueChatPoster'
import { IDOL_POWER_DESCRIPTIONS, EXILE_KEY_POSITION_BY_SPORT } from './constants'
import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'
import { loadSurvivorRulesContext } from './survivorRulesContext'
import { answerSurvivorRules, survivorRulesTopic, type SurvivorRulesTopic } from './survivorRulesAnswers'
import { readSurvivorGovernanceSettings } from './survivorGovernanceSettings'
import { governanceLang } from './survivorGovernanceCopy'

const FORBIDDEN =
  "I can't share that — information is currency out here."

export async function handleChimmyPrivateMessage(leagueId: string, userId: string, message: string): Promise<string> {
  const lower = message.toLowerCase()
  const player = await prisma.survivorPlayer.findFirst({ where: { leagueId, userId } })
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { survivorPhase: true, sport: true },
  })

  // Block probing for others' idols
  if (
    lower.includes('idol') &&
    (lower.includes('other') || lower.includes('anyone') || lower.includes('who has'))
  ) {
    await prisma.survivorHostMessage.create({
      data: {
        leagueId,
        channelType: 'private',
        messageType: 'forbidden_probe',
        content: message.slice(0, 500),
        targetUserId: userId,
        isPosted: false,
      },
    })
    return FORBIDDEN
  }

  // Block vote count probing
  if (lower.includes('vote count') || lower.includes('tally')) {
    return FORBIDDEN
  }

  // ===== MY STRIKES =====
  // Only the asker's own strikes, ever: nobody learns another castaway's conduct record from me.
  if (MY_STRIKES.test(lower)) return answerMyStrikes(leagueId, userId)

  // ===== RULES QUESTIONS =====
  // A question is answered, never acted on: "how do I play my idol?" must not play it. Built from
  // this league's settings and plan, so anyone in the league (out of the game or not) can ask.
  const topic = survivorRulesTopic(message)
  if (topic && RULES_QUESTION.test(lower.trim())) return answerRulesForLeague(leagueId, topic, league?.sport ?? 'NFL')

  // ===== IDOL PLAY REQUEST =====
  // Matches: "use my idol", "play my idol", "i want to use my idol", "activate idol"
  if (
    (lower.includes('use') || lower.includes('play') || lower.includes('activate')) &&
    lower.includes('idol')
  ) {
    // "Can I play my idol now?" asks; it does not play.
    if (lower.trim().endsWith('?')) return 'To play an idol, message me "use my idol" while Tribal Council is open, before votes are read. If it needs a target, tap Play Idol on the open council instead.'
    if (!player) return 'You are not registered as a Survivor player in this league.'
    if (player.playerState === 'eliminated') return 'Your journey has ended — you can no longer play idols.'

    const roster = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: userId },
      select: { id: true },
    })
    if (!roster) return 'No roster found for you in this league.'

    const playable = await prisma.survivorIdol.findMany({
      where: { leagueId, rosterId: roster.id, status: { in: ['hidden', 'revealed'] }, isUsed: false },
      select: { id: true, powerType: true, powerLabel: true },
    })
    if (playable.length === 0) return 'You currently hold no idols to play.'

    const currentWeek = await resolveSurvivorCurrentWeek(leagueId)
    const council = typeof currentWeek === 'number' ? await getCouncil(leagueId, currentWeek) : null
    if (!council || council.closedAt || new Date() > council.voteDeadlineAt) {
      return 'Idols can only be played during an active Elimination Council before the vote deadline. Wait for the next council.'
    }

    // Auto-play only when unambiguous: one idol + no target needed (self-protect).
    const selfOnly = playable.filter((i) => i.powerType === 'protect_self')
    if (playable.length === 1 && selfOnly.length === 1) {
      const idol = playable[0]
      const result = await applyIdolPower(leagueId, idol.id, roster.id, {
        councilId: council.id,
        week: currentWeek,
      })
      if (!result.ok) return `I could not play that idol: ${result.error ?? 'unknown error'}`
      await postIdolPlayAnnouncement(
        leagueId,
        `${player.displayName} has played an idol!`,
        player.displayName,
        idol.powerType,
      ).catch(() => {})
      return `Your **${idol.powerLabel ?? idol.powerType}** has been played. The tribe will see its effect when votes are read.`
    }

    const lines = playable.map((i) => `• **${i.powerLabel ?? i.powerType}**`).join('\n')
    return `You have multiple powers or a power that needs a target — open the active Elimination Council and tap "Play Idol" to choose the idol and target.\n${lines}`
  }

  // ===== CHECK MY IDOLS =====
  // Matches: "do i have an idol", "my idols", "what powers do i have", "my inventory"
  if (
    (lower.includes('my idol') || lower.includes('my power') || lower.includes('do i have') ||
     lower.includes('my inventory') || lower.includes('what idol'))
  ) {
    if (!player) return 'You are not registered as a Survivor player in this league.'
    const roster = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: userId },
      select: { id: true },
    })
    if (!roster) return 'No roster found for you.'

    const idols = await prisma.survivorIdol.findMany({
      where: { leagueId, rosterId: roster.id, status: { in: ['hidden', 'revealed'] }, isUsed: false },
      select: { powerType: true, powerLabel: true, powerDesc: true },
    })

    if (idols.length === 0) {
      return 'You currently hold no idols or advantages.'
    }

    const lines = idols.map((i) => {
      const name = i.powerLabel ?? i.powerType.replace(/_/g, ' ')
      const desc = i.powerDesc ?? IDOL_POWER_DESCRIPTIONS[i.powerType] ?? ''
      return `• **${name}**: ${desc}`
    })
    return `Your powers:\n${lines.join('\n')}\n\nTo play an idol, message me: "I want to use my idol" before tribal votes are counted.`
  }

  // ===== VOTE REDIRECT =====
  if (lower.startsWith('i vote') || lower.includes('vote for')) {
    return 'Send your vote privately here as @Chimmy vote @manager. Use the manager selector for a verified mention.'
  }

  if (!player) {
    return 'You are not registered as a Survivor player in this league yet.'
  }

  if (player.playerState === 'eliminated') {
    return 'Your journey on the main island has ended — thanks for playing.'
  }

  // ===== EXILE-SPECIFIC QUESTIONS =====
  if (player.playerState === 'exile' || player.canAccessExileChat) {
    const keyPos = EXILE_KEY_POSITION_BY_SPORT[league?.sport ?? 'NFL'] ?? 'QB'
    if (lower.includes('token') || lower.includes('how many')) {
      return `Check the Token Pool screen for your current balance and history. I can't reveal other players' token counts.`
    }
    if (lower.includes('team') || lower.includes('available') || lower.includes('claim')) {
      return `To claim a team on Exile: submit a waiver claim for any player. If you claim the **${keyPos}** (key position), you win the entire team! Use the Exile Team Draft screen to see available teams and submit claims.`
    }
    if (lower.includes('return') || lower.includes('go back') || lower.includes('main island')) {
      return `The manager with the most tokens at the return week goes back to the main island. Keep earning tokens through weekly scoring and mini-games!`
    }
  }

  // ===== STATUS CHECK =====
  if (lower.includes('status') || lower.includes('am i safe') || lower.includes('my status')) {
    const statuses: Record<string, string> = {
      active: 'You are ACTIVE on the main island.',
      immune: 'You have IMMUNITY this week — you cannot be voted out.',
      exile: 'You are on EXILE ISLAND. Compete to earn tokens and return.',
      jury: 'You are a JURY MEMBER. You will vote for the season winner.',
      finalist: 'You are a FINALIST — prepare for Final Elimination Council!',
      eliminated: 'You have been eliminated from the game.',
    }
    return statuses[player.playerState] ?? `Your status: ${player.playerState}`
  }

  return `I'm here, ${player.displayName}. Ask about rules, deadlines, voting, idols, exile, merge, jury — or play an idol: "I want to use my idol".`
}

/** Asking how something works, as opposed to asking about (or for) your own idols. */
const RULES_QUESTION = /^(?:@chimmy\s+)?(?:how|when|why|explain|rules?|tell me about|what happens|what is|what are|what's|who (?:decides|wins|votes|goes))\b/

const MY_STRIKES = /\b(my (?:conduct )?strikes?|strikes? do i have|have i (?:got|been given) (?:a )?strikes?|cu[aá]ntas faltas tengo|mis faltas)\b/

async function answerMyStrikes(leagueId: string, userId: string): Promise<string> {
  const [{ listSurvivorConductStrikes }, league] = await Promise.all([
    import('./survivorConductService'),
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, language: true } }),
  ])
  const strikes = await listSurvivorConductStrikes(leagueId, userId)
  const { strikeLimit } = readSurvivorGovernanceSettings(league?.settings)
  const es = governanceLang(league?.language) === 'es'
  if (strikes.length === 0) return es ? `No tienes faltas de conducta. El límite en esta liga es ${strikeLimit}.` : `You have no conduct strikes. This league's limit is ${strikeLimit}.`
  const last = strikes[strikes.length - 1]!
  return es
    ? `Tienes ${strikes.length} de ${strikeLimit} ${strikeLimit === 1 ? 'falta' : 'faltas'}. La más reciente: ${last.reason}`
    : `You have ${strikes.length} of ${strikeLimit} conduct ${strikeLimit === 1 ? 'strike' : 'strikes'}. The latest: ${last.reason}`
}

async function answerRulesForLeague(leagueId: string, topic: SurvivorRulesTopic, sport: string): Promise<string> {
  const ctx = await loadSurvivorRulesContext(leagueId)
  return answerSurvivorRules(topic, ctx ?? { sport, settings: normalizeSurvivorFoundationSettings({}), plan: null })
}
