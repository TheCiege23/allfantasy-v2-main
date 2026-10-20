/**
 * FAQ Generator — creates pinned FAQ documents for Main Island and Exile Island chats.
 * Dynamically generated from commissioner settings so rules are always current.
 */

import { prisma } from '@/lib/prisma'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { EXILE_KEY_POSITION_BY_SPORT, IDOL_POWER_DESCRIPTIONS } from './constants'
import { getSportSchedule } from './sportScheduleEngine'
import { idolTimingRuleLines, normalizeSurvivorFoundationSettings } from './survivorSettings'

/**
 * Generate and pin the Main Island FAQ in the league chat channel.
 */
export async function generateAndPinMainIslandFAQ(leagueId: string): Promise<void> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return

  const league = await (prisma as any).league.findUnique({
    where: { id: leagueId },
    select: {
      sport: true, survivorPlayerCount: true, survivorTribeCount: true,
      survivorMergeTrigger: true, survivorMergeWeek: true, survivorMergeAtCount: true,
      survivorJuryStart: true, survivorIdolsEnabled: true, survivorIdolCount: true,
      survivorIdolExpiryWeek: true, survivorExileEnabled: true, settings: true,
      survivorSelfVoteAllowed: true, survivorRocksEnabled: true, survivorTieRule: true,
      survivorRevealMode: true, survivorChallengeMode: true, survivorTokenEnabled: true,
      survivorBossResetEnabled: true,
    },
  })
  if (!league) return

  const sport = league.sport ?? 'NFL'
  const schedule = getSportSchedule(sport)
  const keyPos = EXILE_KEY_POSITION_BY_SPORT[sport] ?? 'QB'

  const faq = `**SURVIVOR LEAGUE — RULES & FAQ**

**Format:** Survivor-style fantasy ${sport} league
**Players:** ${league.survivorPlayerCount ?? 20} managers split into ${league.survivorTribeCount ?? 4} tribes
**Sport Schedule:** ${schedule.scheduleNote}

---

**HOW IT WORKS**
• Tribes compete weekly through fantasy ${sport} scoring
• The tribe with the lowest combined score goes to Elimination Council
• At Elimination Council, tribe members vote someone out privately via @Chimmy
• Voted-out players are sent to Exile Island
• At a configured point, tribes merge into one — individual immunity begins
• After merge, the highest individual scorer each week wins immunity
• Late-game eliminated players become the Jury
• The Final 3 face the Jury — Jury votes for the season winner

---

**VOTING**
• Vote privately by messaging @Chimmy: "I vote for [player name]"
• Self-voting: ${league.survivorSelfVoteAllowed ? 'Allowed' : 'Not allowed'}
• Late votes: Recorded as "Does Not Count"
• Tie resolution: ${(league.survivorTieRule ?? 'rocks').replace(/_/g, ' ')}
• Go to Rocks: ${league.survivorRocksEnabled !== false ? 'Enabled' : 'Disabled'}
• Vote reveal: ${(league.survivorRevealMode ?? 'dramatic').replace(/_/g, ' ')}

---

**IDOLS & POWERS**
• Idols: ${league.survivorIdolsEnabled !== false ? `Enabled (${league.survivorIdolCount ?? 9} in pool)` : 'Disabled'}
• ~30-35% of the league receives a hidden idol after the draft
• Each idol is unique — no two managers get the same power
• Idols must be played BEFORE votes are counted
• To play: message @Chimmy "I want to use my idol"
• To check your idols: message @Chimmy "Do I have an idol?"
• Idols are attached to PLAYERS — if a player is traded or picked up from waivers, the idol goes with them
${idolTimingRuleLines({ expiryWeek: league.survivorIdolExpiryWeek, invalidRemainingPlayers: normalizeSurvivorFoundationSettings(league.settings ?? {}).idolInvalidRemainingPlayers, playCutoffHours: normalizeSurvivorFoundationSettings(league.settings ?? {}).idolPlayCutoffHours }).map((l) => `• ${l}`).join('\n')}
• When an idol is played, it is announced in league chat

---

**MERGE**
• Merge trigger: ${league.survivorMergeTrigger === 'week' ? `At Week ${league.survivorMergeWeek}` : `When ${league.survivorMergeAtCount ?? 10} players remain`}
• After merge: individual immunity begins (highest scorer wins)
• Pre-merge idols may expire at merge (check commissioner settings)

---

**JURY & FINALE**
• Jury begins: ${(league.survivorJuryStart ?? 'after merge').replace(/_/g, ' ')}
• Eliminated players after jury start join the Jury
• Final 3 face Jury questions and closing statements
• Jury votes privately for the winner — the last one standing

---

**EXILE ISLAND**
• ${league.survivorExileEnabled !== false ? 'Enabled' : 'Disabled'}
• Voted-out players are sent to Exile Island
• On Exile: claim real ${sport} teams via waiver system
• Claim the **${keyPos}** (key position) to win the entire team's roster
• Team with most fantasy points each week earns a token
• ${league.survivorBossResetEnabled !== false ? 'Boss (commissioner) can play on Exile — if Boss scores highest, ALL tokens reset to 0' : 'Boss reset: Disabled'}
• Manager with the most tokens at the return week goes back to the main island
• Random mini-games appear on Exile for bonus tokens

---

**CHALLENGES & MINI-GAMES**
• Challenge mode: ${(league.survivorChallengeMode ?? 'automatic').replace(/_/g, ' ')}
• ${schedule.minigamesPerWeek} mini-game(s) per scoring period on Main Island
• Mini-games on Exile are random — not every week

---

**@CHIMMY COMMANDS (Private Chat)**
• "I vote for [name]" — cast your tribal vote
• "I want to use my idol" — play your idol before votes are counted
• "Do I have an idol?" — check your idol inventory
• "What are the rules?" — get a rules summary
• "When is the deadline?" — check current deadlines
• "What's my status?" — check if you're safe, vulnerable, immune, etc.`

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
    await (prisma as any).survivorChatMessage.create({
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
    await (prisma as any).survivorChatMessage.create({
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
