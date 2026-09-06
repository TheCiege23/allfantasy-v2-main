'use client'

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { playerRef } from '@/lib/core-app/playerRef'
import { normalizePosition } from '@/lib/core-app/positionNormalization'
import { suggestionChip } from '@/lib/core-app/suggestionChip'
import type { SuggestionPresence } from '@/lib/core-app/playerSuggest'
import { PlayerAvatar, TeamLogo } from '@/components/core-app/player-finder/PlayerMarks'

/**
 * The Player Finder's search box, with suggestions as you type.
 *
 * The form is the same GET to /core/players it always was — Enter or Search
 * still runs the full search and renders the page — and the suggestions are
 * a layer on top of it that never has to work for the search to work. They
 * come from `/api/core/players/suggest` (lib/core-app/playerSuggest.ts): the
 * finder's own catalog search, ranked prefix-first and then by who is in
 * your leagues, each row carrying a chip — "yours in Dynasty Dragons",
 * "@tashaR has him in Gridiron Gang", "free in 4 leagues". Debounced at
 * 300ms and cached per query so backspacing does not refetch.
 *
 * ⚠ THAT ENDPOINT IS RATE LIMITED PER IP (40 a minute). A 429 is expected
 * behaviour under fast typing, not an error: the list simply stays closed
 * until the next keystroke after the cooldown, and the form keeps working
 * throughout. Nothing is retried in a loop.
 *
 * Each suggestion links to the same URL the match list uses — sport-qualified
 * `player=` param, the held league carried — so picking one lands on exactly
 * the page a search-and-click would have. Enter on a highlighted row clicks
 * that row's own link rather than reaching for the app router: the same
 * client-side transition, and no router context needed, which also keeps this
 * renderable on the public /players page and in a plain test render.
 */

export type SearchHit = {
  /** SportsPlayer.externalId, when the API is new enough to send it; the link degrades to a name search without it. */
  externalId?: string | null
  sleeperId: string | null
  name: string
  sport: string
  position: string | null
  team: string | null
  imageUrl: string | null
  /** Where he is in your leagues; absent when signed out or unjoinable. */
  presence?: SuggestionPresence | null
}

const DEBOUNCE_MS = 300
const MIN_CHARS = 2
const LIMIT = 8

function hitHref(h: SearchHit, leagueParam: string, compareWith: string | null | undefined, query: string): string {
  const ref = h.externalId ? playerRef(h.sport, h.externalId) : null
  if (compareWith) {
    // A second name beside the first: the open player stays, the hit becomes `vs`.
    const vs = ref ? `&vs=${encodeURIComponent(ref)}` : ''
    return `/core/players?q=${encodeURIComponent(query)}&player=${encodeURIComponent(compareWith)}${vs}${leagueParam}`
  }
  const q = `q=${encodeURIComponent(h.name)}`
  const player = ref ? `&player=${encodeURIComponent(ref)}` : ''
  return `/core/players?${q}${player}${leagueParam}`
}

/**
 * One row per athlete. The catalog holds a row per source and the API does not
 * fold them — measured on production, "kinc" returns Dalton Kincaid twice, as
 * `TE · BUF` from Sleeper and `Tight End · Buffalo Bills` from TheSportsDB. The
 * position is folded through the same normalizer the rest of the finder uses,
 * the Sleeper-keyed row wins (it is the one every roster join needs), and a
 * headshot is borrowed from the row that lost if the winner has none.
 */
function dedupe(rows: SearchHit[]): SearchHit[] {
  const seen = new Map<string, SearchHit>()
  for (const r of rows) {
    const key = `${r.sport}:${(r.name ?? '').trim().toLowerCase()}:${normalizePosition(r.position)}`
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, r)
      continue
    }
    const winner = !existing.sleeperId && r.sleeperId ? r : existing
    const loser = winner === r ? existing : r
    seen.set(key, { ...winner, imageUrl: winner.imageUrl ?? loser.imageUrl ?? null })
  }
  return [...seen.values()]
}

export function PlayerSearchBox({
  query,
  selectedLeagueId,
  signedIn,
  variant = 'search',
  compareWith = null,
}: {
  query: string
  selectedLeagueId: string | null
  signedIn: boolean
  /**
   * `compare`: the box picks a SECOND player beside the one already open —
   * every hit links to `?player=<compareWith>&vs=<hit>`, the input starts
   * empty, and Enter without a highlighted row does nothing (there is no
   * "search for the second player" page to submit to).
   */
  variant?: 'search' | 'compare'
  /** The open player's sport-qualified ref (lib/core-app/playerRef.ts); required for `compare`. */
  compareWith?: string | null
}) {
  const compare = variant === 'compare' && Boolean(compareWith)
  const [value, setValue] = useState(compare ? '' : query)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const cache = useRef(new Map<string, SearchHit[]>())
  const cooldownUntil = useRef(0)
  const leagueParam = selectedLeagueId ? `&league=${encodeURIComponent(selectedLeagueId)}` : ''

  const term = value.trim()

  useEffect(() => {
    if (term.length < MIN_CHARS) {
      setHits([])
      setOpen(false)
      setActive(-1)
      return
    }
    const cached = cache.current.get(term.toLowerCase())
    if (cached) {
      setHits(cached)
      setOpen(cached.length > 0)
      setActive(-1)
      return
    }
    if (Date.now() < cooldownUntil.current) return

    const ctl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/core/players/suggest?q=${encodeURIComponent(term)}&limit=${LIMIT}`, { signal: ctl.signal })
        if (res.status === 429) {
          const retry = Number.parseInt(res.headers.get('Retry-After') ?? '', 10)
          cooldownUntil.current = Date.now() + (Number.isFinite(retry) ? retry : 30) * 1000
          setHits([])
          setOpen(false)
          return
        }
        if (!res.ok) return
        const data = (await res.json()) as unknown
        const rows = dedupe(Array.isArray(data) ? (data as SearchHit[]) : [])
        cache.current.set(term.toLowerCase(), rows)
        setHits(rows)
        setOpen(rows.length > 0)
        setActive(-1)
      } catch {
        // Aborted by the next keystroke, or offline: the form still works.
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [term])

  const hrefs = useMemo(
    () => hits.map((h) => hitHref(h, leagueParam, compare ? compareWith : null, query)),
    [hits, leagueParam, compare, compareWith, query],
  )
  // Two boxes can share a screen (the search rail and the compare card); their listboxes must not share an id.
  const listId = compare ? 'af-pf-suggest-vs' : 'af-pf-suggest'

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || hits.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % hits.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? hits.length - 1 : i - 1))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      setOpen(false)
      document.getElementById(`${listId}-${active}`)?.querySelector('a')?.click()
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  const label = compare ? 'Compare with another player' : 'Search any player'

  return (
    <form
      className={`af-pf-search-wrap${compare ? ' af-pf-search-wrap--compare' : ''}`}
      method="get"
      action="/core/players"
      onSubmit={compare ? (e) => e.preventDefault() : undefined}
    >
      {/* Keeps the held league in context across a new search. */}
      {selectedLeagueId ? <input type="hidden" name="league" value={selectedLeagueId} /> : null}
      <div className="af-pf-search-field">
        <label className="af-search af-pf-search">
          <span className="af-search-icon" aria-hidden>
            {compare ? '⇄' : '○'}
          </span>
          <input
            className="af-search-input"
            name={compare ? 'vsq' : 'q'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => hits.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            placeholder={label}
            aria-label={label}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          />
          {compare ? null : (
            <button type="submit" className="af-btn af-pf-search-btn">
              Search
            </button>
          )}
        </label>
        {open && hits.length > 0 ? (
          <ul className="af-pf-suggest" id={listId} role="listbox" aria-label={compare ? 'Players to compare' : 'Suggestions'}>
            {hits.map((h, i) => (
              <li key={`${h.sport}-${h.externalId ?? h.sleeperId ?? h.name}-${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                <Link
                  href={hrefs[i]}
                  className="af-pf-suggest-item"
                  // Keep focus on the input so the blur above does not close the list before the click lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                >
                  <PlayerAvatar src={h.imageUrl} name={h.name} size={32} />
                  <span className="af-pf-suggest-text">
                    <span className="af-pf-match-name">{h.name}</span>
                    <span className="af-pf-match-meta">
                      {h.position ? `${h.position} · ` : ''}
                      <TeamLogo sport={h.sport} team={h.team} />
                      {h.team ?? 'no team on file'}
                      {h.sport && h.sport !== 'NFL' ? ` · ${h.sport}` : ''}
                    </span>
                    {/* Where he is in your leagues — its own line, so a long name never has to make room for it. */}
                    {(() => {
                      const chip = suggestionChip(h.presence)
                      return chip ? (
                        <span className="af-chip af-pf-suggest-chip" data-tone={chip.tone}>
                          {chip.text}
                        </span>
                      ) : null
                    })()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {compare ? null : (
        <p className="af-pf-search-note">
          {signedIn
            ? 'Searches every platform you have connected at once — Sleeper, ESPN and Yahoo.'
            : 'One search covers Sleeper, ESPN and Yahoo at once. Connect a league to see your own slots and matchups.'}
        </p>
      )}
    </form>
  )
}

export default PlayerSearchBox
