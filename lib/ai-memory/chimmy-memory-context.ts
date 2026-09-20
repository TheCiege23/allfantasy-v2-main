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

  /*
   * ── ONE THREAD, SO EVERY LINE MUST SAY WHICH LEAGUE IT WAS ABOUT ────────────────────────────
   *
   * Chimmy's transcript stopped being per-league on 2026-09-20 (user's decision), so this section
   * can now carry an exchange about a different league than the one being asked about.
   *
   * 🛑 UNLABELLED, THAT IS FACT CONTAMINATION, NOT UNTIDINESS. Twelve undifferentiated "recent
   * chat" lines invite the model to answer a KBFL question using a Cream Bowl roster it discussed
   * an hour earlier, and it would read as a confident, specific, WRONG answer — the same failure
   * this repo already paid for once in `deterministic.ts`.
   *
   * The label is relative rather than a league NAME on purpose: the id is what the row carries, a
   * name would cost another lookup per turn, and "this league / another league" is the whole
   * distinction needed to stop facts being borrowed across them.
   *
   * ⚠ READ BY USER, NOT BY `conversationId` — that is what keeps turns written under the old
   * per-league keys visible here. See the note on `getRecentChatHistory`.
   */
  const recentChat = await getRecentChatHistory({ userId, limit: 12 })
  if (recentChat.length > 0) {
    const scopeOf = (turnLeagueId: string | null | undefined) => {
      if (!turnLeagueId) return 'no league'
      if (leagueId && turnLeagueId === leagueId) return 'this league'
      return 'another league'
    }
    const spansLeagues = recentChat.some((m) => scopeOf(m.leagueId) === 'another league')
    const warning = spansLeagues
      ? 'This transcript spans more than one league. Lines marked [another league] are about a DIFFERENT league — use them for continuity and tone only, never as facts about the league being asked about.\n'
      : ''
    sections.push(`
## RECENT CHAT (for context)
${warning}${recentChat
      .map(
        (m) =>
          `${m.role} [${scopeOf(m.leagueId)}]: ${m.content.slice(0, 400)}${m.content.length > 400 ? '...' : ''}`,
      )
      .join('\n')}
`)
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
