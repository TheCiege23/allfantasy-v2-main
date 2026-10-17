/**
 * The league home's activity feed: trades, waiver claims and free-agent moves, guillotine chops and
 * big brother evictions, newest first. Pure — the card fetches existing endpoints and passes the
 * payloads here.
 *
 * Reactions exist only on league-chat messages (stored in the message's metadata), so only the
 * items that ARE chat messages — the trade cards Chimmy posts, chop and eviction announcements —
 * carry a `messageId` and can be reacted to. Waiver moves never reach chat; they are listed, not
 * reactable. A trade Chimmy did not post (its toggle is off, or its daily cap was spent) still
 * appears, from the trades source, without reactions.
 */
import { readReactions, type ViewerReaction } from '@/lib/chat-core/messageReactions'

export type FeedLine = { verb: 'add' | 'drop'; name: string; meta: string | null }

export type FeedItem = {
  id: string
  kind: 'trade' | 'waiver' | 'free_agent' | 'chop' | 'eviction'
  at: string
  title: string
  detail: string | null
  lines: FeedLine[]
  /** Set only when the item is a league-chat message, i.e. when it can take a reaction. */
  messageId: string | null
  reactions: ViewerReaction[]
}

export type ChatMessageLite = { id: string; text?: string | null; createdAt?: string | null; messageType?: string | null; metadata?: unknown }
export type SharedActivityLite = { id: string; type?: string; userName?: string | null; description?: string | null; timestamp?: string | null }
export type LeagueActivityLite = {
  id: string
  type: string
  managerName?: string | null
  badge?: string | null
  amountLabel?: string | null
  occurredAt?: string | null
  lines?: { type: string; playerName?: string | null; playerMeta?: string | null }[]
}

export const FEED_LIMIT = 8

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function validIso(value: unknown): string | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null
  const t = new Date(value as string).getTime()
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** A chat message that is a league event we show, or null for ordinary chat. */
export function chatEventItem(message: ChatMessageLite, viewerUserId: string | null): (FeedItem & { tradeId?: string }) | null {
  const meta = rec(message.metadata)
  const at = validIso(message.createdAt)
  if (!at) return null
  const text = typeof message.text === 'string' && message.text.trim() ? message.text.trim() : null
  const reactions = readReactions(message.metadata, viewerUserId)

  const card = rec(meta.tradeCard)
  if (message.messageType === 'trade' && typeof card.transactionId === 'string') {
    const manager = typeof card.manager === 'string' ? card.manager : 'A manager'
    const partner = typeof card.partner === 'string' && card.partner ? card.partner : null
    return {
      id: `chat:${message.id}`,
      tradeId: card.transactionId,
      kind: 'trade',
      at,
      title: partner ? `${manager} and ${partner} traded` : `${manager} made a trade`,
      detail: text,
      lines: [],
      messageId: message.id,
      reactions,
    }
  }
  if (meta.guillotineChop === true) {
    const week = typeof meta.weekOrPeriod === 'number' ? meta.weekOrPeriod : null
    return { id: `chat:${message.id}`, kind: 'chop', at, title: week ? `Week ${week} chop` : 'The guillotine fell', detail: text, lines: [], messageId: message.id, reactions }
  }
  if (meta.bigBrother === true && meta.event === 'eviction') {
    const week = typeof meta.week === 'number' ? meta.week : null
    return { id: `chat:${message.id}`, kind: 'eviction', at, title: week ? `Week ${week} eviction` : 'Eviction', detail: text, lines: [], messageId: message.id, reactions }
  }
  return null
}

export function buildActivityFeed(input: {
  chat?: { messages?: ChatMessageLite[]; viewerUserId?: string | null } | null
  shared?: SharedActivityLite[] | null
  moves?: LeagueActivityLite[] | null
}): FeedItem[] {
  const viewer = input.chat?.viewerUserId ?? null
  const chatItems = (input.chat?.messages ?? []).map((m) => chatEventItem(m, viewer)).filter((x): x is FeedItem & { tradeId?: string } => x !== null)
  const postedTrades = new Set(chatItems.map((i) => i.tradeId).filter(Boolean))

  // Native trades with no chat card (Chimmy off or capped). Same trade id, never shown twice.
  const tradeItems: FeedItem[] = (input.shared ?? [])
    .filter((a) => a.id.startsWith('native-trade:') && !postedTrades.has(a.id.slice('native-trade:'.length)))
    .flatMap((a) => {
      const at = validIso(a.timestamp)
      return at ? [{ id: a.id, kind: 'trade' as const, at, title: 'Trade completed', detail: a.description?.trim() || null, lines: [], messageId: null, reactions: [] }] : []
    })

  const moveItems: FeedItem[] = (input.moves ?? [])
    .filter((m) => m.type === 'waiver')
    .flatMap((m) => {
      const at = validIso(m.occurredAt)
      if (!at) return []
      const lines = (m.lines ?? [])
        .filter((l) => (l.type === 'add' || l.type === 'drop') && l.playerName)
        .map((l) => ({ verb: l.type as 'add' | 'drop', name: String(l.playerName), meta: l.playerMeta ?? null }))
      const waiver = (m.badge ?? '').toUpperCase() === 'WAIVERED'
      return [{
        id: `move:${m.id}`,
        kind: waiver ? ('waiver' as const) : ('free_agent' as const),
        at,
        title: `${m.managerName?.trim() || 'A manager'} ${waiver ? 'won a waiver claim' : 'made a free-agent move'}`,
        detail: m.amountLabel ? m.amountLabel.replace(/^BID /, 'Bid ') : null,
        lines,
        messageId: null,
        reactions: [],
      }]
    })

  return [...chatItems.map(({ tradeId: _t, ...item }) => item), ...tradeItems, ...moveItems]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, FEED_LIMIT)
}
