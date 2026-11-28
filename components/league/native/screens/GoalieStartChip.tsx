'use client'

import { useEffect, useState } from 'react'
import type { GoalieStartProjection } from '@/lib/nhl/goalieStarts'

/**
 * A goalie's next start, on the lineup and waiver rows of an NHL league (2026-11-28).
 *
 * ⚠ ALWAYS SAYS "PROJECTED" UNTIL THE GAME HAS STARTED. The projection is our own read of the team's
 * recent starts and back-to-backs (lib/nhl/goalieStarts.ts); nobody publishes confirmed starters to us.
 * Once his game is under way the box score says who is in net, and only then does the chip say so.
 * The reason behind every projection is in the chip's title, so the read can be checked, not trusted.
 *
 * One request per page (shared), matched to a row by name: the screens hold different player ids
 * (Sleeper, Rolling Insights, Fantrax), and NHL goalie names do not collide.
 */

type Entry = { projection: GoalieStartProjection; role: 'starter' | 'alternate' }

let cache: Promise<Map<string, Entry>> | null = null

export function goalieNameKey(name: string | null | undefined): string {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
}

function load(): Promise<Map<string, Entry>> {
  if (!cache) {
    cache = fetch('/api/nhl/goalie-starts?days=3')
      .then((r) => (r.ok ? r.json() : { projections: [] }))
      .then((d: { projections?: GoalieStartProjection[] }) => {
        const byName = new Map<string, Entry>()
        // Earliest game first: a goalie's chip is about his NEXT game.
        const list = [...(d.projections ?? [])].sort((a, b) => a.day.localeCompare(b.day))
        for (const p of list) {
          const k = goalieNameKey(p.goalie.name)
          if (!byName.has(k)) byName.set(k, { projection: p, role: 'starter' })
          if (p.alternate) {
            const a = goalieNameKey(p.alternate.name)
            if (!byName.has(a)) byName.set(a, { projection: p, role: 'alternate' })
          }
        }
        return byName
      })
      .catch(() => new Map())
  }
  return cache
}

/** For tests. */
export function resetGoalieStartsCache() {
  cache = null
}

export function useGoalieStarts(enabled: boolean) {
  const [map, setMap] = useState<Map<string, Entry> | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    void load().then((m) => alive && setMap(m))
    return () => {
      alive = false
    }
  }, [enabled])
  return (name: string | null | undefined): Entry | null => (map ? map.get(goalieNameKey(name)) ?? null : null)
}

function when(day: string, today: string): string {
  if (day === today) return 'tonight'
  const d = new Date(`${day}T12:00:00Z`)
  return d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })
}

function easternToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export function GoalieStartChip({ entry }: { entry: Entry | null }) {
  if (!entry) return null
  const { projection: p, role } = entry
  const at = when(p.day, easternToday())
  let text: string
  let tone: 'in' | 'start' | 'lean' | 'bench'
  if (p.status === 'in_net') {
    // In a game under way, the alternate is a goalie who has ALSO played: he came on in relief.
    text = role === 'starter' ? 'In net' : 'Played in relief'
    tone = 'in'
  } else if (role === 'starter') {
    text = `Proj. start ${at}${p.confidence === 'lean' ? ' (lean)' : ''}`
    tone = p.confidence === 'likely' ? 'start' : 'lean'
  } else {
    text = `Proj. backup ${at}`
    tone = 'bench'
  }
  return (
    <span className="nls-goalie-chip" data-tone={tone} title={`${p.basis} Projected from recent starts — not a confirmed lineup.`} data-testid="goalie-start-chip">
      {text}
    </span>
  )
}
