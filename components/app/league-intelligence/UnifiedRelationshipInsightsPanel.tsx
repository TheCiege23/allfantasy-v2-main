'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { BrainCircuit, Link2, RefreshCw } from 'lucide-react'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'

type StorylineRow = {
  id: string
  headline: string
  storylineScore: number
  rivalryId: string | null
  rivalryTier: string | null
  dramaEventId: string | null
  dramaType: string | null
  managerAId: string | null
  managerBId: string | null
  reasons: string[]
}

type InsightsPayload = {
  leagueId: string
  sport: string | null
  season: number | null
  relationshipProfile: {
    strongestRivalries: unknown[]
    influenceLeaders: unknown[]
    centralManagers: unknown[]
  }
  rivalries: Array<{ id: string }>
  profiles: Array<{ id: string }>
  drama: Array<{ id: string }>
  storylines: StorylineRow[]
}

const SPORT_LABELS: Record<string, string> = {
  NCAAB: 'NCAA Basketball',
  NCAAF: 'NCAA Football',
}

function sportLabel(sport: string): string {
  return SPORT_LABELS[sport] ?? sport
}

export function UnifiedRelationshipInsightsPanel({ leagueId }: { leagueId: string }) {
  const currentYear = new Date().getUTCFullYear()
  const [sportFilter, setSportFilter] = useState<string>('ALL')
  const [seasonFilter, setSeasonFilter] = useState<string>(String(currentYear))
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<InsightsPayload | null>(null)
  const [explainByRow, setExplainByRow] = useState<Record<string, string>>({})
  const [explainLoadingId, setExplainLoadingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!leagueId) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ syncGraphRivalryEdges: '1', limit: '20' })
      if (sportFilter !== 'ALL') params.set('sport', sportFilter)
      const seasonNumber = Number(seasonFilter)
      if (!Number.isNaN(seasonNumber) && seasonNumber > 0) {
        params.set('season', String(seasonNumber))
      }
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/relationship-insights?${params.toString()}`,
        { cache: 'no-store' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load relationship insights')
      setPayload(data as InsightsPayload)
    } catch (e) {
      setPayload(null)
      setError(e instanceof Error ? e.message : 'Failed to load relationship insights')
    } finally {
      setLoading(false)
    }
  }, [leagueId, sportFilter, seasonFilter])

  const syncLayer = useCallback(async () => {
    if (!leagueId) return
    setSyncing(true)
    setError(null)
    try {
      const seasonNumber = Number(seasonFilter)
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/relationship-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(sportFilter !== 'ALL' ? { sport: sportFilter } : {}),
          ...(!Number.isNaN(seasonNumber) && seasonNumber > 0 ? { season: seasonNumber } : {}),
          rebuildGraph: true,
          runRivalry: true,
          runDrama: true,
          runProfiles: false,
          syncGraphRivalryEdges: true,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to refresh integrated layer')
      setPayload((data?.insights as InsightsPayload) ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh integrated layer')
    } finally {
      setSyncing(false)
    }
  }, [leagueId, sportFilter, seasonFilter])

  const explain = useCallback(
    async (row: StorylineRow) => {
      if (explainByRow[row.id]) {
        setExplainByRow((prev) => {
          const next = { ...prev }
          delete next[row.id]
          return next
        })
        return
      }
      setExplainLoadingId(row.id)
      try {
        const seasonNumber = Number(seasonFilter)
        const res = await fetch(
          `/api/leagues/${encodeURIComponent(leagueId)}/relationship-insights/explain`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...(sportFilter !== 'ALL' ? { sport: sportFilter } : {}),
              ...(!Number.isNaN(seasonNumber) && seasonNumber > 0 ? { season: seasonNumber } : {}),
              ...(row.rivalryId ? { focusRivalryId: row.rivalryId } : {}),
              ...(row.dramaEventId ? { focusDramaEventId: row.dramaEventId } : {}),
              ...(row.managerAId ? { focusManagerId: row.managerAId } : {}),
            }),
          }
        )
        const data = await res.json().catch(() => ({}))
        setExplainByRow((prev) => ({
          ...prev,
          [row.id]: data?.narrative ?? 'No relationship explanation available.',
        }))
      } catch {
        setExplainByRow((prev) => ({
          ...prev,
          [row.id]: 'Could not generate relationship explanation.',
        }))
      } finally {
        setExplainLoadingId(null)
      }
    },
    [leagueId, sportFilter, seasonFilter, explainByRow]
  )

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-cyan-200 flex items-center gap-2">
          <Link2 className="h-4 w-4" />
          Unified Relationship & Storytelling Layer
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sportFilter}
            onChange={(e) => setSportFilter(e.target.value)}
            className="rounded border border-white/20 bg-black/40 px-2 py-1 text-xs text-white/85"
            aria-label="Unified insights sport filter"
          >
            <option value="ALL">All sports</option>
            {SUPPORTED_SPORTS.map((sport) => (
              <option key={sport} value={sport}>
                {sportLabel(sport)}
              </option>
            ))}
          </select>
          <input
            value={seasonFilter}
            onChange={(e) => setSeasonFilter(e.target.value)}
            type="number"
            aria-label="Unified insights season filter"
            className="w-24 rounded border border-white/20 bg-black/40 px-2 py-1 text-xs text-white/85"
          />
          <button
            type="button"
            onClick={() => void load()}
            className="rounded border border-white/20 bg-white/5 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void syncLayer()}
            disabled={syncing}
            className="inline-flex items-center gap-1 rounded border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync layer'}
          </button>
        </div>
      </div>

      {loading && <p className="mt-3 text-xs text-white/60">Loading unified relationship insights…</p>}
      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}

      {!loading && payload && (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-white/10 bg-black/20 p-2">
              <p className="text-[11px] text-white/50">Rivalries</p>
              <p className="text-sm text-white/90">{payload.rivalries.length}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-2">
              <p className="text-[11px] text-white/50">Behavior profiles</p>
              <p className="text-sm text-white/90">{payload.profiles.length}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-2">
              <p className="text-[11px] text-white/50">Drama events</p>
              <p className="text-sm text-white/90">{payload.drama.length}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-2">
              <p className="text-[11px] text-white/50">Unified storylines</p>
              <p className="text-sm text-white/90">{payload.storylines.length}</p>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {payload.storylines.length === 0 && (
              <p className="rounded-lg border border-white/10 bg-black/20 p-2.5 text-xs text-white/60">
                No linked storylines for current filters.
              </p>
            )}
            {payload.storylines.map((row) => (
              <article key={row.id} className="rounded-lg border border-white/10 bg-black/20 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-white/90">{row.headline}</p>
                  <span className="ml-auto text-[11px] text-cyan-200">
                    Score {Math.round(row.storylineScore)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {row.rivalryTier && (
                    <span className="rounded border border-purple-500/25 bg-purple-500/10 px-1.5 py-0.5 text-[11px] text-purple-200">
                      {row.rivalryTier}
                    </span>
                  )}
                  {row.dramaType && (
                    <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-200">
                      {row.dramaType}
                    </span>
                  )}
                  {row.reasons.slice(0, 2).map((reason) => (
                    <span
                      key={`${row.id}-${reason}`}
                      className="rounded border border-white/15 bg-white/[0.03] px-1.5 py-0.5 text-[11px] text-white/60"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {row.rivalryId && (
                    <Link
                      href={`/app/league/${encodeURIComponent(leagueId)}/rivalries/${encodeURIComponent(
                        row.rivalryId
                      )}${sportFilter !== 'ALL' || seasonFilter ? '?' : ''}${
                        sportFilter !== 'ALL'
                          ? `sport=${encodeURIComponent(sportFilter)}${seasonFilter ? '&' : ''}`
                          : ''
                      }${
                        seasonFilter ? `season=${encodeURIComponent(seasonFilter)}` : ''
                      }`}
                      className="rounded border border-white/20 bg-white/5 px-2 py-0.5 text-[11px] text-white/75 hover:bg-white/10"
                    >
                      Rivalry context
                    </Link>
                  )}
                  {row.dramaEventId && (
                    <Link
                      href={`/app/league/${encodeURIComponent(leagueId)}/drama/${encodeURIComponent(
                        row.dramaEventId
                      )}`}
                      className="rounded border border-white/20 bg-white/5 px-2 py-0.5 text-[11px] text-white/75 hover:bg-white/10"
                    >
                      Drama context
                    </Link>
                  )}
                  {row.managerAId && row.managerBId && (
                    <Link
                      href={`/app/league/${encodeURIComponent(
                        leagueId
                      )}/psychological-profiles/compare?managerAId=${encodeURIComponent(
                        row.managerAId
                      )}&managerBId=${encodeURIComponent(row.managerBId)}${
                        sportFilter !== 'ALL' ? `&sport=${encodeURIComponent(sportFilter)}` : ''
                      }`}
                      className="rounded border border-white/20 bg-white/5 px-2 py-0.5 text-[11px] text-white/75 hover:bg-white/10"
                    >
                      Behavior context
                    </Link>
                  )}
                  <Link
                    href={`/league/${encodeURIComponent(leagueId)}?tab=Trades`}
                    className="rounded border border-white/20 bg-white/5 px-2 py-0.5 text-[11px] text-white/75 hover:bg-white/10"
                  >
                    Trade context
                  </Link>
                  <button
                    type="button"
                    onClick={() => void explain(row)}
                    className="ml-auto inline-flex items-center gap-1 rounded border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200 hover:bg-cyan-500/20"
                  >
                    <BrainCircuit className="h-3 w-3" />
                    {explainLoadingId === row.id
                      ? 'Explaining…'
                      : explainByRow[row.id]
                        ? "Hide Chimmy's explanation"
                        : 'Explain with Chimmy'}
                  </button>
                </div>
                {explainByRow[row.id] && (
                  <p className="mt-2 border-t border-white/10 pt-2 text-xs text-white/80">
                    {explainByRow[row.id]}
                  </p>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
