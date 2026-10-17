'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import TabDataState from '@/components/app/tabs/TabDataState'
import type { LeagueTabProps } from '@/components/app/tabs/types'
import { useLeagueSectionData } from '@/hooks/useLeagueSectionData'
import { MetricCard } from '@/components/app/league/SmartDataView'
import RosterBoard from '@/components/app/roster/RosterBoard'
import RosterLegacyReport from '@/app/components/RosterLegacyReport'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'

type TrendTimeframe = '24h' | '7d' | '30d'
type RosterStrategyRow = {
  strategyType: string
  strategyLabel?: string
  usageRate: number
  successRate: number
  trendingDirection: string
  leagueFormat: string
  sampleSize: number
}

export default function RosterTab({ leagueId }: LeagueTabProps) {
  const { data, loading, error, reload } =
    useLeagueSectionData<Record<string, unknown>>(leagueId, 'roster')
  const [sport, setSport] = useState<string>(DEFAULT_SPORT)
  const [trendTimeframe, setTrendTimeframe] = useState<TrendTimeframe>('7d')
  const [strategyRows, setStrategyRows] = useState<RosterStrategyRow[]>([])
  const [strategyLoading, setStrategyLoading] = useState(false)
  const [strategyError, setStrategyError] = useState<string | null>(null)
  const totalPlayers = getRosterPlayerIds((data as any)?.roster).length
  const faabRemaining = (data as any)?.faabRemaining ?? '-'
  const waiverPriority = (data as any)?.waiverPriority ?? null

  useEffect(() => {
    let active = true
    const loadLeagueSport = async () => {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}`, { cache: 'no-store' })
        const json = await res.json().catch(() => ({}))
        if (!active) return
        setSport(normalizeToSupportedSport(json?.sport))
      } catch {
        if (!active) return
        setSport(DEFAULT_SPORT)
      }
    }
    void loadLeagueSport()
    return () => {
      active = false
    }
  }, [leagueId])

  const loadRosterStrategies = useCallback(async () => {
    setStrategyLoading(true)
    setStrategyError(null)
    try {
      const params = new URLSearchParams({
        sport,
        timeframe: trendTimeframe,
      })
      const res = await fetch(`/api/strategy-meta?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.error) {
        setStrategyRows([])
        setStrategyError(json?.error ?? 'Failed to load roster strategy trends')
        return
      }
      setStrategyRows(Array.isArray(json?.data) ? json.data.slice(0, 5) : [])
    } catch {
      setStrategyRows([])
      setStrategyError('Failed to load roster strategy trends')
    } finally {
      setStrategyLoading(false)
    }
  }, [sport, trendTimeframe])

  useEffect(() => {
    void loadRosterStrategies()
  }, [loadRosterStrategies])

  return (
    <TabDataState title="Roster" loading={loading} error={error} onReload={() => void reload()}>
      <div className="space-y-4">
        <RosterBoard leagueId={leagueId} />
        <div className="hidden sm:grid gap-3 sm:grid-cols-3">
          <MetricCard label="Total Players" value={totalPlayers} />
          <MetricCard label="FAAB" value={faabRemaining} />
          <MetricCard
            label="Waiver priority"
            value={waiverPriority != null ? waiverPriority : '—'}
            hint="Lower is earlier in rolling waivers."
          />
        </div>
        <div className="hidden md:grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="space-y-3">
            <div className="rounded-2xl border border-cyan-300/25 bg-[#031027]/75 p-3 text-[11px] text-cyan-100">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold">Roster strategy widget</p>
                <div className="flex items-center gap-2">
                  <select
                    value={trendTimeframe}
                    onChange={(e) => setTrendTimeframe(e.target.value as TrendTimeframe)}
                    className="rounded border border-cyan-300/30 bg-black/30 px-2 py-1 text-[11px] text-cyan-100"
                    aria-label="Roster strategy timeframe"
                  >
                    <option value="24h">24h</option>
                    <option value="7d">7d</option>
                    <option value="30d">30d</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void loadRosterStrategies()}
                    className="rounded border border-cyan-300/40 px-2 py-1 text-[11px] text-cyan-100 hover:bg-cyan-500/20"
                  >
                    Refresh
                  </button>
                </div>
              </div>
              <p className="mt-1 text-[11px] text-cyan-100/75">
                Winning build patterns for {sport}. Use this before adjusting bench depth and lineup allocations.
              </p>
              <div className="mt-2">
                {strategyError ? (
                  <p className="text-red-200">{strategyError}</p>
                ) : strategyLoading ? (
                  <p className="text-cyan-100/70">Loading strategy data...</p>
                ) : strategyRows.length === 0 ? (
                  <p className="text-cyan-100/70">No roster strategy data yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {strategyRows.map((row) => (
                      <li key={`${row.strategyType}-${row.leagueFormat}`} className="flex items-center justify-between gap-2">
                        <span className="truncate">{row.strategyLabel ?? row.strategyType}</span>
                        <span className="shrink-0 text-cyan-100/70">
                          win {(row.successRate * 100).toFixed(0)}% · {row.trendingDirection}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Link
                href={`/app/strategy-meta?sport=${encodeURIComponent(sport)}&timeframe=${encodeURIComponent(trendTimeframe)}`}
                className="mt-2 inline-block text-[11px] text-violet-200 hover:underline"
              >
                View strategy details
              </Link>
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-2xl border border-amber-300/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
              <p className="font-semibold text-xs">Flexible roster enforcement</p>
              <p className="mt-1">
                This lineup view lets you organize starters, bench, IR, taxi, and devy locally. Platform
                lineup locks still apply in your host app; AllFantasy will sync deeper integration as
                league APIs evolve.
              </p>
            </div>
            <RosterLegacyReport leagueId={leagueId} />
          </div>
        </div>
      </div>
    </TabDataState>
  )
}

