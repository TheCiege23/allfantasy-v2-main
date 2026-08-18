'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'

/**
 * Top-bar player search with autocomplete.
 *
 * ⚠ THIS REPLACED A LINK, AND THE REASON THE LINK EXISTED STILL APPLIES. The bar
 * used to be an `<a>` to /core/players, deliberately: a box that looks like
 * search but does nothing until JS mounts is worse than a control that
 * navigates. So this keeps that property — the form's action is the same
 * /core/players search, and submitting works with JavaScript disabled or before
 * hydration. The dropdown is an enhancement on top of a control that already
 * worked, not a replacement for it.
 *
 * ⚠ NO NEW ROUTE. /api/players/search already exists and is built for exactly
 * this: its own header documents a 250ms-debounced autocomplete, it returns
 * `imageUrl`, and it is rate limited at 30/min per IP. The repo sits at Vercel's
 * 2048-route ceiling, so adding an endpoint for this would not have been free.
 *
 * ⚠ THE DEBOUNCE IS NOT COSMETIC. That limit is 30 requests per minute per IP;
 * a keystroke-per-request search bar burns it in two seconds of typing and the
 * user gets a 429 instead of results. 250ms matches what the endpoint documents.
 */

type Hit = {
  id: string
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
}

export function PlayerSearch({ leagueCount = null }: { leagueCount?: number | null }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const placeholder =
    leagueCount && leagueCount > 0
      ? `Any player, across all ${leagueCount} leagues`
      : 'Search any player'

  useEffect(() => {
    const term = q.trim()
    /* The endpoint requires min length 2; below that it 400s, so do not ask. */
    if (term.length < 2) {
      setHits([])
      setLoading(false)
      return
    }
    setLoading(true)
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/players/search?q=${encodeURIComponent(term)}&limit=8`,
          { signal: ctl.signal, cache: 'no-store' },
        )
        if (!res.ok) {
          /* A 429 is the rate limiter, not an empty catalog. Showing "no
             players found" for it would be a measured claim nobody measured. */
          setHits([])
          return
        }
        const data = (await res.json()) as Hit[]
        setHits(Array.isArray(data) ? data : [])
        setActive(-1)
      } catch {
        /* Aborted or offline — leave the previous list rather than flashing empty. */
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [q])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function go(hit: Hit) {
    setOpen(false)
    setQ('')
    router.push(`/core/players?player=${encodeURIComponent(hit.id)}`)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open || hits.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % hits.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? hits.length - 1 : i - 1))
    } else if (e.key === 'Enter' && active >= 0) {
      /* Only intercept Enter when a suggestion is highlighted; otherwise let the
         form submit through to the full search page. */
      e.preventDefault()
      const hit = hits[active]
      if (hit) go(hit)
    }
  }

  const showList = open && q.trim().length >= 2

  return (
    <div className="af-d2-topbar-search-wrap" ref={wrapRef}>
      <form action="/core/players" method="get" className="af-d2-topbar-search" role="search">
        <span className="af-d2-topbar-search-icon" aria-hidden>
          ⌕
        </span>
        <input
          type="search"
          name="q"
          className="af-d2-topbar-search-input"
          placeholder={placeholder}
          aria-label="Search any player"
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-autocomplete="list"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <span className="af-d2-topbar-kbd af-num" aria-hidden>
          ⌘K
        </span>
      </form>

      {showList ? (
        <ul className="af-d2-ac" id={listId} role="listbox" aria-label="Player results">
          {hits.length === 0 ? (
            <li className="af-d2-ac-empty" role="presentation">
              {loading ? 'Searching…' : 'No players match that.'}
            </li>
          ) : (
            hits.map((hit, i) => (
              <li key={hit.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={`af-d2-ac-row${i === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(hit)}
                >
                  <span className="af-d2-ac-img" aria-hidden>
                    {hit.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={hit.imageUrl} alt="" loading="lazy" />
                    ) : (
                      initialsOf(hit.name)
                    )}
                  </span>
                  <span className="af-d2-ac-text">
                    <span className="af-d2-ac-name">{hit.name}</span>
                    <span className="af-d2-ac-meta af-num">
                      {[hit.position, hit.team].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}

export default PlayerSearch
