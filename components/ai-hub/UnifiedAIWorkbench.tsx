'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { getAIToolRegistry } from '@/lib/ai-tool-registry'
import {
  AILoadingSkeleton,
  AIErrorFallback,
  AIProviderSelector,
  AIModeSelector,
  UnifiedBrainResultView,
} from '@/components/ai-interface'
import type { AIMode } from '@/components/ai-interface'
import { getChimmyChatHrefWithPrompt } from '@/lib/ai-product-layer/UnifiedChimmyEntryResolver'
import AIFailureStateRenderer from '@/components/ai-reliability/AIFailureStateRenderer'
import type { ReliabilityMetadata } from '@/lib/ai-reliability/types'
import type { DeterministicContextEnvelope, NormalizedToolOutput } from '@/lib/ai-context-envelope'
import { useProviderStatus } from '@/hooks/useProviderStatus'
import type { AIProvider } from '@/lib/ai-tool-registry'

const REQUEST_LOCK_MIN_MS = 120

type ProviderResult = {
  provider: string
  raw: string
  error?: string | null
  skipped?: boolean
  latencyMs?: number
}

type ProviderStatusItem = {
  provider: string
  status: 'ok' | 'failed' | 'timeout' | 'invalid_response'
  error?: string
  latencyMs?: number
}

type ReliabilityDisagreement = {
  hasDisagreement: boolean
  explanation: string
  primaryVerdict: string
  primaryConfidence: number
  alternateVerdicts: Array<{ verdict: string; confidence: number; provider: string }>
}

type ReliabilityMeta = {
  usedDeterministicFallback: boolean
  message?: string
  fallbackExplanation?: string
  dataQualityWarnings?: string[]
  hardViolation?: boolean
  confidence?: number
  confidenceSource?: 'deterministic' | 'llm' | 'capped'
  partialProviderFailure?: boolean
  disagreement?: ReliabilityDisagreement
  providerStatus?: ProviderStatusItem[]
}

type AlternateOutput = {
  provider: string
  text: string
}

type UnifiedRunResponse = {
  evidence: string[]
  aiExplanation: string
  actionPlan?: string | null
  confidence?: number | null
  confidenceLabel?: 'low' | 'medium' | 'high' | null
  confidenceReason?: string | null
  uncertainty?: string | null
  providerResults: ProviderResult[]
  usedDeterministicFallback?: boolean
  reliability?: ReliabilityMeta | null
  factGuardWarnings?: string[]
  alternateOutputs?: AlternateOutput[]
  deterministicEnvelope?: DeterministicContextEnvelope | null
  normalizedOutput?: NormalizedToolOutput | null
  debugTrace?: {
    traceId?: string | null
    toolId?: string
    envelopeId?: string
    providerUsed?: string
    dataQualitySummary?: string
    confidenceCapped?: boolean
    uncertaintyCount?: number
    missingDataCount?: number
    sportsDataSource?: string
    sportsDataState?: 'live' | 'cached' | 'stale' | 'missing'
    sportsDataAvailable?: boolean
    sportsDataKeys?: string[]
    sportsDataMissingCount?: number
    sportsDataAttemptedSources?: string[]
  } | null
}

const SPORT_LABELS: Record<string, string> = {
  NFL: 'NFL',
  NHL: 'NHL',
  NBA: 'NBA',
  MLB: 'MLB',
  NCAAB: 'NCAA Basketball',
  NCAAF: 'NCAA Football',
  SOCCER: 'Soccer',
}

const WORKBENCH_TOOL_KEYS = [
  'chimmy_chat',
  'trade_analyzer',
  'waiver_ai',
  'draft_helper',
  'rankings',
  'psychological',
  'story_creator',
] as const

const QUICK_CHIPS = [
  { id: 'trade', label: 'Explain this trade', prompt: 'Explain this trade using fairness and acceptance context.' },
  { id: 'waiver', label: 'Waiver plan', prompt: 'Give me a waiver action plan with FAAB priorities.' },
  { id: 'draft', label: 'Draft pick help', prompt: 'Who should I draft next and why?' },
  { id: 'risk', label: 'Confidence check', prompt: 'What is uncertain in this recommendation and why?' },
]

const ENTRY_BUTTONS = [
  { id: 'ask-ai', label: 'Ask AI', tool: 'chimmy_chat', prompt: 'Help me with my next best move.' },
  { id: 'explain-trade', label: 'Explain Trade', tool: 'trade_analyzer', prompt: 'Explain this trade from both sides.' },
  { id: 'waiver', label: 'AI Waiver', tool: 'waiver_ai', prompt: 'What waiver move gives me the best edge this week?' },
  { id: 'draft', label: 'AI Draft Helper', tool: 'draft_helper', prompt: "I'm on the clock. Give me the best pick and two pivots." },
  { id: 'rankings', label: 'Rankings Explanation', tool: 'rankings', prompt: 'Explain these rankings with evidence and caveats.' },
  { id: 'psychological', label: 'Psychological Profile', tool: 'psychological', prompt: 'Explain this manager profile with evidence.' },
  { id: 'story', label: 'Story Creator', tool: 'story_creator', prompt: 'Create a concise rivalry storyline with facts only.' },
] as const

function getDeterministicContext(tool: string, sport: string): Record<string, unknown> | null {
  switch (tool) {
    case 'trade_analyzer':
      return {
        fairnessScore: 53,
        valueDelta: 112,
        sideATotalValue: 8475,
        sideBTotalValue: 8363,
        sport,
      }
    case 'waiver_ai':
      return {
        candidates: [
          { player: 'Example Add 1', priorityScore: 81 },
          { player: 'Example Add 2', priorityScore: 75 },
        ],
        leagueSettings: { waiverType: 'FAAB', teams: 12, scoring: 'ppr' },
      }
    case 'draft_helper':
      return {
        board: [
          { name: 'Best Available 1', tier: 2, adp: 48 },
          { name: 'Best Available 2', tier: 2, adp: 52 },
        ],
        roster: { qb: 1, rb: 2, wr: 3, te: 1, flex: 1 },
        scoring: { format: 'ppr', superflex: false },
      }
    case 'rankings':
      return {
        ordering: ['Team Alpha', 'Team Beta', 'Team Gamma'],
        tiers: {
          tier1: ['Team Alpha'],
          tier2: ['Team Beta', 'Team Gamma'],
        },
      }
    case 'psychological':
      return {
        profile: { style: 'aggressive', risk: 'high' },
        evidence: ['Trade frequency above league median', 'FAAB velocity elevated'],
      }
    case 'story_creator':
      return {
        leagueSummary: 'Two contenders tied for first heading into playoffs.',
        facts: ['Rivalry series tied 4-4', 'Average margin 3.2 points'],
      }
    default:
      return null
  }
}

function buildLeagueSettings(sport: string): Record<string, unknown> {
  return {
    sport,
    format: 'dynasty',
    scoring: 'ppr',
    teams: 12,
    roster: '1QB 2RB 3WR 1TE 1FLEX',
  }
}

export default function UnifiedAIWorkbench() {
  const registry = useMemo(
    () =>
      getAIToolRegistry().filter((tool) =>
        WORKBENCH_TOOL_KEYS.includes(tool.toolKey as (typeof WORKBENCH_TOOL_KEYS)[number])
      ),
    []
  )
  const [sport, setSport] = useState<string>('NFL')
  const [selectedTool, setSelectedTool] = useState<string>('chimmy_chat')
  const [mode, setMode] = useState<AIMode>('unified_brain')
  const [prompt, setPrompt] = useState<string>('Help me make the best evidence-based move.')
  const [result, setResult] = useState<UnifiedRunResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedExplanation, setExpandedExplanation] = useState(false)
  const [mobileResultOpen, setMobileResultOpen] = useState(false)
  const [lastAction, setLastAction] = useState<'run' | 'compare'>('run')
  const [selectedAlternateProvider, setSelectedAlternateProvider] = useState<string | null>(null)
  const [providerSelection, setProviderSelection] = useState<'auto' | AIProvider>('auto')
  const [saveLoading, setSaveLoading] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedResultId, setSavedResultId] = useState<string | null>(null)
  const requestInFlightRef = useRef(false)
  const requestLockUntilRef = useRef(0)
  const saveInFlightRef = useRef(false)
  const { status: providerStatus } = useProviderStatus()

  const selectedToolRegistration =
    registry.find((tool) => tool.toolKey === selectedTool) ?? registry[0] ?? null
  const allowedModes = selectedToolRegistration?.supportedModes ?? ['unified_brain']
  const allowedProviders = selectedToolRegistration?.allowedProviders ?? ['openai', 'deepseek', 'grok']
  const availableProviderCount = providerStatus
    ? [providerStatus.openai, providerStatus.deepseek, providerStatus.grok].filter(Boolean).length
    : 0
  const selectedProviderUnavailable =
    providerSelection !== 'auto' &&
    providerStatus != null &&
    (
      (providerSelection === 'openai' && !providerStatus.openai) ||
      (providerSelection === 'deepseek' && !providerStatus.deepseek) ||
      (providerSelection === 'grok' && !providerStatus.grok)
    )

  useEffect(() => {
    if (providerSelection === 'auto') return
    if (!allowedProviders.includes(providerSelection)) {
      setProviderSelection('auto')
      return
    }
    if (selectedProviderUnavailable) {
      setProviderSelection('auto')
    }
  }, [allowedProviders, providerSelection, selectedProviderUnavailable])
  const modelOutputs = result?.providerResults?.map((item) => ({
    model: item.provider as 'openai' | 'deepseek' | 'grok',
    raw: item.raw,
    error: item.error ?? undefined,
    skipped: item.skipped ?? false,
  }))
  const activeAlternate = result?.alternateOutputs?.find((output) => output.provider === selectedAlternateProvider) ?? null
  const activeExplanation = activeAlternate?.text ?? result?.aiExplanation ?? ''
  const reliabilityForRenderer = useMemo<ReliabilityMetadata | null>(() => {
    if (!result?.reliability) return null
    return {
      confidence:
        typeof result.reliability.confidence === 'number'
          ? result.reliability.confidence
          : typeof result.confidence === 'number'
            ? result.confidence
            : 0,
      usedDeterministicFallback:
        result.reliability.usedDeterministicFallback ?? Boolean(result.usedDeterministicFallback),
      providerResults: (result.reliability.providerStatus ?? []).map((provider) => ({
        provider: provider.provider,
        status: provider.status,
        error: provider.error,
        latencyMs: provider.latencyMs,
      })),
      fallbackExplanation: result.reliability.fallbackExplanation ?? result.reliability.message,
      dataQualityWarnings: result.reliability.dataQualityWarnings ?? result.factGuardWarnings ?? [],
      hardViolation: Boolean(result.reliability.hardViolation),
    }
  }, [result])

  const runRequest = async (action: 'run' | 'compare') => {
    const now = Date.now()
    if (requestInFlightRef.current || now < requestLockUntilRef.current) return
    if (!prompt.trim()) {
      setError('Enter a prompt before running AI.')
      return
    }
    requestInFlightRef.current = true
    requestLockUntilRef.current = now + REQUEST_LOCK_MIN_MS
    setLoading(true)
    setError(null)
    setSaveError(null)
    setSavedResultId(null)
    setLastAction(action)
    setSelectedAlternateProvider(null)

    const endpoint = action === 'compare' ? '/api/ai/compare' : '/api/ai/run'
    const forceSingleProvider = providerSelection !== 'auto'
    const requestMode = action === 'compare' ? 'consensus' : (forceSingleProvider ? 'single_model' : mode)
    const body = {
      tool: selectedTool,
      sport,
      leagueId: 'ai-workbench-league',
      leagueSettings: buildLeagueSettings(sport),
      deterministicContext: getDeterministicContext(selectedTool, sport),
      aiMode: requestMode,
      provider: forceSingleProvider ? providerSelection : null,
      userMessage: prompt.trim(),
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await response.json().catch(() => null)) as Record<string, unknown> | null
      if (!response.ok) {
        const serverError =
          (typeof data?.userMessage === 'string' && data.userMessage) ||
          (typeof data?.message === 'string' && data.message) ||
          'AI request failed.'
        setError(serverError)
        setResult(null)
        return
      }

      const parsed: UnifiedRunResponse = {
        evidence: Array.isArray(data?.evidence)
          ? data.evidence.filter((item): item is string => typeof item === 'string')
          : [],
        aiExplanation: typeof data?.aiExplanation === 'string' ? data.aiExplanation : '',
        actionPlan: typeof data?.actionPlan === 'string' ? data.actionPlan : null,
        confidence: typeof data?.confidence === 'number' ? data.confidence : null,
        confidenceLabel:
          data?.confidenceLabel === 'low' || data?.confidenceLabel === 'medium' || data?.confidenceLabel === 'high'
            ? data.confidenceLabel
            : null,
        confidenceReason: typeof data?.confidenceReason === 'string' ? data.confidenceReason : null,
        uncertainty: typeof data?.uncertainty === 'string' ? data.uncertainty : null,
        providerResults: Array.isArray(data?.providerResults)
          ? (data.providerResults as ProviderResult[])
          : [],
        usedDeterministicFallback: Boolean(data?.usedDeterministicFallback),
        reliability:
          data?.reliability && typeof data.reliability === 'object'
            ? (data.reliability as ReliabilityMeta)
            : null,
        factGuardWarnings: Array.isArray(data?.factGuardWarnings)
          ? data.factGuardWarnings.filter((item): item is string => typeof item === 'string')
          : [],
        alternateOutputs: Array.isArray(data?.alternateOutputs)
          ? data.alternateOutputs.filter(
              (item): item is AlternateOutput =>
                Boolean(item) &&
                typeof item === 'object' &&
                typeof (item as AlternateOutput).provider === 'string' &&
                typeof (item as AlternateOutput).text === 'string'
            )
          : [],
        deterministicEnvelope:
          data?.deterministicEnvelope && typeof data.deterministicEnvelope === 'object'
            ? (data.deterministicEnvelope as DeterministicContextEnvelope)
            : null,
        normalizedOutput:
          data?.normalizedOutput && typeof data.normalizedOutput === 'object'
            ? (data.normalizedOutput as NormalizedToolOutput)
            : null,
        debugTrace:
          data?.debugTrace && typeof data.debugTrace === 'object'
            ? (data.debugTrace as UnifiedRunResponse['debugTrace'])
            : null,
      }

      setResult(parsed)
      setSelectedAlternateProvider(null)
      setExpandedExplanation(false)
      setMobileResultOpen(true)
    } catch {
      setError('Network error while running AI. Please retry.')
      setResult(null)
    } finally {
      setLoading(false)
      const unlock = () => {
        requestInFlightRef.current = false
      }
      const remainingLockMs = requestLockUntilRef.current - Date.now()
      if (remainingLockMs > 0 && typeof window !== 'undefined') {
        window.setTimeout(unlock, remainingLockMs)
      } else {
        unlock()
      }
    }
  }

  const handleSaveResult = async () => {
    if (!result || saveInFlightRef.current) return
    saveInFlightRef.current = true
    setSaveLoading(true)
    setSaveError(null)
    try {
      const response = await fetch('/api/ai/history', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tool: selectedTool,
          sport,
          aiMode: providerSelection === 'auto' ? mode : 'single_model',
          provider: providerSelection === 'auto' ? null : providerSelection,
          prompt: prompt.trim(),
          output: {
            evidence: result.evidence,
            aiExplanation: result.aiExplanation,
            actionPlan: result.actionPlan,
            confidence: result.confidence,
            confidenceLabel: result.confidenceLabel,
            confidenceReason: result.confidenceReason,
            uncertainty: result.uncertainty,
            providerResults: result.providerResults,
            usedDeterministicFallback: result.usedDeterministicFallback,
            reliability: result.reliability,
            factGuardWarnings: result.factGuardWarnings,
            alternateOutputs: result.alternateOutputs,
            normalizedOutput: result.normalizedOutput,
            debugTrace: result.debugTrace,
          },
        }),
      })
      const data = (await response.json().catch(() => null)) as
        | { id?: string; userMessage?: string; message?: string }
        | null
      if (!response.ok) {
        const message =
          data?.userMessage ??
          data?.message ??
          'Unable to save this AI result right now.'
        setSaveError(message)
        toast.error(message)
        return
      }
      setSavedResultId(typeof data?.id === 'string' ? data.id : 'saved')
      toast.success('AI result saved to history.')
    } catch {
      const message = 'Network error while saving this AI result.'
      setSaveError(message)
      toast.error(message)
    } finally {
      setSaveLoading(false)
      saveInFlightRef.current = false
    }
  }

  const handleCopy = async () => {
    if (!activeExplanation) return
    try {
      await navigator.clipboard.writeText(activeExplanation)
      toast.success('AI explanation copied.')
    } catch {
      toast.error('Unable to copy response.')
    }
  }

  const displayedExplanation = useMemo(() => {
    if (!activeExplanation) return ''
    if (expandedExplanation || activeExplanation.length <= 380) return activeExplanation
    return `${activeExplanation.slice(0, 380)}...`
  }, [activeExplanation, expandedExplanation])
  const shouldShowReliabilityBanner = Boolean(
    reliabilityForRenderer &&
      (
        reliabilityForRenderer.usedDeterministicFallback ||
        reliabilityForRenderer.providerResults.some((provider) => provider.status !== 'ok') ||
        (reliabilityForRenderer.dataQualityWarnings?.length ?? 0) > 0 ||
        Boolean(result?.reliability?.disagreement?.hasDisagreement)
      )
  )
  const sportsDataState = result?.debugTrace?.sportsDataState
  const showSportsContextNotice = Boolean(
    result && (
      sportsDataState === 'stale' ||
      sportsDataState === 'missing' ||
      (result.debugTrace?.sportsDataMissingCount ?? 0) > 0
    )
  )

  return (
    <section
      className="mb-8 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-5"
      data-testid="unified-ai-workbench"
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-white">Unified AI Interface</h2>
          <p className="text-xs text-white/55">
            Deterministic-first orchestration across tools, with mode control, comparison, and confidence-aware output.
          </p>
        </div>
        <Link
          href="/messages?tab=ai"
          data-testid="unified-ai-chat-open-button"
          className="inline-flex min-h-[44px] w-full touch-manipulation items-center justify-center rounded-lg border border-white/20 bg-white/[0.03] px-3 py-2 text-xs text-white/80 hover:bg-white/10 sm:w-auto sm:justify-start sm:py-1.5"
        >
          Open AI Chat
        </Link>
      </div>

      <div className="scrollbar-none -mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [-webkit-overflow-scrolling:touch]">
        {ENTRY_BUTTONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            data-testid={`unified-ai-entry-${entry.id}-button`}
            onClick={() => {
              setSelectedTool(entry.tool)
              setPrompt(entry.prompt)
              setResult(null)
              setError(null)
              setSelectedAlternateProvider(null)
            }}
            className="shrink-0 touch-manipulation rounded-lg border border-white/15 bg-white/[0.03] px-3 py-2.5 text-xs font-medium text-white/80 hover:bg-white/10 sm:min-h-0 sm:py-2"
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-white/60">
          Sport
          <select
            value={sport}
            onChange={(event) => setSport(event.target.value)}
            data-testid="unified-ai-sport-selector"
            className="mt-1 min-h-[44px] w-full rounded-lg border border-white/20 bg-white/[0.04] px-3 py-2 text-base text-white sm:min-h-[40px] sm:text-sm"
          >
            {SUPPORTED_SPORTS.map((supportedSport) => (
              <option key={supportedSport} value={supportedSport}>
                {SPORT_LABELS[supportedSport] ?? supportedSport}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-white/60">
          Tool
          <select
            value={selectedTool}
            onChange={(event) => {
              setSelectedTool(event.target.value)
              setResult(null)
              setError(null)
              setSelectedAlternateProvider(null)
            }}
            data-testid="unified-ai-tool-selector"
            className="mt-1 min-h-[44px] w-full rounded-lg border border-white/20 bg-white/[0.04] px-3 py-2 text-base text-white sm:min-h-[40px] sm:text-sm"
          >
            {registry.map((tool) => (
              <option key={tool.toolKey} value={tool.toolKey}>
                {tool.toolName}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-white/60">
          Provider
          <select
            value={providerSelection}
            onChange={(event) => setProviderSelection(event.target.value as 'auto' | AIProvider)}
            data-testid="unified-ai-provider-selector"
            className="mt-1 min-h-[40px] w-full rounded-lg border border-white/20 bg-white/[0.04] px-3 py-2 text-sm text-white"
          >
            <option value="auto">Auto (orchestration)</option>
            {allowedProviders.includes('openai') && (
              <option
                value="openai"
                disabled={providerStatus ? !providerStatus.openai : false}
              >
                OpenAI{providerStatus && !providerStatus.openai ? ' (unavailable)' : ''}
              </option>
            )}
            {allowedProviders.includes('deepseek') && (
              <option
                value="deepseek"
                disabled={providerStatus ? !providerStatus.deepseek : false}
              >
                DeepSeek{providerStatus && !providerStatus.deepseek ? ' (unavailable)' : ''}
              </option>
            )}
            {allowedProviders.includes('grok') && (
              <option
                value="grok"
                disabled={providerStatus ? !providerStatus.grok : false}
              >
                Grok{providerStatus && !providerStatus.grok ? ' (unavailable)' : ''}
              </option>
            )}
          </select>
        </label>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/60">
          {providerSelection === 'auto'
            ? `Auto mode uses available providers (${availableProviderCount || 0} online).`
            : `Pinned provider: ${providerSelection}. Run requests will use single-model mode.`}
        </div>
      </div>

      <div className="mt-3">
        <AIModeSelector
          value={mode}
          onChange={setMode}
          allowedModes={allowedModes}
          className="mb-2"
        />

        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          data-testid="unified-ai-prompt-input"
          placeholder="Explain the decision with evidence and confidence."
          className="min-h-[100px] w-full rounded-lg border border-white/20 bg-white/[0.04] px-3 py-2 text-base text-white placeholder:text-white/40 sm:min-h-[88px] sm:text-sm"
        />

        <div className="scrollbar-none mt-2 flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] sm:flex-wrap sm:overflow-visible sm:pb-0">
          {QUICK_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              data-testid={`unified-ai-quick-chip-${chip.id}`}
              onClick={() => setPrompt(chip.prompt)}
              className="shrink-0 touch-manipulation rounded-full border border-white/20 bg-white/[0.03] px-3 py-2 text-[11px] text-white/75 hover:bg-white/10 sm:py-1"
            >
              {chip.label}
            </button>
          ))}
          <Link
            href={getChimmyChatHrefWithPrompt(prompt)}
            data-testid="unified-ai-open-chimmy-with-prompt-link"
            className="inline-flex shrink-0 touch-manipulation items-center rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[11px] text-cyan-200 hover:bg-cyan-500/20 sm:py-1"
          >
            Open in Chimmy
          </Link>
        </div>
      </div>

      <div className="scrollbar-none mt-4 flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] sm:flex-wrap sm:items-center sm:overflow-visible sm:pb-0">
        <button
          type="button"
          onClick={() => void runRequest('run')}
          data-testid="unified-ai-run-button"
          disabled={loading}
          className="shrink-0 touch-manipulation rounded-lg bg-cyan-500/20 px-4 py-2.5 text-sm font-medium text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-60 sm:py-2"
        >
          Run AI
        </button>
        <button
          type="button"
          onClick={() => void runRequest('compare')}
          data-testid="unified-ai-compare-button"
          disabled={loading || availableProviderCount < 2}
          className="shrink-0 touch-manipulation rounded-lg border border-white/20 bg-white/[0.03] px-4 py-2.5 text-sm text-white/85 hover:bg-white/10 disabled:opacity-60 sm:py-2"
        >
          Compare providers
        </button>
        <button
          type="button"
          onClick={() => void runRequest(lastAction)}
          data-testid="unified-ai-regenerate-button"
          disabled={loading || (!result && !error)}
          className="shrink-0 touch-manipulation rounded-lg border border-white/20 bg-white/[0.03] px-4 py-2.5 text-sm text-white/75 hover:bg-white/10 disabled:opacity-50 sm:py-2"
        >
          Regenerate
        </button>
        <button
          type="button"
          onClick={handleCopy}
          data-testid="unified-ai-copy-button"
          disabled={!activeExplanation}
          className="shrink-0 touch-manipulation rounded-lg border border-white/20 bg-white/[0.03] px-4 py-2.5 text-sm text-white/75 hover:bg-white/10 disabled:opacity-50 sm:py-2"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={() => void handleSaveResult()}
          data-testid="unified-ai-save-result-button"
          disabled={loading || saveLoading || !result}
          className="shrink-0 touch-manipulation rounded-lg border border-white/20 bg-white/[0.03] px-4 py-2.5 text-sm text-white/75 hover:bg-white/10 disabled:opacity-50 sm:py-2"
        >
          {saveLoading ? 'Saving…' : 'Save result'}
        </button>
        <button
          type="button"
          onClick={() => {
            setPrompt('')
            setResult(null)
            setError(null)
            setSaveError(null)
            setSavedResultId(null)
            setSelectedAlternateProvider(null)
          }}
          data-testid="unified-ai-back-button"
          className="shrink-0 touch-manipulation rounded-lg border border-white/20 bg-white/[0.03] px-4 py-2.5 text-sm text-white/75 hover:bg-white/10 sm:py-2"
        >
          Back
        </button>
        <Link
          href="/ai/saved"
          data-testid="unified-ai-open-history-link"
          className="inline-flex shrink-0 touch-manipulation items-center rounded-lg border border-white/20 bg-white/[0.03] px-4 py-2.5 text-sm text-white/75 hover:bg-white/10 sm:py-2"
        >
          Saved recommendations
        </Link>
      </div>

      {saveError && (
        <p className="mt-2 text-xs text-amber-300" data-testid="unified-ai-save-error-text">
          {saveError}
        </p>
      )}
      {savedResultId && !saveError && (
        <p className="mt-2 text-xs text-emerald-300" data-testid="unified-ai-save-success-text">
          Saved to history.
        </p>
      )}

      <AIProviderSelector
        className="mt-3"
        canCompare={Boolean(result?.providerResults?.length && result.providerResults.length > 1)}
        onCompareClick={() => void runRequest('compare')}
      />

      <button
        type="button"
        data-testid="unified-ai-mobile-drawer-open-button"
        onClick={() => setMobileResultOpen(true)}
        className="mt-3 w-full touch-manipulation rounded-lg border border-cyan-500/25 bg-cyan-500/10 py-3 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20 sm:hidden"
      >
        Open result drawer
      </button>

      <div className="mt-4 hidden sm:block">
        {loading && (
          <div data-testid="unified-ai-loading-state">
            <AILoadingSkeleton />
          </div>
        )}

        {!loading && error && (
          <div data-testid="unified-ai-error-state">
            <AIErrorFallback
              message={error}
              onRetry={() => void runRequest(lastAction)}
              retryLoading={loading}
              usedDeterministicFallback={Boolean(result?.usedDeterministicFallback)}
              reliability={reliabilityForRenderer}
              confidence={typeof result?.confidence === 'number' ? result.confidence : undefined}
            />
          </div>
        )}

        {!loading && !error && result && (
          <div className="space-y-3" data-testid="unified-ai-result-panel">
            {shouldShowReliabilityBanner && (
              <AIFailureStateRenderer
                usedDeterministicFallback={Boolean(result.usedDeterministicFallback)}
                fallbackExplanation={
                  result.reliability?.fallbackExplanation ??
                  result.reliability?.message ??
                  (result.usedDeterministicFallback
                    ? 'AI providers are temporarily unavailable. Showing deterministic output.'
                    : undefined)
                }
                reliability={reliabilityForRenderer}
                confidence={typeof result.confidence === 'number' ? result.confidence : undefined}
                onRetry={() => void runRequest(lastAction)}
                retryLoading={loading}
              />
            )}
            {showSportsContextNotice && (
              <div
                className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100"
                data-testid="unified-ai-sports-context-notice"
              >
                <p>
                  {sportsDataState === 'stale'
                    ? 'Sports context is currently stale. Refresh to load the latest deterministic context.'
                    : sportsDataState === 'missing'
                      ? 'Sports context is missing for this run. Retry after refresh to avoid unsupported assumptions.'
                      : 'Some sports context fields are missing. Confidence and uncertainty are capped accordingly.'}
                </p>
                <button
                  type="button"
                  onClick={() => void runRequest(lastAction)}
                  className="mt-2 rounded-md border border-amber-200/40 bg-amber-100/10 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-100/20"
                  data-testid="unified-ai-sports-context-refresh-button"
                >
                  Refresh context
                </button>
              </div>
            )}
            <UnifiedBrainResultView
              primaryAnswer={activeExplanation || result.aiExplanation}
              keyEvidence={result.evidence}
              suggestedNextAction={result.actionPlan ?? undefined}
              confidencePct={result.confidence ?? undefined}
              confidenceLabel={result.confidenceLabel ?? undefined}
              confidenceReason={result.confidenceReason ?? undefined}
              risksCaveats={result.uncertainty ? [result.uncertainty] : undefined}
              modelOutputs={modelOutputs}
              factGuardWarnings={result.factGuardWarnings}
              normalizedOutput={result.normalizedOutput}
              debugTrace={result.debugTrace}
            />
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-white/70">AI explanation</span>
                <button
                  type="button"
                  data-testid="unified-ai-explanation-toggle-button"
                  onClick={() => setExpandedExplanation((current) => !current)}
                  className="rounded-md border border-white/15 bg-white/[0.03] px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
                >
                  {expandedExplanation ? 'Collapse' : 'Expand'}
                </button>
              </div>
              {Array.isArray(result.alternateOutputs) && result.alternateOutputs.length > 0 && (
                <div
                  className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] p-2"
                  data-testid="unified-ai-alternate-output-panel"
                >
                  <button
                    type="button"
                    data-testid="unified-ai-alternate-output-primary-button"
                    onClick={() => setSelectedAlternateProvider(null)}
                    className={`rounded-md border px-2 py-1 text-[11px] ${
                      selectedAlternateProvider == null
                        ? 'border-cyan-400/40 bg-cyan-500/15 text-cyan-100'
                        : 'border-white/15 bg-white/[0.02] text-white/70'
                    }`}
                  >
                    Primary output
                  </button>
                  {result.alternateOutputs.map((alt) => (
                    <button
                      key={alt.provider}
                      type="button"
                      data-testid={`unified-ai-alternate-output-${alt.provider}-button`}
                      onClick={() => setSelectedAlternateProvider(alt.provider)}
                      className={`rounded-md border px-2 py-1 text-[11px] ${
                        selectedAlternateProvider === alt.provider
                          ? 'border-cyan-400/40 bg-cyan-500/15 text-cyan-100'
                          : 'border-white/15 bg-white/[0.02] text-white/70'
                      }`}
                    >
                      {alt.provider} view
                    </button>
                  ))}
                </div>
              )}
              <p
                className="text-sm text-white/85 whitespace-pre-wrap"
                data-testid="unified-ai-explanation-text"
              >
                {displayedExplanation}
              </p>
              {result.reliability?.disagreement?.hasDisagreement && (
                <p
                  className="mt-2 text-xs text-amber-200/85"
                  data-testid="unified-ai-disagreement-note"
                >
                  {result.reliability.disagreement.explanation}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {!loading && error && (
        <div className="mt-4 sm:hidden" data-testid="unified-ai-mobile-error-state">
          <AIErrorFallback
            message={error}
            onRetry={() => void runRequest(lastAction)}
            retryLoading={loading}
            usedDeterministicFallback={Boolean(result?.usedDeterministicFallback)}
            reliability={reliabilityForRenderer}
            confidence={typeof result?.confidence === 'number' ? result.confidence : undefined}
          />
        </div>
      )}

      {mobileResultOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/55 sm:hidden"
          role="presentation"
          onClick={() => setMobileResultOpen(false)}
        >
          <div
            className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-2xl border border-white/15 bg-[#090f1f] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
            data-testid="unified-ai-mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="AI result"
            onClick={(e) => e.stopPropagation()}
          >
          <div className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-white/25" aria-hidden />
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">AI result</h3>
            <button
              type="button"
              data-testid="unified-ai-mobile-drawer-close-button"
              onClick={() => setMobileResultOpen(false)}
              className="touch-manipulation rounded-lg border border-white/20 bg-white/[0.03] px-3 py-2 text-xs font-medium text-white/85 min-h-[44px]"
            >
              Close
            </button>
          </div>
          {loading ? (
            <div data-testid="unified-ai-mobile-loading-state">
              <AILoadingSkeleton />
            </div>
          ) : error ? (
            <div data-testid="unified-ai-mobile-drawer-error-state">
              <AIErrorFallback
                message={error}
                onRetry={() => void runRequest(lastAction)}
                retryLoading={loading}
                usedDeterministicFallback={Boolean(result?.usedDeterministicFallback)}
                reliability={reliabilityForRenderer}
                confidence={typeof result?.confidence === 'number' ? result.confidence : undefined}
              />
            </div>
          ) : result ? (
            <div className="space-y-3">
              {shouldShowReliabilityBanner && (
                <AIFailureStateRenderer
                  usedDeterministicFallback={Boolean(result.usedDeterministicFallback)}
                  fallbackExplanation={
                    result.reliability?.fallbackExplanation ??
                    result.reliability?.message ??
                    (result.usedDeterministicFallback
                      ? 'AI providers are temporarily unavailable. Showing deterministic output.'
                      : undefined)
                  }
                  reliability={reliabilityForRenderer}
                  confidence={typeof result.confidence === 'number' ? result.confidence : undefined}
                  onRetry={() => void runRequest(lastAction)}
                  retryLoading={loading}
                />
              )}
              {showSportsContextNotice && (
                <div
                  className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100"
                  data-testid="unified-ai-mobile-sports-context-notice"
                >
                  <p>
                    {sportsDataState === 'stale'
                      ? 'Sports context is currently stale. Refresh to load the latest deterministic context.'
                      : sportsDataState === 'missing'
                        ? 'Sports context is missing for this run. Retry after refresh to avoid unsupported assumptions.'
                        : 'Some sports context fields are missing. Confidence and uncertainty are capped accordingly.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void runRequest(lastAction)}
                    className="mt-2 rounded-md border border-amber-200/40 bg-amber-100/10 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-100/20"
                    data-testid="unified-ai-mobile-sports-context-refresh-button"
                  >
                    Refresh context
                  </button>
                </div>
              )}
              <UnifiedBrainResultView
                primaryAnswer={activeExplanation || result.aiExplanation}
                keyEvidence={result.evidence}
                suggestedNextAction={result.actionPlan ?? undefined}
                confidencePct={result.confidence ?? undefined}
                confidenceLabel={result.confidenceLabel ?? undefined}
                confidenceReason={result.confidenceReason ?? undefined}
                risksCaveats={result.uncertainty ? [result.uncertainty] : undefined}
                modelOutputs={modelOutputs}
                factGuardWarnings={result.factGuardWarnings}
                normalizedOutput={result.normalizedOutput}
                debugTrace={result.debugTrace}
              />
            </div>
          ) : (
            <p className="text-xs text-white/60">Run AI to view a result.</p>
          )}
          </div>
        </div>
      )}
    </section>
  )
}
