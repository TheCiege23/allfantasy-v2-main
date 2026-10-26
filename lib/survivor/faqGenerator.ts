/**
 * FAQ Generator — creates pinned FAQ documents for Main Island and Exile Island chats.
 * Dynamically generated from commissioner settings so rules are always current.
 */

import { prisma } from '@/lib/prisma'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { EXILE_KEY_POSITION_BY_SPORT } from './constants'
import { createSurvivorChatMessage } from './survivorChatBridge'
import { buildSurvivorRulebook, type SurvivorRulesContext } from './survivorRulesAnswers'
import { loadSurvivorRulesContext } from './survivorRulesContext'

/**
 * The pinned Main Island FAQ: the league's rulebook (built from its settings, the same source as
 * the Rules page and Chimmy's answers) plus the @Chimmy commands. The Rules page is the copy that
 * is always current; this pin is a snapshot from when it was last written.
 */
export function buildMainIslandFaq(leagueId: string, ctx: SurvivorRulesContext): string {
  const sections = buildSurvivorRulebook(ctx).map(section => `**${section.title.toUpperCase()}**\n${section.lines.map(line => `• ${line}`).join('\n')}`)
  return [
    '**SURVIVOR LEAGUE — RULES & FAQ**',
    `Always-current rules: /survivor/${leagueId}/rules`,
    ...sections,
    [
      '**@CHIMMY COMMANDS (private)**',
      '• "@Chimmy vote @manager": cast your Tribal Council vote',
      '• "@Chimmy use my idol": play your idol before votes are read',
      '• "@Chimmy do I have an idol?": check your own idols',
      '• "@Chimmy shot in the dark": give up your vote for a chance to be safe',
      '• "@Chimmy how does voting work?": any rules question, answered for this league',
      '• "@Chimmy what\'s my status?": safe, immune, on Exile, or on the jury',
    ].join('\n'),
  ].join('\n\n---\n\n')
}

/**
 * Generate and pin the Main Island FAQ in the league chat channel.
 */
export async function generateAndPinMainIslandFAQ(leagueId: string): Promise<void> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return
  const ctx = await loadSurvivorRulesContext(leagueId)
  if (!ctx) return
  const faq = buildMainIslandFaq(leagueId, ctx)

  // Find or create league chat channel
  const channel = await (prisma as any).survivorChatChannel.findFirst({
    where: { leagueId, channelType: 'league' },
  })
  if (!channel) return

  // Upsert the FAQ as a pinned system message
  const existingFaq = await (prisma as any).survivorChatMessage.findFirst({
    where: { leagueId, channelId: channel.id, isSystemMessage: true, isPinned: true, contentType: 'system' },
    orderBy: { createdAt: 'asc' },
  })

  if (existingFaq) {
    await (prisma as any).survivorChatMessage.update({
      where: { id: existingFaq.id },
      data: { content: faq, pinnedAt: new Date() },
    })
  } else {
    await createSurvivorChatMessage(prisma, {
      data: {
        leagueId,
        channelId: channel.id,
        channelType: 'league',
        senderUserId: 'system',
        senderName: '@Chimmy',
        senderIsHost: true,
        isSystemMessage: true,
        content: faq,
        contentType: 'system',
        isPinned: true,
        pinnedAt: new Date(),
        pinnedBy: 'system',
      },
    })
  }
}

/**
 * Generate and pin the Exile Island FAQ in the exile chat channel.
 */
export async function generateAndPinExileIslandFAQ(leagueId: string): Promise<void> {
  const league = await (prisma as any).league.findUnique({
    where: { id: leagueId },
    select: {
      sport: true, survivorTokenEnabled: true, survivorBossResetEnabled: true,
      survivorExileReturnWeek: true,
    },
  })
  if (!league) return

  const sport = league.sport ?? 'NFL'
  const keyPos = EXILE_KEY_POSITION_BY_SPORT[sport] ?? 'QB'

  const faq = `**EXILE ISLAND — RULES & FAQ**

Welcome to Exile Island. Your main island journey is over — but the game isn't.

---

**HOW EXILE WORKS**
• You are separated from the main island. You cannot see tribe chats or strategy.
• You compete against other exiled players to earn tokens and a chance to return.

---

**TEAM DRAFT (WAIVER CLAIMS ONLY)**
• There is NO draft on Exile Island — teams are built through waiver claims only!
• Each day (or scoring period), submit a waiver claim for a real ${sport} player
• If you claim the **${keyPos}** (key position), you win that player's ENTIRE real-world team
• All players from that team are added to your roster, removed from other exiles
• Other managers must claim a new team's key position the next day
• This continues until all exiled managers have full teams
• You MUST have a complete team to score — no mix-and-match from different teams

---

**SCORING & TOKENS**
• ${league.survivorTokenEnabled !== false ? 'Token system: ACTIVE' : 'Token system: INACTIVE'}
• The exile team that scores the most fantasy points each week earns 1 token
• ${league.survivorBossResetEnabled !== false ? '**BOSS RULE:** If the commissioner (Boss) scores the highest, ALL exile tokens reset to 0!' : 'Boss reset: Disabled'}
• Tokens determine who returns to the main island

---

**MINI-GAMES**
• Random mini-games appear on Exile Island for bonus token opportunities
• Mini-games are NOT on a set schedule — they appear randomly
• Types include: pick predictions, over/under, stat challenges, trivia
• The commissioner CANNOT participate in Exile mini-games unless they were voted off the main island

---

**RETURN TO MAIN ISLAND**
• At the configured return week${league.survivorExileReturnWeek ? ` (Week ${league.survivorExileReturnWeek})` : ''}, the manager with the most tokens automatically returns
• If tied: tiebreaker uses total tokens earned → highest weekly score → earliest elimination → random
• If everyone has 0 tokens: tiebreaker determines who returns
• Returning manager rejoins the merged tribe with tokens converted to FAAB

---

**IMPORTANT RULES**
• You CANNOT communicate with main island players
• You CANNOT see main island tribe chats or strategy
• You CAN message @Chimmy for rules questions
• Your idol (if your player still carries one) stays with the player — if picked up from waivers on the main island, the new manager gets it

---

**@CHIMMY ON EXILE**
• "How many tokens do I have?" — check your balance
• "Who has the most tokens?" — see exile standings
• "What teams are available?" — see unclaimed teams
• "What are the rules?" — get this FAQ`

  // Find or create exile chat channel
  const channel = await (prisma as any).survivorChatChannel.findFirst({
    where: { leagueId, channelType: 'exile' },
  })
  if (!channel) return

  const existingFaq = await (prisma as any).survivorChatMessage.findFirst({
    where: { leagueId, channelId: channel.id, isSystemMessage: true, isPinned: true, contentType: 'system' },
    orderBy: { createdAt: 'asc' },
  })

  if (existingFaq) {
    await (prisma as any).survivorChatMessage.update({
      where: { id: existingFaq.id },
      data: { content: faq, pinnedAt: new Date() },
    })
  } else {
    await createSurvivorChatMessage(prisma, {
      data: {
        leagueId,
        channelId: channel.id,
        channelType: 'exile',
        senderUserId: 'system',
        senderName: '@Chimmy',
        senderIsHost: true,
        isSystemMessage: true,
        content: faq,
        contentType: 'system',
        isPinned: true,
        pinnedAt: new Date(),
        pinnedBy: 'system',
      },
    })
  }
}

/**
 * Regenerate both FAQs (call after commissioner changes settings).
 */
export async function regenerateAllFAQs(leagueId: string): Promise<void> {
  await generateAndPinMainIslandFAQ(leagueId)
  await generateAndPinExileIslandFAQ(leagueId)
}
