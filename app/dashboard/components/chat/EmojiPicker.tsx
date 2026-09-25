'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'

import {
  searchEmojiCatalog,
  type EmojiCatalog,
  type EmojiCatalogRow,
  type EmojiCategoryKey,
} from '@/lib/chat/emojiCatalog'

/*
 * The full Unicode set (Emojibase) with a fantasy tab in front — see lib/chat/emojiCatalog.ts. This
 * used to show the 32 rows of the `chat_emojis` table, under tab buttons that all rendered as "•"
 * because the table's category names matched none of this file's icons.
 */

const RECENT_KEY = 'af-recent-emojis'

/** Fetched once per page load; the route lets the browser keep it for a day. */
let emojiPayload: EmojiCatalog | null = null

type EmojiPickerProps = {
  onSelect: (char: string) => void
  onClose: () => void
}

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const p = JSON.parse(raw) as unknown
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string').slice(0, 16) : []
  } catch {
    return []
  }
}

function pushRecent(char: string) {
  // Blocked storage (a private window, cleared site data) must not cost the tap its emoji.
  try {
    const prev = readRecent().filter((c) => c !== char)
    prev.unshift(char)
    localStorage.setItem(RECENT_KEY, JSON.stringify(prev.slice(0, 16)))
  } catch {
    /* recents are a convenience */
  }
}

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [search, setSearch] = useState('')
  const [catalog, setCatalog] = useState<EmojiCatalog | null>(emojiPayload)
  const [loading, setLoading] = useState(!emojiPayload)
  const [failed, setFailed] = useState(false)
  const [activeCat, setActiveCat] = useState<EmojiCategoryKey>('fantasy')
  const [recent, setRecent] = useState<string[]>([])

  useEffect(() => {
    setRecent(readRecent())
  }, [])

  useEffect(() => {
    if (emojiPayload) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/chat/emojis', { cache: 'force-cache' })
        if (!res.ok) throw new Error(`status ${res.status}`)
        const data = (await res.json()) as Partial<EmojiCatalog>
        if (cancelled) return
        if (!Array.isArray(data.emojis) || data.emojis.length === 0) throw new Error('empty catalog')
        emojiPayload = {
          emojis: data.emojis,
          categories: Array.isArray(data.categories) ? data.categories : [],
          fantasy: Array.isArray(data.fantasy) ? data.fantasy : [],
        }
        setCatalog(emojiPayload)
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const byTab = useMemo(() => {
    const out = new Map<EmojiCategoryKey, EmojiCatalogRow[]>()
    if (!catalog) return out
    const byId = new Map(catalog.emojis.map((e) => [e.id, e]))
    out.set('fantasy', catalog.fantasy.map((id) => byId.get(id)).filter((e): e is EmojiCatalogRow => Boolean(e)))
    for (const e of catalog.emojis) {
      const list = out.get(e.category) ?? []
      list.push(e)
      out.set(e.category, list)
    }
    return out
  }, [catalog])

  const filtered = useMemo(() => {
    if (!catalog) return []
    if (search.trim()) return searchEmojiCatalog(catalog.emojis, search)
    return byTab.get(activeCat) ?? []
  }, [search, catalog, byTab, activeCat])

  const pick = useCallback(
    (char: string) => {
      pushRecent(char)
      setRecent(readRecent())
      onSelect(char)
    },
    [onSelect]
  )

  const tabs = (catalog?.categories ?? []).filter((c) => (byTab.get(c.key)?.length ?? 0) > 0)

  return (
    <div className="mb-2 max-h-72 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c1e] p-3">
      <div className="mb-2 flex items-center gap-2 rounded-lg bg-white/[0.06] px-3 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-white/35" aria-hidden />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search emojis..."
          className="min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-white/35"
        />
        <button type="button" onClick={onClose} className="text-[10px] text-white/40 hover:text-white">
          Done
        </button>
      </div>

      {!search.trim() && recent.length > 0 ? (
        <div className="mb-2">
          <p className="mb-1 text-[9px] uppercase tracking-wide text-white/35">Recent</p>
          <div className="flex flex-wrap gap-1">
            {recent.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => pick(c)}
                className="rounded-lg p-1 text-[22px] hover:bg-white/[0.06]"
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {!search.trim() ? (
        <div className="mb-2 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none]">
          {tabs.map((cat) => (
            <button
              key={cat.key}
              type="button"
              onClick={() => setActiveCat(cat.key)}
              className={`shrink-0 rounded-lg px-2 py-1 text-[16px] transition-colors ${
                activeCat === cat.key ? 'bg-cyan-500/15 text-cyan-300' : 'text-white/50 hover:bg-white/[0.06]'
              }`}
              title={cat.label}
              aria-label={cat.label}
              aria-pressed={activeCat === cat.key}
            >
              <span aria-hidden="true">{cat.icon}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="max-h-44 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
        {loading ? (
          <div className="grid grid-cols-8 gap-1">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded-lg bg-white/[0.06]" />
            ))}
          </div>
        ) : failed ? (
          <p className="px-1 py-3 text-[12px] text-white/45">Emoji did not load. Close this and try again.</p>
        ) : search.trim() && filtered.length === 0 ? (
          <p className="px-1 py-3 text-[12px] text-white/45">No emoji for &ldquo;{search.trim()}&rdquo;.</p>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {filtered.map((e) => (
              <button
                key={e.id}
                type="button"
                title={e.name}
                aria-label={e.name}
                onClick={() => pick(e.char)}
                className="rounded-lg p-1 text-[22px] transition-colors hover:bg-white/[0.06]"
              >
                {e.char}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
