/**
 * `recall_past_chats` (AF Pro): what the user and Chimmy said in EARLIER conversations, found by words.
 *
 * Reads `chat_history` through the one reader (`getRecentChatHistory`), which always filters on the
 * signed-in user's id — so the tool can only ever return this user's own messages. The current
 * conversation already reaches the model as memory; this is for "what did you tell me last week".
 *
 * Deliberately a word match over the most recent messages rather than a semantic search: it needs no
 * new index or embedding spend, and a manager asking about "Bijan" or "my WR trade" names the thing.
 */
import { getRecentChatHistory } from '@/lib/ai-memory/chat-history-store'

/** How far back the search reaches: the newest messages across every conversation. */
const SCAN_MESSAGES = 400
const EXCERPT_CHARS = 320
const STOP = new Set(['the', 'and', 'for', 'you', 'did', 'what', 'about', 'tell', 'told', 'with', 'that', 'this', 'last', 'week', 'my', 'me', 'we', 'our', 'was', 'were', 'any'])

type HistoryRow = { role: string; content: string; createdAt?: Date }

export function searchWords(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length >= 3 && !STOP.has(w)))]
}

/** Rank rows by how many of the words they contain (then newest first). Pure, for the tests. */
export function matchPastChats(rows: readonly HistoryRow[], query: string, limit: number): Array<HistoryRow & { hits: number }> {
  const words = searchWords(query)
  if (words.length === 0) return []
  return rows
    .map((r) => ({ ...r, hits: words.filter((w) => r.content.toLowerCase().includes(w)).length }))
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits || (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
    .slice(0, limit)
}

function excerpt(content: string, words: string[]): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  if (flat.length <= EXCERPT_CHARS) return flat
  const at = Math.max(0, Math.min(...words.map((w) => flat.toLowerCase().indexOf(w)).filter((i) => i >= 0)) - 80)
  return `${at > 0 ? '…' : ''}${flat.slice(at, at + EXCERPT_CHARS)}…`
}

/** `text` is what the model reads; `hits` is how many earlier messages matched (drives the chip). */
export async function recallPastChats(args: { userId: string; query: string; limit?: number }): Promise<{ text: string; hits: number }> {
  const limit = Number.isFinite(args.limit) ? Math.min(Math.max(Math.trunc(args.limit!), 1), 12) : 6
  const words = searchWords(args.query)
  if (words.length === 0) return { text: 'No search words were given (names, players, topics). Ask the user what they want recalled.', hits: 0 }
  const rows = await getRecentChatHistory({ userId: args.userId, limit: SCAN_MESSAGES })
  const hits = matchPastChats(rows, args.query, limit)
  if (hits.length === 0) {
    return {
      text: `PAST CHATS: nothing in this user's last ${rows.length} Chimmy messages mentions ${words.map((w) => `"${w}"`).join(', ')}. Say you found no earlier conversation about it; do not invent one.`,
      hits: 0,
    }
  }
  const lines = hits.map((h) => {
    const day = h.createdAt ? h.createdAt.toISOString().slice(0, 10) : 'date unknown'
    return `- ${day} · ${h.role === 'user' ? 'User asked' : 'Chimmy said'}: ${excerpt(h.content, words)}`
  })
  return {
    text: [`PAST CHATS (this user's own earlier Chimmy messages, newest relevant first; quote them as past advice, not current data):`, ...lines].join('\n'),
    hits: hits.length,
  }
}
