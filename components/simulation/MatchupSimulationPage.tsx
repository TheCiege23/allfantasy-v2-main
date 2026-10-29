'use client'

import { paidToolFetchWithConfirm } from '@/lib/tokens/paidToolClient'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Check, Loader2, Play, RefreshCw, Share2, Sparkles } from 'lucide-react'
import { MatchupShareModal } from '@/components/matchup-sharing'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DEFAULT_SPORT } from '@/lib/sport-scope'
import {
  buildLineupForSimulationPreset,
  buildMatchupSummaryForAI,
  formatScoreRangeLabel,
  getDefaultScheduleFactorsForPreset,
  getMatchupAIChatUrl,
  getScheduleFactorDefinitionsForSport,
  getSimulationTeamPresets,
  getSportOptionsForSimulation,
  MATCHUP_SIMULATOR_MESSAGES,
  resolveComparisonSummary,
} from '@/lib/matchup-simulator'
import {
  buildMatchupSlotComparisons,
  summarizeMatchupTeamInput,
} from '@/lib/simulation-engine/DeterministicMatchupEngine'
import type {
  MatchupLineupSlotInput,
  MatchupProviderInsights,
  MatchupScheduleFactorsInput,
  MatchupSimulationTeamSummary,
  MatchupSlotComparisonRow,
} from '@/lib/simulation-engine/types'
import type {
  MatchupPredictionEngineOutput,
  MatchupPredictionScoringRulesInput,
} from '@/lib/matchup-prediction-engine'
import { SimulationChart } from './SimulationChart'
import { UpsideDownsideCards } from './UpsideDownsideCards'
import { WinProbabilityMeter } from './WinProbabilityMeter'
import { InContextMonetizationCard } from '@/components/monetization/InContextMonetizationCard'

type MatchupResult = {
  winProbabilityA: number
  winProbabilityB: number
  marginMean: number
  marginStdDev: number
  projectedScoreA: number
  projectedScoreB: number
  scoreRangeA: [number, number]
  scoreRangeB: [number, number]
  upsetChance: number
  volatilityTag: 'low' | 'medium' | 'high'
  iterations: number
  upsideScenario?: { teamA: number; teamB: number; percentile: number } | null
  downsideScenario?: { teamA: number; teamB: number; percentile: number } | null
  scoreDistributionA?: number[] | null
  scoreDistributionB?: number[] | null
  teamSummaryA?: MatchupSimulationTeamSummary | null
  teamSummaryB?: MatchupSimulationTeamSummary | null
  slotComparisons?: MatchupSlotComparisonRow[] | null
  providerInsights?: MatchupProviderInsights | null
  storyNarrative?: { text: string; source: 'ai'; model: string } | null
  prediction?: MatchupPredictionEngineOutput | null
  deterministicSeed?: number | null
}

export interface MatchupSimulationPageProps {
  teamAName?: string
  teamBName?: string
  leagueId?: string
  initialTeamA?: { mean: number; stdDev?: number }
  initialTeamB?: { mean: number; stdDev?: number }
}

const AI_PROVIDER_LABELS: Array<{
  id: keyof MatchupProviderInsights
  title: string
  subtitle: string
  accent: string
}> = [
  {
    id: 'deepseek',
    title: 'DeepSeek Distribution Read',
    subtitle: 'Interpret the deterministic distribution and swing lanes.',
    accent: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100',
  },
  {
    id: 'grok',
    title: 'Grok Storyline Framing',
    subtitle: 'Package the sim into one sharp storyline.',
    accent: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
  },
  {
    id: 'openai',
    title: 'OpenAI Matchup Explanation',
    subtitle: 'Translate the numbers into a clear manager read.',
    accent: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  },
]

function roundToTenth(value: number) {
  return Math.round(value * 10) / 10
}

function cloneLineup(lineup: MatchupLineupSlotInput[]) {
  return lineup.map((slot) => ({ ...slot }))
}

function buildPayloadSignature(payload: unknown) {
  return JSON.stringify(payload)
}

function sanitizeNumericInput(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function updateLineupField(
  lineup: MatchupLineupSlotInput[],
  slotId: string,
  field: 'playerName' | 'projection' | 'floor' | 'ceiling',
  nextValue: string
) {
  return lineup.map((slot) => {
    if (slot.slotId !== slotId) return slot
    if (field === 'playerName') return { ...slot, playerName: nextValue }

    const numericValue = Math.max(0, sanitizeNumericInput(nextValue))
    const projection = slot.projection ?? 0
    const floor = slot.floor ?? Math.max(0, (projection ?? 0) - 3)
    const ceiling = slot.ceiling ?? (projection ?? 0) + 3

    if (field === 'projection') {
      return {
        ...slot,
        projection: roundToTenth(numericValue),
        floor: roundToTenth(Math.min(floor, numericValue)),
        ceiling: roundToTenth(Math.max(ceiling, numericValue)),
      }
    }

    if (field === 'floor') {
      return { ...slot, floor: roundToTenth(Math.min(numericValue, projection ?? 0)) }
    }

    return { ...slot, ceiling: roundToTenth(Math.max(numericValue, projection ?? 0)) }
  })
}

function TeamSummaryCards({
  label,
  teamSummary,
  teamColor,
  derivedTotalTestId,
}: {
  label: string
  teamSummary: MatchupSimulationTeamSummary
  teamColor: string
  derivedTotalTestId: string
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <div className="rounded-xl border border-white/10 bg-black/25 p-3">
        <p className="text-[11px] uppercase tracking-wider text-white/50">Derived total</p>
        <p className={`mt-1 text-xl font-semibold ${teamColor}`} data-testid={derivedTotalTestId}>
          {teamSummary.adjustedMean.toFixed(1)}
        </p>
        <p className="text-[11px] text-white/45">{label} adjusted lineup projection</p>
      </div>
      <div className="rounded-xl border border-white/10 bg-black/25 p-3">
        <p className="text-[11px] uppercase tracking-wider text-white/50">Likely band</p>
        <p className="mt-1 text-lg font-semibold text-white">
          {formatScoreRangeLabel([teamSummary.adjustedFloor, teamSummary.adjustedCeiling])}
        </p>
        <p className="text-[11px] text-white/45">Slot floors and ceilings combined</p>
      </div>
      <div className="rounded-xl border border-white/10 bg-black/25 p-3">
        <p className="text-[11px] uppercase tracking-wider text-white/50">Schedule impact</p>
        <p className="mt-1 text-lg font-semibold text-white">
          {teamSummary.scheduleAdjustment >= 0 ? '+' : ''}
          {teamSummary.scheduleAdjustment.toFixed(1)}
        </p>
        <p className="text-[11px] text-white/45">
          Multiplier {teamSummary.scheduleMultiplier.toFixed(3)}
        </p>
      </div>
    </div>
  )
}

function LineupEditor({
  teamKey,
  title,
  accentClass,
  teamName,
  onTeamNameChange,
  presetId,
  onPresetChange,
  presetOptions,
  lineup,
  onLineupChange,
  teamSummary,
  scheduleFactors,
  onScheduleFactorChange,
  scheduleFactorDefinitions,
}: {
  teamKey: 'A' | 'B'
  title: string
  accentClass: string
  teamName: string
  onTeamNameChange: (value: string) => void
  presetId: string
  onPresetChange: (value: string) => void
  presetOptions: Array<{ id: string; name: string }>
  lineup: MatchupLineupSlotInput[]
  onLineupChange: (updater: (current: MatchupLineupSlotInput[]) => MatchupLineupSlotInput[]) => void
  teamSummary: MatchupSimulationTeamSummary
  scheduleFactors: Required<MatchupScheduleFactorsInput>
  onScheduleFactorChange: (factorId: keyof MatchupScheduleFactorsInput, value: number) => void
  scheduleFactorDefinitions: ReturnType<typeof getScheduleFactorDefinitionsForSport>
}) {
  const teamKeyLower = teamKey.toLowerCase()

  return (
    <div className={`rounded-2xl border ${accentClass} p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-white/45">{title}</p>
          <input
            type="text"
            value={teamName}
            onChange={(event) => onTeamNameChange(event.target.value)}
            data-testid={`matchup-team-${teamKeyLower}-name-input`}
            className="mt-2 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-lg font-semibold text-white"
          />
        </div>
        <div className="min-w-[180px]">
          <label className="text-xs uppercase tracking-wider text-white/45">Preset lineup</label>
          <Select value={presetId} onValueChange={onPresetChange}>
            <SelectTrigger
              className="mt-2 w-full border-white/15 bg-black/30 text-white"
              data-testid={`matchup-team-${teamKeyLower}-selector`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {presetOptions.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-4">
        <TeamSummaryCards
          label={teamName}
          teamSummary={teamSummary}
          teamColor={teamKey === 'A' ? 'text-cyan-300' : 'text-amber-300'}
          derivedTotalTestId={`matchup-team-${teamKeyLower}-derived-total`}
        />
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-white/55">Schedule factors</p>
          <p className="text-[11px] text-white/45">
            Control venue, rest, opponent quality, and game environment.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {scheduleFactorDefinitions.map((definition) => (
            <label key={definition.id} className="rounded-xl border border-white/10 bg-black/25 p-3">
              <span className="block text-xs font-medium text-white/80">{definition.label}</span>
              <span className="mt-1 block text-[11px] text-white/45">{definition.description}</span>
              <select
                value={String(scheduleFactors[definition.id] ?? 0)}
                onChange={(event) => onScheduleFactorChange(definition.id, Number(event.target.value))}
                data-testid={`matchup-team-${teamKeyLower}-schedule-${definition.id}`}
                className="mt-2 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              >
                {definition.options.map((option) => (
                  <option key={`${definition.id}-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <div className="grid grid-cols-[58px_1.1fr_86px_86px_86px] gap-2 px-1 text-[11px] uppercase tracking-wider text-white/40">
          <span>Slot</span>
          <span>Player</span>
          <span>Proj</span>
          <span>Floor</span>
          <span>Ceiling</span>
        </div>
        <div className="space-y-2">
          {lineup.map((slot) => (
            <div
              key={`${teamKey}-${slot.slotId}`}
              className="grid grid-cols-[58px_1.1fr_86px_86px_86px] gap-2 rounded-xl border border-white/10 bg-black/25 p-2"
            >
              <div className="flex items-center rounded-lg bg-white/5 px-2 text-xs font-semibold text-white/80">
                {slot.slotLabel ?? slot.slotId}
              </div>
              <input
                type="text"
                value={slot.playerName ?? ''}
                onChange={(event) =>
                  onLineupChange((current) =>
                    updateLineupField(current, slot.slotId, 'playerName', event.target.value)
                  )
                }
                data-testid={`matchup-team-${teamKeyLower}-lineup-${slot.slotId}-player-input`}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              />
              <input
                type="number"
                value={slot.projection}
                onChange={(event) =>
                  onLineupChange((current) =>
                    updateLineupField(current, slot.slotId, 'projection', event.target.value)
                  )
                }
                data-testid={`matchup-team-${teamKeyLower}-lineup-${slot.slotId}-projection-input`}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              />
              <input
                type="number"
                value={slot.floor ?? 0}
                onChange={(event) =>
                  onLineupChange((current) =>
                    updateLineupField(current, slot.slotId, 'floor', event.target.value)
                  )
                }
                data-testid={`matchup-team-${teamKeyLower}-lineup-${slot.slotId}-floor-input`}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              />
              <input
                type="number"
                value={slot.ceiling ?? 0}
                onChange={(event) =>
                  onLineupChange((current) =>
                    updateLineupField(current, slot.slotId, 'ceiling', event.target.value)
                  )
                }
                data-testid={`matchup-team-${teamKeyLower}-lineup-${slot.slotId}-ceiling-input`}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function MatchupSimulationPage({
  teamAName: initialTeamAName = 'Team A',
  teamBName: initialTeamBName = 'Team B',
  leagueId,
}: MatchupSimulationPageProps) {
  const [sport, setSport] = useState(DEFAULT_SPORT)
  const [simulatorOpen, setSimulatorOpen] = useState(false)
  const sportOptions = useMemo(() => getSportOptionsForSimulation(), [])
  const sportPresets = useMemo(() => getSimulationTeamPresets(sport), [sport])
  const scheduleFactorDefinitions = useMemo(
    () => getScheduleFactorDefinitionsForSport(sport),
    [sport]
  )
  const defaultPresetA = sportPresets[0]
  const defaultPresetB = sportPresets[1] ?? sportPresets[0]

  const [selectedPresetA, setSelectedPresetA] = useState<string>(defaultPresetA?.id ?? 'custom-a')
  const [selectedPresetB, setSelectedPresetB] = useState<string>(defaultPresetB?.id ?? 'custom-b')
  const [teamAName, setTeamAName] = useState(initialTeamAName)
  const [teamBName, setTeamBName] = useState(initialTeamBName)
  const [weekOrPeriod, setWeekOrPeriod] = useState(1)
  const [scoringRules, setScoringRules] = useState<Required<MatchupPredictionScoringRulesInput>>({
    pointMultiplier: 1,
    teamABonus: 0,
    teamBBonus: 0,
    varianceMultiplier: 1,
    preset: 'standard',
  })
  const [aiExplanationEnabled, setAiExplanationEnabled] = useState(false)
  const [storyNarrativeEnabled, setStoryNarrativeEnabled] = useState(false)
  const [lineupA, setLineupA] = useState<MatchupLineupSlotInput[]>(
    defaultPresetA ? cloneLineup(buildLineupForSimulationPreset(DEFAULT_SPORT, defaultPresetA)) : []
  )
  const [lineupB, setLineupB] = useState<MatchupLineupSlotInput[]>(
    defaultPresetB ? cloneLineup(buildLineupForSimulationPreset(DEFAULT_SPORT, defaultPresetB)) : []
  )
  const [scheduleFactorsA, setScheduleFactorsA] =
    useState<Required<MatchupScheduleFactorsInput>>(
      getDefaultScheduleFactorsForPreset(defaultPresetA)
    )
  const [scheduleFactorsB, setScheduleFactorsB] =
    useState<Required<MatchupScheduleFactorsInput>>(
      getDefaultScheduleFactorsForPreset(defaultPresetB)
    )
  const [result, setResult] = useState<MatchupResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [chartMode, setChartMode] = useState<'distribution' | 'scoreRanges'>('distribution')
  const [positionTab, setPositionTab] = useState<'all' | 'edges'>('all')
  const [lastRequestedSignature, setLastRequestedSignature] = useState<string | null>(null)
  const [lastSimulatedSignature, setLastSimulatedSignature] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (!defaultPresetA || !defaultPresetB) return
    setSelectedPresetA(defaultPresetA.id)
    setSelectedPresetB(defaultPresetB.id)
    setTeamAName(defaultPresetA.name)
    setTeamBName(defaultPresetB.name)
    setLineupA(cloneLineup(buildLineupForSimulationPreset(sport, defaultPresetA)))
    setLineupB(cloneLineup(buildLineupForSimulationPreset(sport, defaultPresetB)))
    setScheduleFactorsA(getDefaultScheduleFactorsForPreset(defaultPresetA))
    setScheduleFactorsB(getDefaultScheduleFactorsForPreset(defaultPresetB))
    setWeekOrPeriod(1)
    setScoringRules({
      pointMultiplier: 1,
      teamABonus: 0,
      teamBBonus: 0,
      varianceMultiplier: 1,
      preset: 'standard',
    })
    setAiExplanationEnabled(false)
    setStoryNarrativeEnabled(false)
    setChartMode('distribution')
    setPositionTab('all')
    setResult(null)
    setError(null)
    setLastRequestedSignature(null)
    setLastSimulatedSignature(null)
  }, [defaultPresetA, defaultPresetB, sport])

  const previewTeamSummaryA = useMemo(
    () =>
      summarizeMatchupTeamInput(
        { teamName: teamAName, lineup: lineupA, scheduleFactors: scheduleFactorsA },
        sport
      ),
    [lineupA, scheduleFactorsA, sport, teamAName]
  )
  const previewTeamSummaryB = useMemo(
    () =>
      summarizeMatchupTeamInput(
        { teamName: teamBName, lineup: lineupB, scheduleFactors: scheduleFactorsB },
        sport
      ),
    [lineupB, scheduleFactorsB, sport, teamBName]
  )

  const simulationPayload = useMemo(
    () => ({
      sport,
      weekOrPeriod,
      iterations: 1500,
      includeInsights: aiExplanationEnabled,
      includeStoryNarrative: storyNarrativeEnabled,
      scoringRules,
      teamAName,
      teamBName,
      teamA: {
        mean: previewTeamSummaryA.adjustedMean,
        stdDev: previewTeamSummaryA.derivedStdDev,
        lineup: lineupA,
        scheduleFactors: scheduleFactorsA,
      },
      teamB: {
        mean: previewTeamSummaryB.adjustedMean,
        stdDev: previewTeamSummaryB.derivedStdDev,
        lineup: lineupB,
        scheduleFactors: scheduleFactorsB,
      },
    }),
    [
      lineupA,
      lineupB,
      previewTeamSummaryA.adjustedMean,
      previewTeamSummaryA.derivedStdDev,
      previewTeamSummaryB.adjustedMean,
      previewTeamSummaryB.derivedStdDev,
      scheduleFactorsA,
      scheduleFactorsB,
      aiExplanationEnabled,
      storyNarrativeEnabled,
      scoringRules,
      sport,
      teamAName,
      teamBName,
      weekOrPeriod,
    ]
  )

  const inputSignature = useMemo(
    () =>
      buildPayloadSignature({
        sport,
        weekOrPeriod,
        teamAName,
        teamBName,
        lineupA: lineupA.map((slot) => [
          slot.slotId,
          slot.playerName,
          slot.projection,
          slot.floor,
          slot.ceiling,
        ]),
        lineupB: lineupB.map((slot) => [
          slot.slotId,
          slot.playerName,
          slot.projection,
          slot.floor,
          slot.ceiling,
        ]),
        scheduleFactorsA,
        scheduleFactorsB,
        scoringRules,
        aiExplanationEnabled,
        storyNarrativeEnabled,
      }),
    [
      aiExplanationEnabled,
      lineupA,
      lineupB,
      scheduleFactorsA,
      scheduleFactorsB,
      scoringRules,
      sport,
      storyNarrativeEnabled,
      teamAName,
      teamBName,
      weekOrPeriod,
    ]
  )

  const applyPreset = useCallback(
    (team: 'A' | 'B', presetId: string) => {
      const selected = sportPresets.find((preset) => preset.id === presetId)
      if (!selected) return
      if (team === 'A') {
        setSelectedPresetA(presetId)
        setTeamAName(selected.name)
        setLineupA(cloneLineup(buildLineupForSimulationPreset(sport, selected)))
        setScheduleFactorsA(getDefaultScheduleFactorsForPreset(selected))
      } else {
        setSelectedPresetB(presetId)
        setTeamBName(selected.name)
        setLineupB(cloneLineup(buildLineupForSimulationPreset(sport, selected)))
        setScheduleFactorsB(getDefaultScheduleFactorsForPreset(selected))
      }
      setError(null)
    },
    [sport, sportPresets]
  )

  const clearSimulation = useCallback(() => {
    setResult(null)
    setError(null)
    setLastRequestedSignature(null)
    setLastSimulatedSignature(null)
  }, [])

  const resetSimulator = useCallback(() => {
    if (!defaultPresetA || !defaultPresetB) return
    setSelectedPresetA(defaultPresetA.id)
    setSelectedPresetB(defaultPresetB.id)
    setTeamAName(defaultPresetA.name)
    setTeamBName(defaultPresetB.name)
    setLineupA(cloneLineup(buildLineupForSimulationPreset(sport, defaultPresetA)))
    setLineupB(cloneLineup(buildLineupForSimulationPreset(sport, defaultPresetB)))
    setScheduleFactorsA(getDefaultScheduleFactorsForPreset(defaultPresetA))
    setScheduleFactorsB(getDefaultScheduleFactorsForPreset(defaultPresetB))
    setWeekOrPeriod(1)
    setScoringRules({
      pointMultiplier: 1,
      teamABonus: 0,
      teamBBonus: 0,
      varianceMultiplier: 1,
      preset: 'standard',
    })
    setAiExplanationEnabled(false)
    setStoryNarrativeEnabled(false)
    setChartMode('distribution')
    setPositionTab('all')
    setResult(null)
    setError(null)
    setLastRequestedSignature(null)
    setLastSimulatedSignature(null)
  }, [defaultPresetA, defaultPresetB, sport])

  const runSimulation = useCallback(async () => {
    const signature = inputSignature
    const requestId = ++requestIdRef.current
    setError(null)
    setLoading(true)
    setLastRequestedSignature(signature)

    try {
      const response = await paidToolFetchWithConfirm('/api/simulation/matchup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(simulationPayload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error ?? 'Simulation failed')
      if (requestId !== requestIdRef.current) return

      setResult({
        winProbabilityA: data.winProbabilityA,
        winProbabilityB: data.winProbabilityB,
        marginMean: data.marginMean ?? 0,
        marginStdDev: data.marginStdDev ?? 0,
        projectedScoreA: data.projectedScoreA,
        projectedScoreB: data.projectedScoreB,
        scoreRangeA: data.scoreRangeA,
        scoreRangeB: data.scoreRangeB,
        upsetChance: data.upsetChance,
        volatilityTag: data.volatilityTag,
        iterations: data.iterations,
        upsideScenario: data.upsideScenario ?? null,
        downsideScenario: data.downsideScenario ?? null,
        scoreDistributionA: data.scoreDistributionA ?? null,
        scoreDistributionB: data.scoreDistributionB ?? null,
        teamSummaryA: data.teamSummaryA ?? null,
        teamSummaryB: data.teamSummaryB ?? null,
        slotComparisons: data.slotComparisons ?? null,
        providerInsights: data.providerInsights ?? null,
        storyNarrative: data.storyNarrative ?? null,
        prediction: data.prediction ?? null,
        deterministicSeed: data.deterministicSeed ?? null,
      })
      setLastSimulatedSignature(signature)
    } catch (simulationError) {
      if (requestId !== requestIdRef.current) return
      setError(simulationError instanceof Error ? simulationError.message : 'Failed to run simulation')
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [inputSignature, simulationPayload])

  useEffect(() => {
    if (!result || loading) return
    if (inputSignature === lastRequestedSignature) return
    const timeout = window.setTimeout(() => {
      void runSimulation()
    }, 350)
    return () => window.clearTimeout(timeout)
  }, [inputSignature, lastRequestedSignature, loading, result, runSimulation])

  const currentTeamSummaryA = result?.teamSummaryA ?? previewTeamSummaryA
  const currentTeamSummaryB = result?.teamSummaryB ?? previewTeamSummaryB
  const comparisonSummary = useMemo(
    () => (result ? resolveComparisonSummary(teamAName, teamBName, result) : null),
    [result, teamAName, teamBName]
  )
  const positionRows = useMemo(
    () =>
      result?.slotComparisons && result.slotComparisons.length > 0
        ? result.slotComparisons
        : buildMatchupSlotComparisons(currentTeamSummaryA, currentTeamSummaryB),
    [currentTeamSummaryA, currentTeamSummaryB, result?.slotComparisons]
  )
  const visiblePositionRows =
    positionTab === 'edges' ? positionRows.filter((row) => row.advantage !== 'even') : positionRows

  const chimmyUrl = result
    ? getMatchupAIChatUrl(
        buildMatchupSummaryForAI({
          teamAName,
          teamBName,
          projectedScoreA: result.projectedScoreA,
          projectedScoreB: result.projectedScoreB,
          scoreRangeA: result.scoreRangeA,
          scoreRangeB: result.scoreRangeB,
          winProbA: result.winProbabilityA * 100,
          winProbB: result.winProbabilityB * 100,
          upsetChance: result.upsetChance,
          volatilityTag: result.volatilityTag,
          sport,
          strengths: comparisonSummary?.strengthBullets,
          weaknesses: comparisonSummary?.weaknessBullets,
          positionEdgeSummary: positionRows
            .filter((row) => row.advantage !== 'even')
            .slice(0, 3)
            .map((row) => `${row.slotLabel}: ${row.edgeLabel}`)
            .join(', '),
        }),
        { leagueId, insightType: 'matchup', sport, week: weekOrPeriod }
      )
    : getMatchupAIChatUrl(undefined, {
        leagueId,
        insightType: 'matchup',
        sport,
        week: weekOrPeriod,
      })

  const shareMatchupResult = useCallback(async () => {
    if (!result) return
    try {
      const response = await fetch('/api/share/generate-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shareType: 'winning_matchup',
          sport,
          teamName: teamAName,
          opponentName: teamBName,
          score: Math.round(result.projectedScoreA),
          week: weekOrPeriod,
        }),
      })
      const data = await response.json().catch(() => ({}))
      const caption =
        data.caption ||
        data.headline ||
        `${teamAName} vs ${teamBName}: ${(result.winProbabilityA * 100).toFixed(0)}% win probability for ${teamAName}. Simulated on AllFantasy.`
      await navigator.clipboard.writeText(caption)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
    } catch {
      const fallback = `${teamAName} vs ${teamBName}: ${(result.winProbabilityA * 100).toFixed(0)}% win probability. Simulated on AllFantasy.`
      await navigator.clipboard.writeText(fallback)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
    }
  }, [result, sport, teamAName, teamBName, weekOrPeriod])

  const isOutOfSync =
    result != null && lastSimulatedSignature != null && inputSignature !== lastSimulatedSignature

  if (!simulatorOpen) {
    return (
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <Card className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.2),_transparent_45%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))]">
          <CardHeader>
            <CardTitle className="text-lg text-white">Matchup Simulation Insight Engine</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-white/70">
              Deterministic 1,500-sim matchup engine with lineup slots, variance ranges,
              schedule factors, and AI overlays from DeepSeek, Grok, and OpenAI.
            </p>
            <Button onClick={() => setSimulatorOpen(true)} data-testid="matchup-open-simulator" className="gap-2">
              <Play className="h-4 w-4" />
              Open simulator
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-white">Matchup simulation</h1>
          <p className="mt-1 max-w-3xl text-sm text-white/60">
            Deterministic 1,000+ sims driven by lineup slots, schedule context, and variance bands.
            Any movement you see comes from actual lineup or factor changes.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setSimulatorOpen(false)}
          data-testid="matchup-back-button"
          className="border-white/20"
        >
          Back
        </Button>
      </div>

      <InContextMonetizationCard
        title="Matchup AI explanation access"
        featureId="matchup_explanations"
        tokenRuleCodes={['ai_matchup_explanation_single']}
        testIdPrefix="matchup-monetization"
      />

      <Card className="border-white/10 bg-white/5">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-[180px]">
              <label className="text-xs uppercase tracking-wider text-white/45">Sport</label>
              <Select value={sport} onValueChange={(value) => setSport(value as typeof sport)}>
                <SelectTrigger
                  className="mt-2 w-full border-white/10 bg-black/30 text-white"
                  data-testid="matchup-sport-selector"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sportOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[140px]">
              <label className="text-xs uppercase tracking-wider text-white/45">Week / period</label>
              <input
                type="number"
                min={1}
                value={weekOrPeriod}
                onChange={(event) => setWeekOrPeriod(Math.max(1, Number(event.target.value) || 1))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-white"
                data-testid="matchup-week-period-input"
              />
            </div>
            <div className="flex-1 rounded-xl border border-white/10 bg-black/25 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wider text-white/45">Current matchup detection</p>
              <p className="mt-1 text-sm font-medium text-white/85" data-testid="matchup-current-detection">
                {teamAName} vs {teamBName}
              </p>
              <p className="text-[11px] text-white/45">
                {lineupA.length} lineup slots vs {lineupB.length} lineup slots, plus schedule context on both sides.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
            <label className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <span className="text-[11px] uppercase tracking-wider text-white/45">Scoring preset</span>
              <select
                value={scoringRules.preset}
                onChange={(event) =>
                  setScoringRules((current) => {
                    const preset = event.target.value as Required<MatchupPredictionScoringRulesInput>['preset']
                    if (preset === 'aggressive') {
                      return {
                        ...current,
                        preset,
                        pointMultiplier: 1.08,
                        varianceMultiplier: 1.12,
                      }
                    }
                    if (preset === 'conservative') {
                      return {
                        ...current,
                        preset,
                        pointMultiplier: 0.94,
                        varianceMultiplier: 0.9,
                      }
                    }
                    return {
                      ...current,
                      preset,
                      pointMultiplier: 1,
                      varianceMultiplier: 1,
                    }
                  })
                }
                data-testid="matchup-scoring-preset-select"
                className="mt-2 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              >
                <option value="standard">Standard</option>
                <option value="aggressive">Aggressive scoring</option>
                <option value="conservative">Conservative scoring</option>
              </select>
            </label>
            <label className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <span className="text-[11px] uppercase tracking-wider text-white/45">Point multiplier</span>
              <input
                type="number"
                step="0.01"
                min="0.7"
                max="1.4"
                value={scoringRules.pointMultiplier}
                onChange={(event) =>
                  setScoringRules((current) => ({
                    ...current,
                    pointMultiplier: Number(event.target.value) || 1,
                  }))
                }
                data-testid="matchup-scoring-point-multiplier-input"
                className="mt-2 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <span className="text-[11px] uppercase tracking-wider text-white/45">Team A bonus</span>
              <input
                type="number"
                step="0.1"
                value={scoringRules.teamABonus}
                onChange={(event) =>
                  setScoringRules((current) => ({
                    ...current,
                    teamABonus: Number(event.target.value) || 0,
                  }))
                }
                data-testid="matchup-scoring-team-a-bonus-input"
                className="mt-2 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <span className="text-[11px] uppercase tracking-wider text-white/45">Team B bonus</span>
              <input
                type="number"
                step="0.1"
                value={scoringRules.teamBBonus}
                onChange={(event) =>
                  setScoringRules((current) => ({
                    ...current,
                    teamBBonus: Number(event.target.value) || 0,
                  }))
                }
                data-testid="matchup-scoring-team-b-bonus-input"
                className="mt-2 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <span className="text-[11px] uppercase tracking-wider text-white/45">Variance multiplier</span>
              <input
                type="number"
                step="0.01"
                min="0.65"
                max="1.8"
                value={scoringRules.varianceMultiplier}
                onChange={(event) =>
                  setScoringRules((current) => ({
                    ...current,
                    varianceMultiplier: Number(event.target.value) || 1,
                  }))
                }
                data-testid="matchup-scoring-variance-multiplier-input"
                className="mt-2 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <span className="text-[11px] uppercase tracking-wider text-white/45">AI explanation</span>
              <button
                type="button"
                onClick={() => setAiExplanationEnabled((current) => !current)}
                data-testid="matchup-ai-insight-toggle"
                className={`mt-2 w-full rounded-lg border px-3 py-2 text-sm ${
                  aiExplanationEnabled
                    ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-100'
                    : 'border-white/15 bg-black/40 text-white/75'
                }`}
              >
                {aiExplanationEnabled ? 'Enabled' : 'Disabled'}
              </button>
            </label>
            <label className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <span className="text-[11px] uppercase tracking-wider text-white/45">Story narrative</span>
              <button
                type="button"
                onClick={() => setStoryNarrativeEnabled((current) => !current)}
                data-testid="matchup-story-toggle"
                className={`mt-2 w-full rounded-lg border px-3 py-2 text-sm ${
                  storyNarrativeEnabled
                    ? 'border-violet-400/60 bg-violet-500/20 text-violet-100'
                    : 'border-white/15 bg-black/40 text-white/75'
                }`}
              >
                {storyNarrativeEnabled ? 'Enabled' : 'Disabled'}
              </button>
            </label>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <LineupEditor
              teamKey="A"
              title="Team A"
              accentClass="border-cyan-500/25 bg-cyan-500/5"
              teamName={teamAName}
              onTeamNameChange={setTeamAName}
              presetId={selectedPresetA}
              onPresetChange={(value) => applyPreset('A', value)}
              presetOptions={sportPresets}
              lineup={lineupA}
              onLineupChange={(updater) => setLineupA((current) => updater(current))}
              teamSummary={previewTeamSummaryA}
              scheduleFactors={scheduleFactorsA}
              onScheduleFactorChange={(factorId, value) => setScheduleFactorsA((current) => ({ ...current, [factorId]: value }))}
              scheduleFactorDefinitions={scheduleFactorDefinitions}
            />
            <LineupEditor
              teamKey="B"
              title="Team B"
              accentClass="border-amber-500/25 bg-amber-500/5"
              teamName={teamBName}
              onTeamNameChange={setTeamBName}
              presetId={selectedPresetB}
              onPresetChange={(value) => applyPreset('B', value)}
              presetOptions={sportPresets}
              lineup={lineupB}
              onLineupChange={(updater) => setLineupB((current) => updater(current))}
              teamSummary={previewTeamSummaryB}
              scheduleFactors={scheduleFactorsB}
              onScheduleFactorChange={(factorId, value) => setScheduleFactorsB((current) => ({ ...current, [factorId]: value }))}
              scheduleFactorDefinitions={scheduleFactorDefinitions}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void runSimulation()}
              disabled={loading}
              className="gap-2"
              data-audit="simulate-button-works"
              data-testid="matchup-compare-button"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Simulate matchup
            </Button>
            <Button
              variant="outline"
              onClick={() => void runSimulation()}
              disabled={loading}
              className="gap-2 border-white/20"
              data-audit="rerun-simulation-works"
              data-testid="matchup-rerun-button"
            >
              <RefreshCw className="h-4 w-4" />
              Rerun simulation
            </Button>
            <Button variant="outline" onClick={resetSimulator} className="border-white/20" data-testid="matchup-reset-button">
              Reset
            </Button>
            <Button variant="outline" onClick={clearSimulation} className="border-white/20" data-testid="matchup-clear-button">
              Clear
            </Button>
          </div>

          {!result && !loading && !error && <p className="text-sm text-white/55">{MATCHUP_SIMULATOR_MESSAGES.empty}</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {isOutOfSync && !loading && (
            <p className="text-sm text-cyan-300" data-audit="lineup-change-updates-simulation">
              Lineup or schedule context changed. Refreshing the deterministic sim now.
            </p>
          )}
        </CardContent>
      </Card>
      {result && (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]">
            <Card className="border-white/10 bg-white/5">
              <CardHeader>
                <CardTitle className="text-lg text-white">Win probability</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <WinProbabilityMeter
                  winProbabilityA={result.winProbabilityA}
                  winProbabilityB={result.winProbabilityB}
                  teamAName={teamAName}
                  teamBName={teamBName}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <p className="text-[11px] uppercase tracking-wider text-white/45">Expected score</p>
                    <p className="mt-1 text-lg font-semibold text-white">
                      {result.projectedScoreA.toFixed(1)} - {result.projectedScoreB.toFixed(1)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <p className="text-[11px] uppercase tracking-wider text-white/45">Margin mean</p>
                    <p className="mt-1 text-lg font-semibold text-white">
                      {result.marginMean >= 0 ? '+' : ''}
                      {result.marginMean.toFixed(1)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <p className="text-[11px] uppercase tracking-wider text-white/45">Deterministic seed</p>
                    <p className="mt-1 text-lg font-semibold text-white">
                      {result.deterministicSeed ?? 'n/a'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {result.providerInsights && (
              <Card className="border-white/10 bg-white/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg text-white">
                    <Sparkles className="h-4 w-4 text-cyan-300" />
                    AI insight overlays
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {AI_PROVIDER_LABELS.map((provider) => (
                    <div key={provider.id} className={`rounded-xl border p-3 ${provider.accent}`}>
                      <div className="flex items-center gap-2">
                        <Bot className="h-4 w-4" />
                        <div>
                          <p className="text-sm font-semibold">{provider.title}</p>
                          <p className="text-[11px] opacity-70">{provider.subtitle}</p>
                        </div>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-white/90">
                        {result.providerInsights?.[provider.id]}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          {result.storyNarrative?.text && (
            <Card className="border-white/10 bg-white/5" data-testid="matchup-story-narrative-panel">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg text-white">
                  <Sparkles className="h-4 w-4 text-violet-300" />
                  Matchup story
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-white/90" data-testid="matchup-story-narrative">
                  {result.storyNarrative.text}
                </p>
              </CardContent>
            </Card>
          )}

          {result.prediction && (
            <Card className="border-white/10 bg-white/5" data-testid="matchup-prediction-engine-panel">
              <CardHeader>
                <CardTitle className="text-lg text-white">Deterministic prediction engine</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-white/45">Projected score</p>
                  <p
                    className="mt-1 text-lg font-semibold text-white"
                    data-testid="matchup-prediction-projected-score"
                  >
                    {result.prediction.projectedScoreA.toFixed(1)} -{' '}
                    {result.prediction.projectedScoreB.toFixed(1)}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-white/45">Win probability</p>
                  <p
                    className="mt-1 text-lg font-semibold text-cyan-200"
                    data-testid="matchup-prediction-win-prob"
                  >
                    {(result.prediction.winProbabilityA * 100).toFixed(1)}% /{' '}
                    {(result.prediction.winProbabilityB * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-white/45">Confidence spread</p>
                  <p
                    className="mt-1 text-lg font-semibold text-white"
                    data-testid="matchup-prediction-confidence"
                  >
                    {result.prediction.confidenceBand}
                  </p>
                  <p className="text-[11px] text-white/45">
                    x{result.prediction.appliedRules.pointMultiplier.toFixed(2)} scoring • x
                    {result.prediction.appliedRules.varianceMultiplier.toFixed(2)} variance
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-white/10 bg-white/5">
            <CardHeader>
              <CardTitle className="text-lg text-white">Simulation output</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="matchup-chart-toggle-distribution"
                  onClick={() => setChartMode('distribution')}
                  className={`rounded px-3 py-1 text-xs ${
                    chartMode === 'distribution'
                      ? 'bg-cyan-500/20 text-cyan-200'
                      : 'border border-white/20 text-white/70 hover:bg-white/10'
                  }`}
                >
                  Distribution chart
                </button>
                <button
                  type="button"
                  data-testid="matchup-chart-toggle-scorerange"
                  onClick={() => setChartMode('scoreRanges')}
                  className={`rounded px-3 py-1 text-xs ${
                    chartMode === 'scoreRanges'
                      ? 'bg-cyan-500/20 text-cyan-200'
                      : 'border border-white/20 text-white/70 hover:bg-white/10'
                  }`}
                >
                  Score ranges
                </button>
              </div>
              {chartMode === 'distribution' ? (
                <SimulationChart
                  expectedScoreA={result.projectedScoreA}
                  expectedScoreB={result.projectedScoreB}
                  scoreDistributionA={result.scoreDistributionA}
                  scoreDistributionB={result.scoreDistributionB}
                  teamAName={teamAName}
                  teamBName={teamBName}
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="matchup-score-range-display">
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white/80">
                    <p className="text-xs text-white/60">{teamAName} likely range</p>
                    <p className="text-lg font-semibold text-cyan-300">
                      {formatScoreRangeLabel(result.scoreRangeA)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white/80">
                    <p className="text-xs text-white/60">{teamBName} likely range</p>
                    <p className="text-lg font-semibold text-amber-300">
                      {formatScoreRangeLabel(result.scoreRangeB)}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {comparisonSummary && (
            <Card className="border-white/10 bg-white/5">
              <CardHeader>
                <CardTitle className="text-lg text-white">Strengths and weaknesses</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-emerald-300">{comparisonSummary.strengthSummary}</p>
                <p className="text-sm text-amber-300">{comparisonSummary.weaknessSummary}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ul className="space-y-1 text-xs text-emerald-100/90">
                    {comparisonSummary.strengthBullets.map((bullet) => (
                      <li key={bullet}>- {bullet}</li>
                    ))}
                  </ul>
                  <ul className="space-y-1 text-xs text-amber-100/90">
                    {comparisonSummary.weaknessBullets.map((bullet) => (
                      <li key={bullet}>- {bullet}</li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          )}

          <UpsideDownsideCards
            upsideScenario={result.upsideScenario ?? null}
            downsideScenario={result.downsideScenario ?? null}
            teamAName={teamAName}
            teamBName={teamBName}
          />
          <Card className="border-white/10 bg-white/5">
            <CardHeader>
              <CardTitle className="text-lg text-white">Lineup slot comparison</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="matchup-position-tab-all"
                  onClick={() => setPositionTab('all')}
                  className={`rounded px-3 py-1 text-xs ${
                    positionTab === 'all'
                      ? 'bg-cyan-500/20 text-cyan-200'
                      : 'border border-white/20 text-white/70 hover:bg-white/10'
                  }`}
                >
                  All slots
                </button>
                <button
                  type="button"
                  data-testid="matchup-position-tab-edges"
                  onClick={() => setPositionTab('edges')}
                  className={`rounded px-3 py-1 text-xs ${
                    positionTab === 'edges'
                      ? 'bg-cyan-500/20 text-cyan-200'
                      : 'border border-white/20 text-white/70 hover:bg-white/10'
                  }`}
                >
                  Advantage only
                </button>
              </div>
              {visiblePositionRows.length > 0 ? (
                <div className="space-y-2" data-testid="matchup-position-comparison-list">
                  {visiblePositionRows.map((row) => (
                    <div
                      key={row.slotId}
                      className="grid grid-cols-[66px_1.15fr_1.15fr_88px] items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs"
                    >
                      <span className="text-white/60">{row.slotLabel}</span>
                      <span className="text-cyan-200">
                        {row.teamAPlayerName}: {row.teamAScore.toFixed(1)}
                      </span>
                      <span className="text-amber-200">
                        {row.teamBPlayerName}: {row.teamBScore.toFixed(1)}
                      </span>
                      <span
                        className={
                          row.advantage === 'even'
                            ? 'text-white/50'
                            : row.advantage === 'A'
                              ? 'text-cyan-300'
                              : 'text-amber-300'
                        }
                      >
                        {row.edgeLabel}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-white/55">No clear slot edge at current projection spread.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/5">
            <CardContent className="space-y-3 pt-4">
              <a
                href={chimmyUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="matchup-ai-explanation-button"
                className="text-sm text-cyan-400 hover:underline"
              >
                Ask Chimmy to explain this matchup {'->'}
              </a>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShareModalOpen(true)}
                  data-testid="matchup-share-button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/20 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/30"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Share matchup
                </button>
                <button
                  type="button"
                  onClick={shareMatchupResult}
                  data-testid="matchup-copy-caption-button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10"
                >
                  {shareCopied ? <Check className="h-3.5 w-3.5" /> : null}
                  {shareCopied ? 'Copied to clipboard' : 'Copy caption'}
                </button>
              </div>
              {result.iterations > 0 && (
                <p className="text-xs text-white/40">
                  {result.iterations.toLocaleString()} simulations
                  {result.deterministicSeed != null ? ` - seed ${result.deterministicSeed}` : ''}
                </p>
              )}
            </CardContent>
          </Card>

          {shareModalOpen && result && (
            <MatchupShareModal
              team1Name={teamAName}
              team2Name={teamBName}
              projectedScore1={result.projectedScoreA}
              projectedScore2={result.projectedScoreB}
              winProbabilityA={result.winProbabilityA}
              winProbabilityB={result.winProbabilityB}
              sport={sport}
              onClose={() => setShareModalOpen(false)}
            />
          )}
        </>
      )}
    </main>
  )
}

