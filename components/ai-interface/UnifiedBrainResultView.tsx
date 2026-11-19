'use client'

import React, { useState } from 'react'
import DeterministicEvidenceCard from './DeterministicEvidenceCard'
import AIVerdictCard from './AIVerdictCard'
import ActionPlanCard from './ActionPlanCard'
import ConfidenceDisplay from './ConfidenceDisplay'
import CompareProvidersView from './CompareProvidersView'
import { AIEvidencePresentation } from '@/components/ai-evidence'
import type { ConfidenceLabel } from './ConfidenceDisplay'
import type { NormalizedToolOutput } from '@/lib/ai-context-envelope'

interface UnifiedBrainResultViewProps {
  primaryAnswer: string
  verdict?: string
  keyEvidence?: string[]
  risksCaveats?: string[]
  suggestedNextAction?: string
  alternatePath?: string
  confidencePct?: number
  confidenceLabel?: ConfidenceLabel
  confidenceReason?: string
  deterministicPayload?: Record<string, unknown> | null
  modelOutputs?: { model: string; raw: string; error?: string; skipped?: boolean }[]
  factGuardWarnings?: string[]
  /** When set, evidence/uncertainty/missing/caveats render from normalized envelope layer */
  normalizedOutput?: NormalizedToolOutput | null
  /** Optional debug trace visibility for admin/support surfaces. */
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
  /** Expand "Sources" (keyEvidence) by default on desktop */
  defaultSourcesExpanded?: boolean
  className?: string
}

/**
 * Unified brain merged result: deterministic facts + synthesis + action + confidence + sources + compare.
 */
export default function UnifiedBrainResultView({
  primaryAnswer,
  verdict,
  keyEvidence,
  risksCaveats,
  suggestedNextAction,
  alternatePath,
  confidencePct,
  confidenceLabel,
  confidenceReason,
  deterministicPayload,
  modelOutputs = [],
  factGuardWarnings,
  normalizedOutput,
  debugTrace,
  defaultSourcesExpanded = false,
  className = '',
}: UnifiedBrainResultViewProps) {
  const [sourcesExpanded, setSourcesExpanded] = useState(defaultSourcesExpanded)
  const [debugExpanded, setDebugExpanded] = useState(false)
  const useNormalized = Boolean(
    normalizedOutput &&
      (
        normalizedOutput.evidence?.length ||
        normalizedOutput.uncertainty?.length ||
        normalizedOutput.missingData?.length ||
        normalizedOutput.caveats?.length ||
        normalizedOutput.confidence
      )
  )

  const hasSources = Array.isArray(keyEvidence) && keyEvidence.length > 0

  return (
    <div className={`space-y-4 ${className}`}>
      {useNormalized && normalizedOutput ? (
        <AIEvidencePresentation
          output={normalizedOutput}
          showConfidence={true}
          toolId={normalizedOutput.trace?.toolId}
        />
      ) : (
        <>
          {deterministicPayload && Object.keys(deterministicPayload).length > 0 && (
            <DeterministicEvidenceCard
              evidence={deterministicPayload}
              defaultExpanded={true}
            />
          )}
          <div className="flex flex-wrap items-center gap-3">
            <ConfidenceDisplay
              confidencePct={confidencePct}
              confidenceLabel={confidenceLabel}
              reason={confidenceReason}
            />
            {factGuardWarnings && factGuardWarnings.length > 0 && (
              <span className="text-xs text-amber-300/80">
                {factGuardWarnings.length} quality note{factGuardWarnings.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {hasSources && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
              <button
                type="button"
                onClick={() => setSourcesExpanded(!sourcesExpanded)}
                data-testid="ai-sources-toggle-button"
                className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-white/[0.04] min-h-[44px]"
                aria-expanded={sourcesExpanded}
              >
                <span className="text-sm font-medium text-white/90">Sources</span>
                <span className="text-xs text-white/50">{sourcesExpanded ? 'Hide' : 'Show'}</span>
              </button>
              {sourcesExpanded && (
                <ul className="border-t border-white/10 p-3 space-y-1 list-disc list-inside text-sm text-white/70">
                  {keyEvidence!.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {risksCaveats && risksCaveats.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="text-xs font-medium text-amber-200/90 mb-1">Caveats</p>
              <ul className="text-xs text-amber-200/80 space-y-0.5 list-disc list-inside">
                {risksCaveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <AIVerdictCard primaryAnswer={primaryAnswer} verdict={verdict ?? normalizedOutput?.verdict} />

      {(suggestedNextAction ?? normalizedOutput?.suggestedNextAction) && (
        <ActionPlanCard
          suggestedNextAction={suggestedNextAction ?? normalizedOutput?.suggestedNextAction ?? ''}
          alternatePath={alternatePath ?? normalizedOutput?.alternatePath}
        />
      )}

      <CompareProvidersView modelOutputs={modelOutputs} />

      {debugTrace && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
          <button
            type="button"
            onClick={() => setDebugExpanded((current) => !current)}
            className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-white/[0.04] min-h-[44px]"
            data-testid="ai-debug-trace-toggle-button"
            aria-expanded={debugExpanded}
          >
            <span className="text-sm font-medium text-white/80">Debug trace</span>
            <span className="text-xs text-white/50">{debugExpanded ? 'Hide' : 'Show'}</span>
          </button>
          {debugExpanded && (
            <dl className="border-t border-white/10 p-3 grid gap-1 text-xs text-white/70">
              {debugTrace.traceId && (
                <div className="flex justify-between gap-2">
                  <dt className="text-white/45">Trace ID</dt>
                  <dd className="text-right break-all">{debugTrace.traceId}</dd>
                </div>
              )}
              {debugTrace.toolId && (
                <div className="flex justify-between gap-2">
                  <dt className="text-white/45">Tool</dt>
                  <dd className="text-right">{debugTrace.toolId}</dd>
                </div>
              )}
              {debugTrace.providerUsed && (
                <div className="flex justify-between gap-2">
                  <dt className="text-white/45">Provider</dt>
                  <dd className="text-right">{debugTrace.providerUsed}</dd>
                </div>
              )}
              {debugTrace.envelopeId && (
                <div className="flex justify-between gap-2">
                  <dt className="text-white/45">Envelope ID</dt>
                  <dd className="text-right break-all">{debugTrace.envelopeId}</dd>
                </div>
              )}
              {debugTrace.dataQualitySummary && (
                <div className="flex justify-between gap-2">
                  <dt className="text-white/45">Data quality</dt>
                  <dd className="text-right">{debugTrace.dataQualitySummary}</dd>
                </div>
              )}
              {debugTrace.sportsDataSource && (
                <div className="flex justify-between gap-2">
                  <dt className="text-white/45">Sports source</dt>
                  <dd className="text-right">{debugTrace.sportsDataSource}</dd>
                </div>
              )}
              {debugTrace.sportsDataState && (
                <div className="flex justify-between gap-2">
                  <dt className="text-white/45">Sports data state</dt>
                  <dd className="text-right">{debugTrace.sportsDataState}</dd>
                </div>
              )}
              {typeof debugTrace.sportsDataAvailable === 'boolean' && (
                <div className="flex justify-between gap-2">
                  <dt className="text-white/45">Sports data available</dt>
                  <dd className="text-right">{debugTrace.sportsDataAvailable ? 'Yes' : 'No'}</dd>
                </div>
              )}
              {Array.isArray(debugTrace.sportsDataKeys) && debugTrace.sportsDataKeys.length > 0 && (
                <div className="flex justify-between gap-2">
                  <dt className="text-white/45">Sports keys</dt>
                  <dd className="text-right">{debugTrace.sportsDataKeys.join(', ')}</dd>
                </div>
              )}
              {typeof debugTrace.sportsDataMissingCount === 'number' && (
                <div className="flex justify-between gap-2">
                  <dt className="text-white/45">Sports missing</dt>
                  <dd className="text-right">{debugTrace.sportsDataMissingCount}</dd>
                </div>
              )}
              {Array.isArray(debugTrace.sportsDataAttemptedSources) && debugTrace.sportsDataAttemptedSources.length > 0 && (
                <div className="flex justify-between gap-2">
                  <dt className="text-white/45">Sports providers tried</dt>
                  <dd className="text-right">{debugTrace.sportsDataAttemptedSources.join(', ')}</dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-white/45">Confidence capped</dt>
                <dd className="text-right">{debugTrace.confidenceCapped ? 'Yes' : 'No'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-white/45">Uncertainty items</dt>
                <dd className="text-right">{debugTrace.uncertaintyCount ?? 0}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-white/45">Missing-data items</dt>
                <dd className="text-right">{debugTrace.missingDataCount ?? 0}</dd>
              </div>
            </dl>
          )}
        </div>
      )}
    </div>
  )
}
