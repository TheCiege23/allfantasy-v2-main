/**
 * PROMPT 234 — Chimmy memory context: AiMemory + ChatHistory + existing AI context.
 * Used for context-aware, league-aware, personalized coaching responses.
 */

import { getFullAIContext, buildMemoryPromptSection } from '@/lib/ai-memory'
import { listAiMemoryByUser } from './ai-memory-store'
import { getRecentChatHistory } from './chat-history-store'
import { buildUnifiedMemoryPromptSection } from './unified-memory-system'

export interface ChimmyMemoryContextInput {
  userId: string
  leagueId?: string | null
  conversationId?: string | null
  sleeperUsername?: string | null
}

export interface ChimmyMemoryContextResult {
  /** Prompt section to inject into Chimmy (memory + chat + profile/league). */
  promptSection: string
  conversationId: string | null
  memoryItemsUsedCount: number
}

/**
 * Build a single prompt section combining:
 * - AiMemory (user_preferences, favorite_teams, league_history, past_trades)
 * - ChatHistory (recent turns)
 * - Existing getFullAIContext (user profile, league context, team snapshots, patterns, events)
 */
export async function getChimmyMemoryContext(
  input: ChimmyMemoryContextInput
): Promise<ChimmyMemoryContextResult> {
  const sections: string[] = []
  const { userId, leagueId, conversationId, sleeperUsername } = input

  const fullContext = await getFullAIContext({
    userId,
    sleeperUsername: sleeperUsername ?? undefined,
    leagueId: leagueId ?? undefined,
  })
  const existingSection = buildMemoryPromptSection(fullContext)
  if (existingSection.trim()) sections.push(existingSection)

  const aiMemories = await listAiMemoryByUser(userId, {
    leagueId,
    scopes: [
      'user_preferences',
      'favorite_teams',
      'league_history',
      'past_trades',
      'coaching_notes',
      'chimmy_strategy_profile',
      'war_room_draft',
    ],
  })
  if (aiMemories.length > 0) {
    sections.push(`
## CHIMMY MEMORY (saved preferences & history)
${aiMemories
  .map((m) => `- ${m.scope}${m.key ? ` (${m.key})` : ''}: ${JSON.stringify(m.value).slice(0, 300)}`)
  .join('\n')}

Use this to personalize responses and avoid repeating yourself.
`)
  }

  const unifiedSection = await buildUnifiedMemoryPromptSection({
    userId,
    leagueId,
    includePlatform: true,
  })
  if (unifiedSection.trim()) {
    sections.push(unifiedSection)
  }

  if (conversationId) {
    const recentChat = await getRecentChatHistory(conversationId, 12, userId)
    if (recentChat.length > 0) {
      sections.push(`
## RECENT CHAT (for context)
${recentChat.map((m) => `${m.role}: ${m.content.slice(0, 400)}${m.content.length > 400 ? '...' : ''}`).join('\n')}
`)
    }
  }

  const promptSection = sections.length ? sections.join('\n') : ''
  const memoryItemsUsedCount =
    aiMemories.length +
    fullContext.recentEvents.length +
    fullContext.teamSnapshots.length +
    fullContext.patterns.length +
    (fullContext.userProfile ? 1 : 0) +
    (fullContext.leagueContext ? 1 : 0)

  return {
    promptSection,
    conversationId: conversationId ?? null,
    memoryItemsUsedCount,
  }
}
