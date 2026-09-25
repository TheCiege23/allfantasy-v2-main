'use client'

import { useCallback, useEffect, useState } from 'react'
import { Search } from 'lucide-react'

function GiphyAttributionFooter() {
  const [imgFailed, setImgFailed] = useState(false)

  if (imgFailed) {
    return (
      <a
        href="https://giphy.com"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[9px] font-semibold uppercase tracking-widest text-white/40 transition-colors hover:text-white/70"
      >
        Powered By GIPHY
      </a>
    )
  }

  return (
    <a
      href="https://giphy.com"
      target="_blank"
      rel="noopener noreferrer"
      className="opacity-50 transition-opacity hover:opacity-90"
    >
      <img
        src="/powered-by-giphy.gif"
        alt="Powered By GIPHY"
        className="h-[14px] w-auto"
        onError={() => setImgFailed(true)}
      />
    </a>
  )
}

/*
 * Klipy's terms: the search box says "Search KLIPY", and its GIFs carry its credit. Shown only when
 * the GIFs on screen came from Klipy — the route reports which service they came from.
 */
function KlipyAttributionFooter() {
  return (
    <a
      href="https://klipy.com"
      target="_blank"
      rel="noopener noreferrer"
      className="text-[9px] font-semibold uppercase tracking-widest text-white/40 transition-colors hover:text-white/70"
    >
      Powered by KLIPY
    </a>
  )
}

export type GifProvider = 'klipy' | 'giphy' | 'tenor'

function readProvider(value: unknown): GifProvider | null {
  return value === 'klipy' || value === 'giphy' || value === 'tenor' ? value : null
}

export type GifItem = {
  id: string
  giphyId: string
  url: string
  previewUrl: string
  title: string
}

type GifPickerProps = {
  onSelect: (gif: { giphyId: string; url: string; previewUrl: string; title: string; id?: string }) => void
  onClose: () => void
}

const CATEGORIES: Array<{ label: string; value: string | null }> = [
  { label: 'All', value: null },
  { label: 'Celebration', value: 'celebration' },
  { label: 'Reaction', value: 'reaction' },
  { label: 'Sports', value: 'sports' },
  { label: 'Fantasy', value: 'fantasy' },
  { label: 'Trash Talk', value: 'trash-talk' },
]

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

export function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search, 300)
  const [category, setCategory] = useState<string | null>(null)
  const [gifs, setGifs] = useState<GifItem[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  /** Who supplied the GIFs on screen, and who a search asks — both from the route. */
  const [provider, setProvider] = useState<GifProvider | null>(null)
  const [searchProvider, setSearchProvider] = useState<GifProvider | null>(null)

  useEffect(() => {
    setPage(0)
  }, [debounced, category])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams()
      q.set('limit', '24')
      q.set('offset', String(page * 24))
      if (debounced.trim()) q.set('q', debounced.trim())
      if (category) q.set('category', category)
      const res = await fetch(`/api/chat/gifs?${q.toString()}`, { cache: 'no-store' })
      const data = (await res.json()) as { gifs?: GifItem[]; provider?: unknown; searchProvider?: unknown }
      const next = data.gifs ?? []
      if (page === 0 || next.length > 0) setProvider(readProvider(data.provider))
      setSearchProvider(readProvider(data.searchProvider))
      if (page === 0) {
        setGifs(next)
      } else {
        setGifs((prev) => [...prev, ...next])
      }
      setHasMore(next.length >= 24)
    } catch {
      if (page === 0) setGifs([])
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }, [page, debounced, category])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="relative mb-2 max-h-64 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c1e] p-3">
      <div className="mb-2 flex items-center gap-2 rounded-lg bg-white/[0.06] px-3 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-white/35" aria-hidden />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={searchProvider === 'klipy' ? 'Search KLIPY' : 'Search GIFs...'}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-white/35"
          data-testid="gif-picker-search"
        />
        <button type="button" onClick={onClose} className="text-[10px] text-white/40 hover:text-white">
          Done
        </button>
      </div>

      {!debounced.trim() ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => setCategory(c.value)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                category === c.value
                  ? 'bg-cyan-500/15 text-cyan-400'
                  : 'bg-white/[0.06] text-white/50 hover:bg-white/[0.1]'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="max-h-44 overflow-y-auto [scrollbar-gutter:stable]">
        {loading && page === 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-xl bg-white/[0.08]" />
            ))}
          </div>
        ) : gifs.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-white/40">No GIFs found — try a different search</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {gifs.map((g) => (
              <button
                key={`${g.id}-${g.giphyId}-${g.previewUrl}`}
                type="button"
                onClick={() => {
                  onSelect({
                    id: g.id,
                    giphyId: g.giphyId,
                    url: g.url,
                    previewUrl: g.previewUrl,
                    title: g.title,
                  })
                }}
                className="overflow-hidden rounded-xl hover:opacity-80"
              >
                <img src={g.previewUrl || g.url} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        )}
        {hasMore && !loading && gifs.length > 0 ? (
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            className="mt-2 w-full rounded-lg py-2 text-[11px] font-semibold text-cyan-400/90 hover:bg-white/[0.04]"
          >
            Load more
          </button>
        ) : null}
        {loading && page > 0 ? (
          <p className="py-2 text-center text-[10px] text-white/35">Loading…</p>
        ) : null}
      </div>

      <div className="mt-1.5 flex flex-shrink-0 items-center justify-end border-t border-white/[0.06] pt-1.5">
        {provider === 'klipy' ? <KlipyAttributionFooter /> : provider === 'giphy' ? <GiphyAttributionFooter /> : null}
      </div>
    </div>
  )
}
