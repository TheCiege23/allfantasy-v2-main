'use client'

/**
 * User OS League-Specific Intelligence Wiring phase — Part 13.
 *
 * A summary widget, not a redesign — reuses the same dark/opacity-token
 * Tailwind convention as `UniversalLeagueCard.tsx`. Shows only what Part 13
 * asks for: urgent-action count, the single highest-priority
 * recommendation, domain badges, freshness, and a link to the full list.
 * Never renders an empty placeholder — distinguishes "no action needed"
 * from "data unavailable"/"sync required"/"domain unsupported"/"engine
 * failure" using the API's real `domainStatus` map, never guessing from an
 * empty array alone.
 */
import { useEffect, useState } from 'react'
import { useActiveLeagueContext } from './ActiveLeagueContextProvider'

interface RecommendationSummary {
  domain: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  title: string
  summary: string
}

interface RecommendationsApiResponse {
  bundle: Record<string, RecommendationSummary[] | number>
  domainStatus: Record<string, 'ok' | 'unavailable' | 'unsupported' | 'stale_blocked' | 'engine_error'>
  generatedAt: string
}

const PRIORITY_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 }
const PRIORITY_DOT: Record<string, string> = {
  critical: 'bg-red-400',
  high: 'bg-amber-400',
  medium: 'bg-sky-400',
  low: 'bg-white/30',
}

const DOMAIN_LABEL: Record<string, string> = {
  lineup: 'Lineup',
  waiver: 'Waiver',
  trade: 'Trade',
  roster: 'Roster',
  playoff: 'Playoff',
  strategy: 'Strategy',
}

function flattenAndSortRecommendations(bundle: RecommendationsApiResponse['bundle']): RecommendationSummary[] {
  const all: RecommendationSummary[] = []
  for (const key of Object.keys(bundle)) {
    if (key === 'totalCount') continue
    const list = bundle[key]
    if (Array.isArray(list)) all.push(...list)
  }
  return all.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority])
}

export function UserOsActionsSummary() {
  const { context } = useActiveLeagueContext()
  const [data, setData] = useState<RecommendationsApiResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!context?.canonicalLeagueId) {
      setData(null)
      return
    }
    let active = true
    setIsLoading(true)
    setError(null)
    fetch(`/api/league-hub/context/${encodeURIComponent(context.canonicalLeagueId)}/recommendations`, {
      cache: 'no-store',
    })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error('Failed to load recommendations'))
      )
      .then((payload: RecommendationsApiResponse) => {
        if (!active) return
        setData(payload)
      })
      .catch(() => {
        if (!active) return
        setError('Could not load recommendations for this league')
      })
      .finally(() => {
        if (!active) return
        setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [context?.canonicalLeagueId])

  if (!context) return null

  return (
    <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4" data-testid="user-os-actions-summary">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-white/70">Recommended actions</h2>
        <a href={`/league/${context.canonicalLeagueId}?tab=team`} className="text-xs text-cyan-400 underline">
          View all
        </a>
      </div>

      {isLoading ? (
        <div className="mt-3 h-16 animate-pulse rounded-lg border border-white/10 bg-white/5" aria-busy="true" />
      ) : error ? (
        <p className="mt-3 text-sm text-red-300">{error}</p>
      ) : (
        <UserOsActionsBody data={data} />
      )}
    </section>
  )
}

function UserOsActionsBody({ data }: { data: RecommendationsApiResponse | null }) {
  if (!data) return null

  const recommendations = flattenAndSortRecommendations(data.bundle)
  const urgentCount = recommendations.filter((r) => r.priority === 'critical' || r.priority === 'high').length
  const top = recommendations[0] ?? null

  const domainEntries = Object.entries(data.domainStatus)
  const anyUnavailable = domainEntries.some(([, status]) => status !== 'ok')

  return (
    <div className="mt-3">
      {top ? (
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[top.priority]}`} aria-hidden />
            <span className="text-[11px] font-medium uppercase tracking-wide text-white/40">
              {DOMAIN_LABEL[top.domain] ?? top.domain}
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-white">{top.title}</p>
          <p className="mt-0.5 text-xs text-white/60">{top.summary}</p>
        </div>
      ) : (
        <p className="text-sm text-white/50">
          {anyUnavailable ? 'Some recommendation types are unavailable for this league right now.' : 'No action needed right now.'}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {urgentCount > 0 ? (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300">
            {urgentCount} urgent
          </span>
        ) : null}
        {domainEntries.map(([domain, status]) => (
          <span
            key={domain}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${
              status === 'ok'
                ? 'border-white/10 bg-white/5 text-white/60'
                : 'border-white/10 bg-white/[0.03] text-white/30'
            }`}
            title={status}
          >
            {DOMAIN_LABEL[domain] ?? domain}
          </span>
        ))}
      </div>

      <p className="mt-2 text-[11px] text-white/35">Updated {new Date(data.generatedAt).toLocaleTimeString()}</p>
    </div>
  )
}
