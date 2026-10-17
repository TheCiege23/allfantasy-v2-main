'use client'

import { useCallback, useEffect, useState } from 'react'
import { Activity, ArrowRight, SmilePlus } from 'lucide-react'
import { QUICK_REACTIONS, toggleReactionLocally, type ViewerReaction } from '@/lib/chat-core/messageReactions'
import { buildActivityFeed, type ChatMessageLite, type FeedItem, type LeagueActivityLite, type SharedActivityLite } from '@/lib/league/activity-feed'

async function getJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, { cache: 'no-store', credentials: 'include' })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

/**
 * Three existing endpoints, in parallel, each optional:
 * - league chat (the trade cards, chop and eviction announcements, with their reactions). Reading
 *   it records you as viewing chat, the way opening chat does; it does NOT mark anything read.
 * - shared activity (native trades Chimmy did not post). Rate-limited per user; a 429 just leaves
 *   those out.
 * - league activity (waiver claims and free-agent adds/drops, with player names).
 */
export async function loadActivityFeed(leagueId: string): Promise<FeedItem[] | null> {
  const id = encodeURIComponent(leagueId)
  const [chat, shared, moves] = await Promise.all([
    getJson(`/api/league/chat?leagueId=${id}&limit=100`),
    getJson(`/api/shared/activity?leagueId=${id}&limit=20`),
    getJson(`/api/leagues/${id}/activity`),
  ])
  if (chat == null && shared == null && moves == null) return null
  return buildActivityFeed({
    chat: chat as { messages?: ChatMessageLite[]; viewerUserId?: string | null } | null,
    shared: (shared as { items?: SharedActivityLite[] } | null)?.items ?? null,
    moves: (moves as { items?: LeagueActivityLite[]; activity?: LeagueActivityLite[] } | null)?.items ??
      (moves as { activity?: LeagueActivityLite[] } | null)?.activity ??
      (Array.isArray(moves) ? (moves as LeagueActivityLite[]) : null),
  })
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const KIND_LABEL: Record<FeedItem['kind'], string> = { trade: 'Trade', waiver: 'Waivers', free_agent: 'Free agent', chop: 'Chop', eviction: 'Eviction' }

/**
 * Replaces a card that said only "League announcements and transaction updates are in chat":
 * what actually happened in the league, newest first, with one-tap reactions on the moves that
 * live in league chat.
 */
export function LeagueActivityFeedCard({ leagueId, onOpenChat }: { leagueId: string; onOpenChat: () => void }) {
  const [items, setItems] = useState<FeedItem[] | null | undefined>(undefined)
  const [picker, setPicker] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setItems(await loadActivityFeed(leagueId))
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const react = useCallback(
    async (item: FeedItem, emoji: string) => {
      if (!item.messageId || busy) return
      const before = item.reactions
      const next = toggleReactionLocally(before, emoji)
      const adding = next.some((r) => r.emoji === emoji && r.mine)
      const setFor = (reactions: ViewerReaction[]) => setItems((prev) => prev?.map((i) => (i.id === item.id ? { ...i, reactions } : i)) ?? prev)
      setFor(next)
      setPicker(null)
      setBusy(item.id)
      setError(null)
      try {
        const res = await fetch(
          `/api/shared/chat/threads/${encodeURIComponent(`league:${leagueId}`)}/messages/${encodeURIComponent(item.messageId)}/reactions`,
          { method: adding ? 'POST' : 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emoji }) },
        )
        if (!res.ok) throw new Error(String(res.status))
      } catch {
        setFor(before)
        setError("Your reaction didn't save. Try again.")
      } finally {
        setBusy(null)
      }
    },
    [busy, leagueId],
  )

  return (
    <section className="nl-card nl-activity" aria-label="League activity" data-testid="league-activity">
      <div className="nl-card-label">
        <span>League activity</span>
        <Activity size={16} aria-hidden />
      </div>
      {items === undefined ? (
        <p data-testid="league-activity-loading">Loading…</p>
      ) : !items || items.length === 0 ? (
        <p data-testid="league-activity-empty">No trades or moves yet. They show up here as they happen.</p>
      ) : (
        <ol className="nl-activity-list" data-testid="league-activity-list">
          {items.map((item) => (
            <li key={item.id} data-kind={item.kind}>
              <div className="nl-activity-head">
                <span className="nl-activity-kind">{KIND_LABEL[item.kind]}</span>
                <time dateTime={item.at}>{when(item.at)}</time>
              </div>
              <strong>{item.title}</strong>
              {item.lines.length ? (
                <ul className="nl-activity-lines">
                  {item.lines.map((line, i) => (
                    <li key={`${line.verb}-${i}`} data-verb={line.verb}>
                      <span>{line.verb === 'add' ? '+' : '−'}</span> {line.name}
                      {line.meta ? <small> {line.meta}</small> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {item.detail ? <p className="nl-activity-detail">{item.detail}</p> : null}
              {item.messageId ? (
                <div className="nl-activity-reactions" data-testid="league-activity-reactions">
                  {item.reactions.map((r) => (
                    <button
                      key={r.emoji}
                      type="button"
                      aria-pressed={r.mine}
                      data-mine={r.mine || undefined}
                      onClick={() => react(item, r.emoji)}
                      disabled={busy === item.id}
                      data-testid="league-activity-reaction"
                    >
                      {r.emoji} {r.count}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-label="Add a reaction"
                    aria-expanded={picker === item.id}
                    onClick={() => setPicker((open) => (open === item.id ? null : item.id))}
                    data-testid="league-activity-react"
                  >
                    <SmilePlus size={15} aria-hidden />
                  </button>
                  {picker === item.id ? (
                    <span className="nl-activity-picker" role="group" aria-label="Reactions">
                      {QUICK_REACTIONS.map((emoji) => (
                        <button key={emoji} type="button" onClick={() => react(item, emoji)} data-testid="league-activity-pick">
                          {emoji}
                        </button>
                      ))}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {error ? <p className="nl-activity-error" role="alert">{error}</p> : null}
      <button type="button" className="nl-text-link" onClick={onOpenChat} data-testid="league-activity-chat">
        Open league chat <ArrowRight size={15} aria-hidden />
      </button>
    </section>
  )
}
