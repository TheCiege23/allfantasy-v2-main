'use client'

import { useEffect, useMemo, useState } from 'react'
import TabDataState from '@/components/app/tabs/TabDataState'
import type { LeagueTabProps } from '@/components/app/tabs/types'
import { useLeagueSectionData } from '@/hooks/useLeagueSectionData'
import { MatchupCard, type MatchupSummary } from '@/components/app/matchups/MatchupCard'
import { MatchupDetailView } from '@/components/app/matchups/MatchupDetailView'

type MatchupsTabResponse = {
  sport?: string
  label: 'week' | 'round'
  selectedWeekOrRound: number
  totalWeeksOrRounds: number
  availableWeeks: number[]
  matchups: Array<{
    id: string
    teamAId?: string
    teamBId?: string
    weekOrRound?: number
    teamAName: string
    teamBName: string
    scoreA: number
    scoreB: number
    projA: number
    projB: number
    winProbA: number
    remainingA: number
    remainingB: number
  }>
}

export default function MatchupsTab({ leagueId }: LeagueTabProps) {
  const [selectedWeekOrRound, setSelectedWeekOrRound] = useState<number | null>(null)
  const sectionPath = selectedWeekOrRound
    ? `matchups?week=${selectedWeekOrRound}`
    : 'matchups'
  const { data, loading, error, reload } = useLeagueSectionData<MatchupsTabResponse>(
    leagueId,
    sectionPath
  )

  useEffect(() => {
    if (!data) return
    if (selectedWeekOrRound != null) return
    setSelectedWeekOrRound(data.selectedWeekOrRound)
  }, [data, selectedWeekOrRound])

  const matchups = useMemo<MatchupSummary[]>(
    () =>
      (data?.matchups ?? []).map((m) => ({
        id: m.id,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        weekOrRound: m.weekOrRound,
        sport: data?.sport,
        teamA: m.teamAName,
        teamB: m.teamBName,
        scoreA: m.scoreA,
        scoreB: m.scoreB,
        projA: m.projA,
        projB: m.projB,
        winProbA: m.winProbA,
        remainingA: m.remainingA,
        remainingB: m.remainingB,
      })),
    [data]
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectionCleared, setSelectionCleared] = useState(false)
  const selected = useMemo(
    () => {
      if (selectedId) return matchups.find((m) => m.id === selectedId) ?? null
      if (selectionCleared) return null
      return matchups[0] ?? null
    },
    [matchups, selectedId, selectionCleared]
  )

  return (
    <TabDataState title="Matchups" loading={loading} error={error} onReload={() => void reload()}>
      <div className="space-y-3">
        <p className="text-xs text-white/60">
          Head-to-head matchups with live scoring, projections, and win probabilities.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-white/55">
            {data ? (
              <>
                Viewing {data.label} {data.selectedWeekOrRound} of{' '}
                {data.totalWeeksOrRounds}
              </>
            ) : (
              'Loading period context…'
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <button
              type="button"
              data-testid="matchups-prev-period"
              disabled={!data || data.selectedWeekOrRound <= 1}
              onClick={() =>
                setSelectedWeekOrRound((prev) =>
                  Math.max(1, (prev ?? data?.selectedWeekOrRound ?? 1) - 1)
                )
              }
              className="rounded border border-white/20 px-2 py-1 text-white/75 hover:bg-white/10 disabled:opacity-40"
            >
              Prev {data?.label ?? 'period'}
            </button>
            <select
              aria-label="Matchup period selector"
              data-testid="matchup-period-selector"
              value={data?.selectedWeekOrRound ?? selectedWeekOrRound ?? 1}
              onChange={(e) => setSelectedWeekOrRound(Math.max(1, Number(e.target.value) || 1))}
              className="rounded border border-white/20 bg-black/50 px-2 py-1 text-white"
            >
              {(data?.availableWeeks?.length ? data.availableWeeks : [data?.selectedWeekOrRound ?? 1]).map((value) => (
                <option key={value} value={value}>
                  {data?.label ?? 'week'} {value}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid="matchups-next-period"
              disabled={
                !data ||
                data.selectedWeekOrRound >= data.totalWeeksOrRounds
              }
              onClick={() =>
                setSelectedWeekOrRound((prev) =>
                  Math.min(
                    data?.totalWeeksOrRounds ?? 1,
                    (prev ?? data?.selectedWeekOrRound ?? 1) + 1
                  )
                )
              }
              className="rounded border border-white/20 px-2 py-1 text-white/75 hover:bg-white/10 disabled:opacity-40"
            >
              Next {data?.label ?? 'period'}
            </button>
          </div>
        </div>
        <div className="grid gap-3 grid-cols-1 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="space-y-2 min-w-0">
            {matchups.length > 0 ? (
              matchups.map((m) => (
                <MatchupCard
                  key={m.id}
                  matchup={m}
                  onClick={() => {
                    setSelectedId(m.id)
                    setSelectionCleared(false)
                  }}
                />
              ))
            ) : (
              <p className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/60">
                No matchups found for this {data?.label ?? 'period'}.
              </p>
            )}
          </div>
          <div className="min-w-0">
            {selected && (
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null)
                  setSelectionCleared(true)
                }}
                data-testid="matchup-clear-selection"
                className="md:hidden mb-2 text-[11px] text-white/50 hover:text-white/80"
              >
                Clear selection
              </button>
            )}
            <MatchupDetailView
              leagueId={leagueId}
              sport={data?.sport}
              selectedWeekOrRound={data?.selectedWeekOrRound}
              matchup={selected}
            />
          </div>
        </div>
      </div>
    </TabDataState>
  )
}

