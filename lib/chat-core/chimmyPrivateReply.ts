import 'server-only'

import { openaiChatText } from '@/lib/openai-client'
import { stripChimmyMentionPrefix } from '@/lib/chat-core/mentionPrivacyFilter'
import { loadLeagueGroundingForUser } from '@/lib/chimmy/chimmy-league-snapshot'
import { buildHeadToHeadGrounding } from '@/lib/chimmy/headToHeadGrounding'
import { buildLeagueStandingsContext } from '@/lib/chimmy/leagueStandingsGrounding'

/** Two newlines, kept as a constant so an editing pass cannot flatten it. */
const NEWLINES = String.fromCharCode(10, 10)

const NO_LEAGUE_NOTE =
  'CONTEXT: this conversation is not attached to a league, so you have no roster, standings or matchup data here. Say that plainly if the question needs it, and point the reader at the Chimmy panel on a league page rather than guessing.'

/**
 * What the model is allowed to know, assembled from the same builders the
 * Chimmy panel uses. Every failure degrades to a statement that the data is
 * absent rather than to silence, because silence is what the model fills in.
 */
async function buildPrivateGrounding(context: {
  leagueId?: string | null
  userId?: string | null
}): Promise<string> {
  const { leagueId, userId } = context
  if (!leagueId || !userId) return NO_LEAGUE_NOTE

  /*
   * `loadLeagueGroundingForUser` is the GATE, not the content. It answers "is
   * this person actually in this league" — grounding a league somebody is not a
   * member of would leak another league's standings into a private reply. The
   * facts come from the same exported builders the Chimmy panel uses, so there
   * is one implementation of each rather than a second copy living here.
   */
  const access = await loadLeagueGroundingForUser(leagueId, userId).catch(() => null)
  if (!access || !access.ok) {
    const reason = access && !access.ok ? access.reason : 'error'
    return `CONTEXT: this league's data could not be loaded (${reason}). Do not describe the roster, standings or history; say plainly that you could not read them.`
  }

  const blocks: string[] = []

  try {
    const standings = await buildLeagueStandingsContext(leagueId, userId)
    if (standings) blocks.push(standings)
  } catch {
    /* Non-fatal: a reply without standings is still a reply. */
  }

  try {
    const h2h = await buildHeadToHeadGrounding(leagueId)
    if (h2h) blocks.push(h2h.text)
  } catch {
    /* Rivalry history is a bonus here, not a requirement. */
  }

  if (blocks.length === 0) {
    return "CONTEXT: this league is real and you are a member, but it has no standings or matchup history stored yet. Do not invent either."
  }

  return blocks.join(NEWLINES)
}


/**
 * Short Chimmy reply for a private @chimmy message — only the sender sees it.
 *
 * ⚠ THIS RAN COMPLETELY BLIND. The `leagueId` argument was named `_leagueId`
 * and never read, so @chimmy in a league chat reached a model that had been
 * told "never invent player or league stats" and then given no league, no
 * roster and no standings to work from. The same assistant answering in the
 * drawer has a dozen grounding builders behind it. Asking "who should I start"
 * in league chat and in the panel got answers of completely different quality,
 * from what looks like the same assistant.
 *
 * ⚠ WHERE THERE IS NO LEAGUE, IT SAYS SO IN THE PROMPT. A DM has no league to
 * ground against, and a model that does not know it is missing the data is the
 * one that fills the gap in confidently.
 */
export async function generateChimmyPrivateReply(
  prompt: string,
  context: { leagueId?: string | null; userId?: string | null } = {},
): Promise<string> {
  const userContent = stripChimmyMentionPrefix(prompt).slice(0, 4000)
  if (!userContent.trim()) {
    return "Hey — what would you like help with? Add your question after @chimmy."
  }

  const grounding = await buildPrivateGrounding(context)

  const result = await openaiChatText({
    temperature: 0.5,
    maxTokens: 600,
    messages: [
      {
        role: 'system',
        content: `You are Chimmy, the calm, analytical AI assistant for AllFantasy fantasy sports. Be concise, helpful, and never invent player or league stats. If context is missing, ask a brief clarifying question.

${grounding}`,
      },
      { role: 'user', content: userContent },
    ],
  })

  if (result.ok && result.text.trim()) {
    return result.text.trim()
  }

  return "I'm having trouble reaching the AI right now. Try again in a moment, or open the full Chimmy panel from the dashboard."
}
