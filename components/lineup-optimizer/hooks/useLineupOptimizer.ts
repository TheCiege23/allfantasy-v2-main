'use client'

import { useCallback, useState } from 'react'
import { readPlanRefusal } from '@/lib/monetization/planRefusal'
import type { LineupDecisionMode } from '@/lib/lineup-decision-engine/types'
import type { DecisionEngineJson, LineupRosterPlayer, OptimizeApiResponse } from '../types'

function rosterToApiPlayers(players: LineupRosterPlayer[]) {
  return players.map((p) => ({
    id: p.id,
    name: p.name,
    positions: p.positions,
    projectedPoints: p.projectedPoints,
    team: p.team,
    injuryStatus: p.injuryStatus,
    isVeteran: p.isVeteran,
    isRookie: p.isRookie,
    floorProjection: p.floorProjection,
    ceilingProjection: p.ceilingProjection,
  }))
}

export function useLineupOptimizer() {
  const [sport, setSport] = useState('NFL')
  const [lineupMode, setLineupMode] = useState<LineupDecisionMode>('Best Lineup')
  const [roster, setRoster] = useState<LineupRosterPlayer[]>([])
  const [rosterSlots, setRosterSlots] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<OptimizeApiResponse['result'] | null>(null)
  const [decisionEngine, setDecisionEngine] = useState<DecisionEngineJson | null>(null)
  const [decisionExplanation, setDecisionExplanation] = useState<OptimizeApiResponse['decisionExplanation']>(null)
  const [useAiExplain, setUseAiExplain] = useState(false)
  const [autoSubEnabled, setAutoSubEnabled] = useState(true)

  const optimize = useCallback(
    async (input?: {
      players?: LineupRosterPlayer[]
      slots?: string[]
      mode?: LineupDecisionMode
      teamContext?: Record<string, unknown>
    }) => {
      const players = input?.players ?? roster
      const slots = input?.slots ?? rosterSlots
      const mode = input?.mode ?? lineupMode
      if (players.length === 0 || slots.length === 0) {
        setError('Add players and slot configuration first.')
        return
      }
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/lineup/optimize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sport,
            lineupMode: mode,
            premiumDecisionEngine: true,
            useAIExplanation: useAiExplain,
            useLearnedLineupPreferences: true,
            rosterSlots: slots,
            players: rosterToApiPlayers(players),
            autoSubEnabled,
            teamContext: input?.teamContext ?? {
              record: '6-4',
              rank: 3,
              projectedWinProbability: 0.58,
              teamDirection: 'favorite',
            },
            leagueContext: { format: 'redraft' },
          }),
        })
        const data = (await res.json()) as OptimizeApiResponse & { error?: string }
        if (!res.ok) {
          // A plan refusal reads as its sentence ("This is part of AF Pro."), not the bare "Premium feature".
          throw new Error(readPlanRefusal(res.status, data)?.message ?? (data.error || 'Optimize failed'))
        }
        setResult(data.result ?? null)
        setDecisionEngine((data.decisionEngine as DecisionEngineJson) ?? null)
        setDecisionExplanation(data.decisionExplanation ?? null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Optimize failed')
        setResult(null)
        setDecisionEngine(null)
        setDecisionExplanation(null)
      } finally {
        setLoading(false)
      }
    },
    [roster, rosterSlots, sport, lineupMode, useAiExplain, autoSubEnabled]
  )

  return {
    sport,
    setSport,
    lineupMode,
    setLineupMode,
    roster,
    setRoster,
    rosterSlots,
    setRosterSlots,
    loading,
    error,
    result,
    decisionEngine,
    decisionExplanation,
    useAiExplain,
    setUseAiExplain,
    autoSubEnabled,
    setAutoSubEnabled,
    optimize,
  }
}
