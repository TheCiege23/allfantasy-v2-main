'use client'

import { useCallback, useState } from 'react'
import { dispatchStateRefreshEvent } from '@/lib/state-consistency/state-events'

interface AISuggestion {
  player: string
  position: string
  team?: string | null
  adp?: number
  reason?: string
  confidence?: number
  type?: 'primary' | 'pivot' | 'value'
}

interface AIAssistantState {
  /** Top suggestion */
  bestPick: AISuggestion | null
  /** Explanation (aiInsight) */
  explanation: string
  /** Top 2-3 options for comparison */
  compareOptions: AISuggestion[]
  /** Positional run warning: e.g. "RB run: 4 of last 5 picks" */
  positionalRunWarning: string | null
  /** Roster construction warning */
  rosterWarning: string | null
  reachWarning: string | null
  valueWarning: string | null
  scarcityInsight: string | null
  stackInsight: string | null
  correlationInsight: string | null
  formatInsight: string | null
  byeNote: string | null
  evidence: string[]
  caveats: string[]
  uncertainty: string | null
  /** Platform strategy context for this sport/timeframe. */
  strategyMetaContext: Array<{
    strategyType: string
    strategyLabel?: string
    usageRate: number
    successRate: number
    trendingDirection: string
  }>
  loading: boolean
  error: string | null
}

const defaultState: AIAssistantState = {
  bestPick: null,
  explanation: '',
  compareOptions: [],
  positionalRunWarning: null,
  rosterWarning: null,
  reachWarning: null,
  valueWarning: null,
  scarcityInsight: null,
  stackInsight: null,
  correlationInsight: null,
  formatInsight: null,
  byeNote: null,
  evidence: [],
  caveats: [],
  uncertainty: null,
  strategyMetaContext: [],
  loading: false,
  error: null,
}

function normalizeRosterPosition(position: string, sport?: string): string {
  const normalized = String(position || '').toUpperCase().trim()
  const normalizedSport = String(sport || '').toUpperCase().trim()
  if (!normalized) return ''

  if ((normalizedSport === 'NFL' || normalizedSport === 'NCAAF') && (normalized === 'DST' || normalized === 'D/ST')) {
    return 'DEF'
  }

  if (normalizedSport === 'MLB') {
    if (normalized === 'SP' || normalized === 'RP') return 'P'
    if (normalized === 'LF' || normalized === 'CF' || normalized === 'RF') return 'OF'
  }

  return normalized
}

function detectPositionalRun(
  recentPicks: { position: string }[],
  windowSize = 5,
  threshold = 3,
): string | null {
  if (recentPicks.length < threshold) return null
  const last = recentPicks.slice(-windowSize)
  const byPos: Record<string, number> = {}
  for (const pick of last) {
    const position = pick.position || 'OTHER'
    byPos[position] = (byPos[position] || 0) + 1
  }
  const entry = Object.entries(byPos).find(([, count]) => count >= threshold)
  if (entry) return `${entry[0]} run: ${entry[1]} of last ${last.length} picks`
  return null
}

function getRosterWarning(
  rosterCounts: Record<string, number>,
  rosterSlots: string[],
  sport?: string,
): string | null {
  const normalizedSport = String(sport || '').toUpperCase().trim()
  const starterTargets = rosterSlots.reduce<Record<string, number>>((acc, slot) => {
    const normalized = normalizeRosterPosition(slot, sport)
    if (!normalized || ['FLEX', 'SUPER_FLEX', 'SUPERFLEX', 'OP', 'UTIL', 'BENCH', 'BN', 'IR', 'TAXI'].includes(normalized)) {
      return acc
    }
    if ((normalizedSport === 'NBA' || normalizedSport === 'NCAAB') && (normalized === 'G' || normalized === 'F')) return acc
    if (normalizedSport === 'MLB' && normalized === 'DH') return acc
    if ((normalizedSport === 'NFL' || normalizedSport === 'NCAAF') && ['DL', 'DB', 'IDP_FLEX'].includes(normalized)) return acc
    acc[normalized] = (acc[normalized] || 0) + 1
    return acc
  }, {})

  const underfilled = Object.entries(starterTargets)
    .map(([position, required]) => ({
      position,
      required,
      current: rosterCounts[position] || 0,
    }))
    .filter((entry) => entry.current < entry.required)
    .sort((a, b) => (a.current / Math.max(1, a.required)) - (b.current / Math.max(1, b.required)))

  if (underfilled[0]) {
    const top = underfilled[0]
    if (top.current === 0) return `No ${top.position} yet - consider targeting one soon.`
    return `${top.position} depth is light for this build.`
  }

  return null
}

export interface FetchSuggestionParams {
  available: Array<{ name: string; position: string; team?: string | null; adp?: number; value?: number; isRookie?: boolean }>
  teamRoster: { position: string }[]
  rosterSlots: string[]
  round: number
  pick: number
  totalTeams: number
  managerName: string
  sport?: string
  isDynasty?: boolean
  isSF?: boolean
  isRookieDraft?: boolean
  mode?: 'needs' | 'bpa'
  leagueId?: string
  leagueName?: string
  /** Recent picks (for positional run detection) */
  recentPicks?: { position: string }[]
}

export function useAIDraftAssistant() {
  const [state, setState] = useState<AIAssistantState>(defaultState)

  const fetchSuggestion = useCallback(async (params: FetchSuggestionParams): Promise<void> => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const res = await fetch('/api/mock-draft/ai-pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'dm-suggestion',
          available: params.available,
          teamRoster: params.teamRoster,
          rosterSlots: params.rosterSlots,
          round: params.round,
          pick: params.pick,
          totalTeams: params.totalTeams,
          managerName: params.managerName,
          sport: params.sport,
          isDynasty: params.isDynasty ?? false,
          isSF: params.isSF ?? false,
          isRookieDraft: params.isRookieDraft ?? false,
          mode: params.mode ?? 'needs',
          leagueContext: {
            rosterPositions: params.rosterSlots,
            scoringSettings: {},
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setState((current) => ({ ...current, loading: false, error: data.error || 'Request failed' }))
        return
      }

      const suggestions: AISuggestion[] = (data.suggestions || []).slice(0, 3).map((suggestion: any) => ({
        player: suggestion.player,
        position: suggestion.position,
        team: suggestion.team,
        adp: suggestion.adp,
        reason: suggestion.reason,
        confidence: suggestion.confidence,
        type: suggestion.type,
      }))
      const rosterCounts = data.rosterCounts || {}
      const strategyMetaContext = Array.isArray(data.strategyMetaContext) ? data.strategyMetaContext : []
      const positionalRunWarning = params.recentPicks
        ? detectPositionalRun(params.recentPicks)
        : null
      const rosterWarning = getRosterWarning(rosterCounts, params.rosterSlots, params.sport)

      setState({
        bestPick: suggestions[0] || null,
        explanation: data.aiInsight || '',
        compareOptions: suggestions,
        positionalRunWarning,
        rosterWarning,
        reachWarning: data.reachWarning ?? null,
        valueWarning: data.valueWarning ?? null,
        scarcityInsight: data.scarcityInsight ?? null,
        stackInsight: data.stackInsight ?? null,
        correlationInsight: data.correlationInsight ?? null,
        formatInsight: data.formatInsight ?? null,
        byeNote: data.byeNote ?? null,
        evidence: Array.isArray(data.evidence) ? data.evidence : [],
        caveats: Array.isArray(data.caveats) ? data.caveats : [],
        uncertainty: data.uncertainty ?? null,
        strategyMetaContext,
        loading: false,
        error: null,
      })
      dispatchStateRefreshEvent({
        domain: 'ai',
        reason: 'draft_assistant_response',
        leagueId: params.leagueId ?? null,
        source: 'useAIDraftAssistant',
      })
      if (params.leagueId) {
        dispatchStateRefreshEvent({
          domain: 'drafts',
          reason: 'draft_assistant_response',
          leagueId: params.leagueId,
          source: 'useAIDraftAssistant',
        })
      }
    } catch (error: any) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error?.message || 'AI suggestion failed',
      }))
    }
  }, [])

  const clear = useCallback(() => {
    setState(defaultState)
  }, [])

  return { ...state, fetchSuggestion, clear }
}
