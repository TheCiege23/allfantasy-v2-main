'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Share2 } from 'lucide-react'
import { useSleeperPlayers } from '@/lib/hooks/useSleeperPlayers'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { copyText } from '@/lib/clipboard/copyText'
import type { LeaguePlayerNewsItem } from '@/app/api/leagues/[leagueId]/player-news/handler'

/**
 * The league's News tab: recent news about the viewer's own players, each story with a Share menu
 * (league chat, X, Facebook, Reddit, copy link, or the device's own share sheet).
 *
 * Roster from `/api/league/roster` (the Team tab's read), names from the player map, stories from
 * `/api/leagues/[leagueId]/player-news` (Postgres `SportsNews`). Colours from the league type's skin.
 */
const T = {
  text: 'var(--lsk-text, #fff)',
  text2: 'var(--lsk-text2, rgba(255,255,255,.8))',
  muted: 'var(--lsk-muted, rgba(255,255,255,.6))',
  line: 'var(--lsk-line, rgba(255,255,255,.1))',
  surface: 'var(--lsk-surface, #0e1119)',
  surface2: 'var(--lsk-surface2, #1a1f2b)',
}

function ago(iso: string | null): string {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return `${mins} min`
  const hrs = Math.round(mins / 60)
  return hrs < 48 ? `${hrs} hr` : `${Math.round(hrs / 24)} days`
}

/** Where a shared story points: the source's own article when we have it, else this league's News tab. */
function shareUrl(item: LeaguePlayerNewsItem, leagueId: string): string {
  if (item.url) return item.url
  return typeof window === 'undefined' ? '' : `${window.location.origin}/league/${encodeURIComponent(leagueId)}?view=news`
}

type ShareTarget = { id: string; label: string; mark: string; color: string }
const TARGETS: ShareTarget[] = [
  { id: 'chat', label: 'League chat', mark: 'AF', color: 'var(--af-blue, #3b82f6)' },
  { id: 'x', label: 'X', mark: 'X', color: '#e8ecf2' },
  { id: 'facebook', label: 'Facebook', mark: 'f', color: '#4a7bea' },
  { id: 'reddit', label: 'Reddit', mark: 'r', color: '#ff5700' },
  { id: 'copy', label: 'Copy link', mark: '⧉', color: '#9aa4b2' },
  { id: 'more', label: 'More…', mark: '…', color: '#9aa4b2' },
]

function ShareMenu({ item, leagueId, onDone }: { item: LeaguePlayerNewsItem; leagueId: string; onDone: (msg: string) => void }) {
  const url = shareUrl(item, leagueId)
  const text = item.title
  const open = (href: string) => window.open(href, '_blank', 'noopener,noreferrer')
  const pick = async (id: string) => {
    if (id === 'chat') {
      const res = await fetch('/api/league/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, message: `${text}${url ? ` ${url}` : ''}` }),
      }).catch(() => null)
      onDone(res?.ok ? 'Shared to league chat' : 'Could not post to league chat')
      return
    }
    if (id === 'x') open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`)
    else if (id === 'facebook') open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`)
    else if (id === 'reddit') open(`https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`)
    else if (id === 'copy') {
      onDone((await copyText(url || text)) ? 'Link copied' : 'Could not copy the link')
      return
    } else if (id === 'more') {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title: text, text, url }).catch(() => undefined)
      } else {
        onDone((await copyText(url || text)) ? 'Link copied' : 'Could not copy the link')
        return
      }
    }
    onDone('')
  }
  return (
    <div
      role="menu"
      aria-label="Share to"
      className="absolute right-4 top-16 z-20 flex w-64 flex-col gap-0.5 rounded-2xl border p-2 shadow-[0_18px_40px_rgba(0,0,0,.5)]"
      style={{ borderColor: T.line, background: T.surface2 }}
    >
      <span className="px-2.5 pb-1.5 pt-2 text-[12px] font-bold uppercase tracking-[0.08em]" style={{ color: T.muted }}>Share to</span>
      {TARGETS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="menuitem"
          onClick={() => void pick(t.id)}
          className="flex min-h-[44px] items-center gap-3 rounded-lg px-2.5 text-left text-[14px] font-semibold hover:bg-white/5"
          style={{ color: T.text }}
        >
          <span aria-hidden className="flex h-[30px] w-[30px] items-center justify-center rounded-full border text-[12px] font-extrabold" style={{ borderColor: t.color, color: t.color }}>
            {t.mark}
          </span>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function LeaguePlayerNewsTab({ leagueId, sport }: { leagueId: string; sport: string }) {
  const { players } = useSleeperPlayers(sport)
  const [rosterIds, setRosterIds] = useState<string[] | null>(null)
  const [items, setItems] = useState<LeaguePlayerNewsItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/league/roster?leagueId=${encodeURIComponent(leagueId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { roster?: unknown }) => {
        if (!cancelled) setRosterIds(data?.roster ? getRosterPlayerIds(data.roster) : [])
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  const names = useMemo(() => {
    if (!rosterIds) return null
    return [...new Set(rosterIds.map((id) => players[id]?.name).filter((n): n is string => Boolean(n)))]
  }, [rosterIds, players])

  useEffect(() => {
    if (names == null) return
    if (names.length === 0) {
      setItems([])
      return
    }
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/player-news?names=${encodeURIComponent(names.join(','))}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json: { items?: LeaguePlayerNewsItem[] }) => {
        if (!cancelled) setItems(Array.isArray(json.items) ? json.items : [])
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [names, leagueId])

  const showToast = (msg: string) => {
    setOpenId(null)
    if (!msg) return
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2500)
  }

  return (
    <section className="flex flex-col gap-4 px-4 py-5 sm:px-5" aria-labelledby="league-news-title" data-testid="league-news-tab">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="league-news-title" className="m-0 text-[24px] font-extrabold" style={{ color: T.text }}>Player News</h2>
        <span className="text-[14px]" style={{ color: T.muted }}>The latest on the players you roster</span>
      </div>

      {failed ? (
        <p className="rounded-xl border px-4 py-6 text-center text-[14px]" style={{ borderColor: T.line, color: T.muted }}>
          We couldn&apos;t load news for your roster. Try again shortly.
        </p>
      ) : items == null ? (
        <div className="h-28 animate-pulse rounded-xl" style={{ background: T.surface }} />
      ) : items.length === 0 ? (
        <p className="rounded-xl border px-4 py-6 text-center text-[14px]" style={{ borderColor: T.line, color: T.muted }}>
          No recent news about your players.
        </p>
      ) : (
        items.map((n) => (
          <article key={n.id} className="relative flex flex-col gap-3 rounded-2xl border p-4" style={{ borderColor: T.line, background: T.surface }} data-testid="league-news-item">
            <div className="flex items-start gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold" style={{ color: T.text }}>{n.playerName ?? 'Player news'}</span>
                <span className="block text-[13px]" style={{ color: T.muted }}>
                  {n.source}
                  {n.publishedAt ? ` · ${ago(n.publishedAt)}` : ''}
                </span>
              </span>
              <button
                type="button"
                aria-label="Share this news"
                aria-expanded={openId === n.id}
                aria-haspopup="menu"
                onClick={() => setOpenId(openId === n.id ? null : n.id)}
                className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-bold"
                style={{ borderColor: 'var(--af-blue, #3b82f6)', background: 'rgba(59,130,246,.12)', color: '#8db8ff' }}
                data-testid="league-news-share"
              >
                <Share2 className="h-4 w-4" aria-hidden /> Share
              </button>
            </div>
            <h3 className="m-0 text-[18px] font-extrabold" style={{ color: T.text }}>
              {n.url ? (
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: 'inherit' }}>
                  {n.title}
                </a>
              ) : (
                n.title
              )}
            </h3>
            {n.body ? <p className="m-0 text-[15px] leading-relaxed" style={{ color: T.text2 }}>{n.body}</p> : null}
            {openId === n.id ? <ShareMenu item={n} leagueId={leagueId} onDone={showToast} /> : null}
          </article>
        ))
      )}
      {toast ? (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-[14px] font-bold" style={{ background: T.surface2, color: T.text }}>
          {toast}
        </div>
      ) : null}
    </section>
  )
}
