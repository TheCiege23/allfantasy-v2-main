'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { StartVsStrategyMode } from '@/lib/player-comparison-lab'
import { useStartVsComparison } from '@/hooks/useStartVsComparison'
import { StartVsComparisonCard } from './StartVsComparisonCard'
import { StartVsComparisonModal } from './StartVsComparisonModal'

export interface StartVsComparisonLauncherProps {
  leagueId: string
  teamId?: string | null
  /** When `showNameInputs` is false, both names must be provided. */
  playerA?: string
  playerB?: string
  /** Roster / scores / players: collect names in-page instead of props-only. */
  showNameInputs?: boolean
  weekOrPeriod?: string | null
  lineupSlot?: string | null
  sport?: string | null
  defaultStrategy?: StartVsStrategyMode
  includeAIExplanation?: boolean
  className?: string
}

/**
 * Drop-in: roster / matchup / player pages — triggers POST start-vs and shows card + modal.
 */
export function StartVsComparisonLauncher({
  leagueId,
  teamId,
  playerA = '',
  playerB = '',
  showNameInputs = false,
  weekOrPeriod,
  lineupSlot,
  sport,
  defaultStrategy = 'balanced',
  includeAIExplanation = false,
  className,
}: StartVsComparisonLauncherProps) {
  const { loading, error, data, run, reset } = useStartVsComparison()
  const [strategy, setStrategy] = useState<StartVsStrategyMode>(defaultStrategy)
  const [modalOpen, setModalOpen] = useState(false)
  const [nameA, setNameA] = useState(playerA)
  const [nameB, setNameB] = useState(playerB)

  useEffect(() => {
    setNameA(playerA)
    setNameB(playerB)
  }, [playerA, playerB])

  const effectiveA = (showNameInputs ? nameA : playerA).trim()
  const effectiveB = (showNameInputs ? nameB : playerB).trim()
  const canRun = effectiveA.length > 0 && effectiveB.length > 0

  const handleRun = useCallback(() => {
    if (!canRun) return
    void run(leagueId, {
      playerA: effectiveA,
      playerB: effectiveB,
      teamId: teamId ?? null,
      weekOrPeriod: weekOrPeriod ?? null,
      lineupSlot: lineupSlot ?? null,
      sport: sport ?? null,
      strategyMode: strategy,
      includeAIExplanation,
    })
  }, [
    run,
    leagueId,
    effectiveA,
    effectiveB,
    canRun,
    teamId,
    weekOrPeriod,
    lineupSlot,
    sport,
    strategy,
    includeAIExplanation,
  ])

  return (
    <div className={className} data-testid="start-vs-launcher">
      {showNameInputs ? (
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-white/45">
              Player A
            </span>
            <input
              value={nameA}
              onChange={(e) => setNameA(e.target.value)}
              placeholder="Full name"
              className="w-full rounded-lg border border-white/12 bg-[#040915]/80 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-sky-500/40 focus:outline-none"
              data-testid="start-vs-input-a"
              autoComplete="off"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-white/45">
              Player B
            </span>
            <input
              value={nameB}
              onChange={(e) => setNameB(e.target.value)}
              placeholder="Full name"
              className="w-full rounded-lg border border-white/12 bg-[#040915]/80 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-sky-500/40 focus:outline-none"
              data-testid="start-vs-input-b"
              autoComplete="off"
            />
          </label>
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          className="border border-white/12 bg-white/[0.06] text-white/90 hover:bg-white/10"
          onClick={handleRun}
          disabled={loading || !canRun}
          data-testid="start-vs-run-button"
        >
          {loading ? 'Comparing…' : 'Start A vs B'}
        </Button>
        {data && (
          <Button type="button" variant="ghost" className="text-white/55" onClick={() => reset()} data-testid="start-vs-reset">
            Clear
          </Button>
        )}
      </div>
      <StartVsComparisonCard
        data={data}
        loading={loading}
        error={error}
        strategyMode={strategy}
        onStrategyChange={setStrategy}
        onOpenFull={() => setModalOpen(true)}
      />
      <StartVsComparisonModal open={modalOpen} onOpenChange={setModalOpen} data={data} />
    </div>
  )
}
