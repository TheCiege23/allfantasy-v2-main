'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

export type MentionType = '@global' | '@chimmy' | '@all' | '@username' | '#player' | '#league'

/**
 * WHICH SIGIL OPENED THE LIST.
 *
 * `@` has always meant "a person, and notify them". Player names needed their
 * own trigger rather than joining that list: `@mahomes` would look like a user
 * mention, and the mention notifier would go looking for a member by that name
 * and quietly find nobody. `#` means "a thing in the league" — a player or one
 * of your leagues — and inserts a plain name that notifies no one.
 */
export type MentionTrigger = '@' | '#'

export type MentionSuggestion = {
  type: MentionType
  value: string
  label: string
  description?: string
  avatarUrl?: string
}

/** A league the writer belongs to, for the `#` list. Matched on the client. */
export type AutocompleteLeague = { id: string; name: string }

export function useMentionAutocomplete({
  text,
  cursorPos,
  leagueId,
  chatType,
  isCommissioner,
  leagues,
  sport,
}: {
  text: string
  cursorPos: number
  leagueId?: string | null
  chatType: 'league' | 'huddle' | 'dm' | 'chimmy' | 'draft'
  isCommissioner?: boolean
  /** The writer's own leagues, so `#` can offer them without a round trip. */
  leagues?: AutocompleteLeague[]
  /** Narrows the player catalog when the surface knows its sport. */
  sport?: string | null
}) {
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([])
  const [atQuery, setAtQuery] = useState<string | null>(null)
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null)

  const active = useMemo((): { trigger: MentionTrigger; query: string } | null => {
    const before = text.slice(0, cursorPos)
    const at = before.match(/@(\w*)$/)
    if (at) return { trigger: '@', query: at[1]!.toLowerCase() }
    /*
     * Player names contain spaces, so `#` accepts them — but only up to a
     * point. Without a cap, `#` typed once would keep the list open for the
     * rest of the message and search on every word after it.
     */
    const hash = before.match(/#([\w']*(?: [\w']*){0,2})$/)
    if (hash) return { trigger: '#', query: hash[1]!.toLowerCase() }
    return null
  }, [text, cursorPos])

  const staticPart = active?.trigger === '@' ? active.query : null

  const buildStatic = useCallback(
    (query: string): MentionSuggestion[] => {
      const results: MentionSuggestion[] = []
      if (chatType === 'chimmy') return results

      if (isCommissioner && chatType !== 'dm' && chatType !== 'draft' && 'global'.startsWith(query)) {
        results.push({
          type: '@global',
          value: '@global ',
          label: '@global',
          description: 'Broadcast to all your leagues',
        })
      }

      if ('chimmy'.startsWith(query)) {
        results.push({
          type: '@chimmy',
          value: '@chimmy ',
          label: '@chimmy',
          description: 'Private message to Chimmy AI (only you see this)',
        })
      }

      if ((chatType === 'league' || chatType === 'huddle') && 'all'.startsWith(query)) {
        results.push({
          type: '@all',
          value: '@all ',
          label: '@all',
          description: 'Notify everyone in this chat',
        })
      }

      return results
    },
    [chatType, isCommissioner]
  )

  /*
   * `#` offers the writer's own leagues, matched here rather than fetched: the
   * list is already on the client, and a round trip to filter a dozen names the
   * browser is holding would be silly.
   */
  const leagueMatches = useCallback(
    (query: string): MentionSuggestion[] => {
      if (!query || !leagues?.length) return []
      return leagues
        .filter((l) => l.name.toLowerCase().includes(query))
        .slice(0, 4)
        .map((l) => ({
          type: '#league' as MentionType,
          value: `${l.name} `,
          label: l.name,
          description: 'League',
        }))
    },
    [leagues],
  )

  useEffect(() => {
    if (active?.trigger !== '#') return
    const query = active.query

    setTrigger('#')
    setAtQuery(query)

    /*
     * The catalog search allows 30 requests a minute per IP and wants at least
     * two characters. A short debounce here would spend that budget on prefixes
     * nobody meant to search, so this waits longer than the `@` list does and
     * will not fire on a single letter.
     */
    if (query.length < 2) {
      setSuggestions(leagueMatches(query))
      return
    }

    const handle = window.setTimeout(() => {
      const base = leagueMatches(query)
      void fetch(
        `/api/players/search?q=${encodeURIComponent(query)}&limit=6${sport ? `&sport=${encodeURIComponent(sport)}` : ''}`,
        { cache: 'no-store' },
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((data: unknown) => {
          const rows = Array.isArray(data)
            ? data
            : Array.isArray((data as { players?: unknown } | null)?.players)
              ? (data as { players: unknown[] }).players
              : []
          const playerSug: MentionSuggestion[] = []
          for (const row of rows) {
            const r = row as { name?: unknown; position?: unknown; team?: unknown; imageUrl?: unknown }
            const name = typeof r.name === 'string' ? r.name.trim() : ''
            if (!name) continue
            const meta = [r.position, r.team].filter((v) => typeof v === 'string' && v).join(' · ')
            playerSug.push({
              /*
               * The inserted text is the plain name. `#` is a way to find it,
               * not something the reader should end up seeing.
               */
              type: '#player',
              value: `${name} `,
              label: name,
              description: meta || 'Player',
              avatarUrl: typeof r.imageUrl === 'string' ? r.imageUrl : undefined,
            })
          }
          setSuggestions([...base, ...playerSug])
        })
        /* A rate-limited or failed search leaves the league matches standing. */
        .catch(() => setSuggestions(base))
    }, 300)

    return () => window.clearTimeout(handle)
  }, [active, leagueMatches, sport])

  useEffect(() => {
    if (staticPart === null) {
      /* Only clear when `#` is not the one holding the list open. */
      if (active?.trigger !== '#') {
        setTrigger(null)
        setAtQuery(null)
        setSuggestions([])
      }
      return
    }
    setTrigger('@')
    setAtQuery(staticPart)

    const handle = window.setTimeout(() => {
      const base = buildStatic(staticPart)
      if (chatType === 'chimmy' || !leagueId || staticPart.length < 1) {
        setSuggestions(base)
        return
      }

      void fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/members/autocomplete?q=${encodeURIComponent(staticPart)}`,
        { cache: 'no-store' }
      )
        .then((r) => (r.ok ? r.json() : []))
        .then((list: { username: string; displayName: string; avatarUrl?: string }[]) => {
          const memberSug: MentionSuggestion[] = Array.isArray(list)
            ? list.map((m) => ({
                type: '@username' as MentionType,
                value: `@${m.username} `,
                label: `@${m.username}`,
                description: m.displayName,
                avatarUrl: m.avatarUrl,
              }))
            : []
          setSuggestions([...base, ...memberSug])
        })
        .catch(() => setSuggestions(base))
    }, 200)

    return () => window.clearTimeout(handle)
  }, [staticPart, leagueId, chatType, buildStatic, active])

  return { suggestions, atQuery, trigger }
}
