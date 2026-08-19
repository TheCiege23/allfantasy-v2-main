'use client'

/**
 * Cross-League Player Intelligence phase — Part 14.
 *
 * A concise summary card, not a redesign — reuses the established dark/
 * opacity Tailwind convention. Shows only the counts Part 14 asks for
 * (players needing action, injury exposure, bye-week exposure, top action)
 * and links to `/my-players` for the full workspace. Never shows a fake
 * zero when data is genuinely unavailable — distinguishes "loading" from
 * "zero real leagues connected" from "error."
 */
import { useEffect, useState } from 'react'

interface CrossLeaguePlayerPortfolioItem {
  canonicalPlayerId: string
  displayName: string
  injury: { status: string } | null
  schedule: { byeWeek: number | null } | null
  actionSummary: { criticalCount: number; highCount: number; topAction: { title: string; summary: string } | null }
}

interface PortfolioApiResponse {
  items: CrossLeaguePlayerPortfolioItem[]
  connectedLeagueCount: number
}

const HIGH_INJURY_STATUSES = new Set(['out', 'ir', 'suspended', 'doubtful', 'questionable'])

export function CrossLeaguePlayerSummary() {
  const [data, setData] = useState<PortfolioApiResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/player-portfolio?sort=action_urgency', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((payload: PortfolioApiResponse) => {
        if (active) setData(payload)
      })
      .catch(() => {
        if (active) setError('Could not load your players right now.')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  if (isLoading) {
    return <div className="mt-6 h-20 animate-pulse rounded-xl border border-white/10 bg-white/5" aria-busy="true" />
  }
  if (error) {
    return <p className="mt-6 text-sm text-red-300">{error}</p>
  }
  if (!data || data.connectedLeagueCount === 0) return null

  const actionNeeded = data.items.filter((i) => i.actionSummary.criticalCount > 0 || i.actionSummary.highCount > 0)
  const injured = data.items.filter((i) => i.injury && HIGH_INJURY_STATUSES.has(i.injury.status))
  const onBye = data.items.filter((i) => i.schedule?.byeWeek != null)
  const topAction = actionNeeded[0]?.actionSummary.topAction ?? null

  return (
    <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4" data-testid="cross-league-player-summary">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-white/70">My Players</h2>
        <a href="/my-players" className="text-xs text-cyan-400 underline">
          View all
        </a>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {actionNeeded.length > 0 ? (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300">
            {actionNeeded.length} need action
          </span>
        ) : null}
        {injured.length > 0 ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
            {injured.length} injured
          </span>
        ) : null}
        {onBye.length > 0 ? (
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/60">
            {onBye.length} on bye
          </span>
        ) : null}
        {actionNeeded.length === 0 && injured.length === 0 && onBye.length === 0 ? (
          <span className="text-sm text-white/50">No action needed right now.</span>
        ) : null}
      </div>

      {topAction ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
          <p className="text-sm font-semibold text-white">{topAction.title}</p>
          <p className="mt-0.5 text-xs text-white/60">{topAction.summary}</p>
        </div>
      ) : null}
    </section>
  )
}
