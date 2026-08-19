'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useLeagueSectionData } from '@/hooks/useLeagueSectionData'
import TabDataState from '@/components/app/tabs/TabDataState'
import LegacyAIPanel from '@/components/app/tabs/LegacyAIPanel'
import type { LeagueTabProps } from '@/components/app/tabs/types'
import { SmartDataView } from '@/components/app/league/SmartDataView'
import { DraftQueue } from '@/components/app/draft/DraftQueue'
import { useDraftQueue } from '@/components/app/draft/useDraftQueue'
import { LeagueDraftBoard, type DraftBoardConfig } from '@/components/app/draft/LeagueDraftBoard'
import { ManagerStyleBadge } from '@/components/ManagerStyleBadge'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

type TrendTimeframe = '24h' | '7d' | '30d'
type DraftTrendTarget = {
  playerId: string
  trendScore: number
  draftFrequency: number
  trendingDirection: string
}
type DraftStrategyRow = {
  strategyType: string
  strategyLabel?: string
  usageRate: number
  successRate: number
  trendingDirection: string
  leagueFormat: string
  sampleSize: number
}
type DraftBehaviorRow = {
  id: string
  managerId: string
  profileLabels: string[]
  activityScore: number
}

export default function DraftTab({ leagueId }: LeagueTabProps) {
  // TODO(api-migration): these two draft calls still route through `/api/app/*` catch-all proxy
  // (→ `/api/leagues/{id}/draft/pool` and `/api/leagues/{id}/draft/config`). Swap to canonical
  // URLs when `useLeagueSectionData` is replaced/forked; proxy kept temporarily for compat.
  const { data, loading, error, reload } =
    useLeagueSectionData<Record<string, unknown>>(leagueId, 'draft')
  const { data: scoringConfig } = useLeagueSectionData<{
    sport: string
    leagueVariant: string | null
    formatType: string
    rules: Array<{ statKey: string; pointsValue: number; enabled: boolean }>
  }>(leagueId, 'scoring/config')
  const { data: draftConfig } = useLeagueSectionData<DraftBoardConfig & { leagueSize?: number }>(
    leagueId,
    'draft/config',
  )
  const [analysis, setAnalysis] = useState<unknown>(null)
  const [running, setRunning] = useState(false)

  const { queue, addToQueue, removeFromQueue, reorder } = useDraftQueue([])
  const [trendTimeframe, setTrendTimeframe] = useState<TrendTimeframe>('7d')
  const [draftTargets, setDraftTargets] = useState<DraftTrendTarget[]>([])
  const [draftTargetsLoading, setDraftTargetsLoading] = useState(false)
  const [draftTargetsError, setDraftTargetsError] = useState<string | null>(null)
  const [draftStrategies, setDraftStrategies] = useState<DraftStrategyRow[]>([])
  const [draftStrategiesLoading, setDraftStrategiesLoading] = useState(false)
  const [draftStrategiesError, setDraftStrategiesError] = useState<string | null>(null)
  const [draftBehaviorRows, setDraftBehaviorRows] = useState<DraftBehaviorRow[]>([])
  const [draftBehaviorLoading, setDraftBehaviorLoading] = useState(false)
  const [draftBehaviorError, setDraftBehaviorError] = useState<string | null>(null)

  const draftTrendSport = normalizeToSupportedSport(scoringConfig?.sport)

  const boardConfig: DraftBoardConfig | null =
    draftConfig && typeof draftConfig.rounds === 'number'
      ? {
          rounds: draftConfig.rounds,
          timer_seconds: draftConfig.timer_seconds ?? null,
          leagueSize: draftConfig.leagueSize ?? 12,
        }
      : null

  async function runDraftAi() {
    const available = Array.isArray((data as any)?.entries)
      ? ((data as any).entries as Array<Record<string, unknown>>)
          .map((entry) => ({
            name: String(entry.name ?? entry.playerName ?? ''),
            position: String(entry.position ?? ''),
            team:
              typeof entry.team === 'string'
                ? entry.team
                : typeof entry.teamAbbreviation === 'string'
                  ? entry.teamAbbreviation
                  : null,
            adp:
              typeof entry.adp === 'number'
                ? entry.adp
                : typeof entry.rank === 'number'
                  ? entry.rank
                  : null,
            value:
              typeof entry.value === 'number'
                ? entry.value
                : typeof entry.rank === 'number'
                  ? 1000 - Number(entry.rank)
                  : null,
          }))
          .filter((entry) => entry.name.length > 0 && entry.position.length > 0)
          .slice(0, 150)
      : []
    if (available.length === 0) {
      setAnalysis({ error: 'Draft AI needs available players to evaluate this board.' })
      return
    }
    const scoringSettings = Object.fromEntries(
      (scoringConfig?.rules ?? [])
        .filter((rule) => rule.enabled !== false)
        .map((rule) => [rule.statKey, rule.pointsValue])
    )

    setRunning(true)
    try {
      const res = await fetch(`/api/mock-draft/ai-pick?leagueId=${encodeURIComponent(leagueId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          sport: scoringConfig?.sport ?? 'NFL',
          leagueVariant: scoringConfig?.leagueVariant ?? null,
          available,
          mode: 'needs',
          leagueContext: {
            scoringSettings,
          },
        }),
      })
      const json = await res.json().catch(() => null)
      setAnalysis(json)
    } finally {
      setRunning(false)
    }
  }

  const loadDraftTargets = useCallback(async () => {
    setDraftTargetsLoading(true)
    setDraftTargetsError(null)
    try {
      const params = new URLSearchParams({
        list: 'draft_targets',
        sport: draftTrendSport,
        timeframe: trendTimeframe,
        limit: '6',
      })
      const res = await fetch(`/api/player-trend?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.error) {
        setDraftTargets([])
        setDraftTargetsError(json?.error ?? 'Failed to load draft trend context')
        return
      }
      setDraftTargets(Array.isArray(json?.data) ? json.data : [])
    } catch {
      setDraftTargets([])
      setDraftTargetsError('Failed to load draft trend context')
    } finally {
      setDraftTargetsLoading(false)
    }
  }, [draftTrendSport, trendTimeframe])

  const loadDraftStrategies = useCallback(async () => {
    setDraftStrategiesLoading(true)
    setDraftStrategiesError(null)
    try {
      const params = new URLSearchParams({
        sport: draftTrendSport,
        timeframe: trendTimeframe,
      })
      const res = await fetch(`/api/strategy-meta?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.error) {
        setDraftStrategies([])
        setDraftStrategiesError(json?.error ?? 'Failed to load draft strategy context')
        return
      }
      setDraftStrategies(Array.isArray(json?.data) ? json.data.slice(0, 4) : [])
    } catch {
      setDraftStrategies([])
      setDraftStrategiesError('Failed to load draft strategy context')
    } finally {
      setDraftStrategiesLoading(false)
    }
  }, [draftTrendSport, trendTimeframe])

  const loadDraftBehavior = useCallback(async () => {
    setDraftBehaviorLoading(true)
    setDraftBehaviorError(null)
    try {
      const params = new URLSearchParams({ limit: '8' })
      if (draftTrendSport) params.set('sport', draftTrendSport)
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/psychological-profiles?${params.toString()}`,
        { cache: 'no-store' }
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.error) {
        setDraftBehaviorRows([])
        setDraftBehaviorError(json?.error ?? 'Failed to load manager tendencies')
        return
      }
      const rows = Array.isArray(json?.profiles) ? json.profiles : []
      setDraftBehaviorRows(rows.slice(0, 6))
    } catch {
      setDraftBehaviorRows([])
      setDraftBehaviorError('Failed to load manager tendencies')
    } finally {
      setDraftBehaviorLoading(false)
    }
  }, [leagueId, draftTrendSport])

  useEffect(() => {
    void loadDraftTargets()
  }, [loadDraftTargets])

  useEffect(() => {
    void loadDraftStrategies()
  }, [loadDraftStrategies])

  useEffect(() => {
    void loadDraftBehavior()
  }, [loadDraftBehavior])

  return (
    <TabDataState title="Draft" loading={loading} error={error} onReload={() => void reload()}>
      <div className="space-y-4">
        <Link
          href={`/league/${leagueId}/draft`}
          className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/25"
        >
          Open draft room
        </Link>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2.3fr)_minmax(0,1.2fr)]">
          <LeagueDraftBoard
            leagueId={leagueId}
            entries={Array.isArray((data as any)?.entries) ? ((data as any).entries as any[]) : []}
            onAddToQueue={(item) => addToQueue(item)}
            config={boardConfig}
          />
          <div className="space-y-3">
            <DraftQueue queue={queue} onRemove={removeFromQueue} onReorder={reorder} />
            <div className="space-y-2 rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-white/75">Draft trend indicators</p>
                <div className="flex items-center gap-2">
                  <select
                    value={trendTimeframe}
                    onChange={(e) => setTrendTimeframe(e.target.value as TrendTimeframe)}
                    className="rounded border border-white/20 bg-black/40 px-2 py-1 text-[11px] text-white"
                    aria-label="Draft trend timeframe"
                  >
                    <option value="24h">24h</option>
                    <option value="7d">7d</option>
                    <option value="30d">30d</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void loadDraftTargets()}
                    className="rounded border border-cyan-400/40 px-2 py-1 text-[11px] text-cyan-200 hover:bg-cyan-500/20"
                  >
                    Refresh
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-white/55">
                Top platform draft-frequency movers in {draftTrendSport}. Use this to sanity-check reaches and fades.
              </p>
              {draftTargetsError ? (
                <p className="text-[11px] text-red-300">{draftTargetsError}</p>
              ) : draftTargetsLoading ? (
                <p className="text-[11px] text-white/60">Loading trend indicators...</p>
              ) : draftTargets.length === 0 ? (
                <p className="text-[11px] text-white/60">No draft trend targets yet.</p>
              ) : (
                <ul className="space-y-1.5 text-[11px] text-white/80">
                  {draftTargets.map((row) => (
                    <li key={`${row.playerId}-${row.trendScore}`} className="flex items-center justify-between gap-2">
                      <span className="truncate">{row.playerId}</span>
                      <span className="shrink-0 text-white/60">
                        draft {(row.draftFrequency * 100).toFixed(0)}% · {row.trendingDirection}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 space-y-1.5">
                <p className="text-[10px] text-white/55">
                  Draft strategy meta (platform usage + success)
                </p>
                {draftStrategiesError ? (
                  <p className="text-[11px] text-red-300">{draftStrategiesError}</p>
                ) : draftStrategiesLoading ? (
                  <p className="text-[11px] text-white/60">Loading strategy context...</p>
                ) : draftStrategies.length === 0 ? (
                  <p className="text-[11px] text-white/60">No strategy context yet.</p>
                ) : (
                  <ul className="space-y-1.5 text-[11px] text-white/80">
                    {draftStrategies.map((row) => (
                      <li key={`${row.strategyType}-${row.leagueFormat}`} className="flex items-center justify-between gap-2">
                        <span className="truncate">{row.strategyLabel ?? row.strategyType}</span>
                        <span className="shrink-0 text-white/60">
                          use {(row.usageRate * 100).toFixed(0)}% · win {(row.successRate * 100).toFixed(0)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Link
                href={`/app/trend-feed?sport=${encodeURIComponent(draftTrendSport)}&timeframe=${encodeURIComponent(trendTimeframe)}`}
                className="inline-block text-[11px] text-violet-300 hover:underline"
              >
                Open full trend feed
              </Link>
              <span className="mx-1 text-[11px] text-white/45">·</span>
              <Link
                href={`/app/strategy-meta?sport=${encodeURIComponent(draftTrendSport)}&timeframe=${encodeURIComponent(trendTimeframe)}`}
                className="inline-block text-[11px] text-violet-300 hover:underline"
              >
                View strategy details
              </Link>
            </div>
            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-white/75">Draft room manager tendencies</p>
                <button
                  type="button"
                  onClick={() => void loadDraftBehavior()}
                  className="rounded border border-cyan-400/40 px-2 py-1 text-[11px] text-cyan-200 hover:bg-cyan-500/20"
                >
                  Refresh
                </button>
              </div>
              <p className="text-[10px] text-white/55">
                Current behavior profiles for managers in this league, useful for anticipating draft strategy pressure.
              </p>
              {draftBehaviorError ? (
                <p className="text-[11px] text-red-300">{draftBehaviorError}</p>
              ) : draftBehaviorLoading ? (
                <p className="text-[11px] text-white/60">Loading manager tendencies...</p>
              ) : draftBehaviorRows.length === 0 ? (
                <p className="text-[11px] text-white/60">No manager tendencies yet. Build profiles in Settings.</p>
              ) : (
                <ul className="space-y-2 text-[11px] text-white/80">
                  {draftBehaviorRows.map((row) => (
                    <li
                      key={row.id}
                      className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-white/85">{row.managerId}</span>
                        <ManagerStyleBadge leagueId={leagueId} managerId={row.managerId} />
                        <span className="text-[10px] text-white/40 ml-auto">
                          Activity {Math.round(row.activityScore)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {row.profileLabels.slice(0, 3).map((label) => (
                          <span
                            key={`${row.id}-${label}`}
                            className="rounded border border-purple-500/25 bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-200"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href={`/app/league/${encodeURIComponent(leagueId)}/psychological-profiles/compare`}
                className="inline-block text-[11px] text-violet-300 hover:underline"
              >
                Open manager style comparison
              </Link>
            </div>
            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-white/75">Draft AI recommendation</p>
                  <button
                    type="button"
                    onClick={runDraftAi}
                    disabled={running}
                    className="rounded-lg border border-cyan-400/40 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
                  >
                    {running ? 'Running...' : 'Run Draft AI'}
                  </button>
                </div>
                <p className="text-[10px] text-white/60">
                  Use your queue to star players you want to target. AI can later consume this queue when recommending picks.
                </p>
                <p className="text-[9px] text-white/40">
                  Manager style badges (Trade Finder, Rankings): build in Settings → Behavior Profiles.
                </p>
              </div>
              <SmartDataView data={analysis || data} />
            </div>
            <LegacyAIPanel leagueId={leagueId} endpoint="draft-war-room" title="AF Legacy Draft (League)" />
          </div>
        </div>
      </div>
    </TabDataState>
  )
}

