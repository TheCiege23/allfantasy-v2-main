/**
 * Unified AI Interface — reusable frontend components for AI hub, result cards, and Chimmy shell.
 */

export { default as AILayoutContainer } from './AILayoutContainer'

export { default as AIModeSelector } from './AIModeSelector'
export type { AIMode } from './AIModeSelector'

export { default as AIProviderSelector } from './AIProviderSelector'

export { default as DeterministicEvidenceCard } from './DeterministicEvidenceCard'

export { default as AIVerdictCard } from './AIVerdictCard'

export { default as ActionPlanCard } from './ActionPlanCard'

export { default as ConfidenceDisplay } from './ConfidenceDisplay'
export type { ConfidenceLabel } from './ConfidenceDisplay'

export { default as AIErrorFallback } from './AIErrorFallback'

export { default as AILoadingSkeleton } from './AILoadingSkeleton'

export { default as CompareProvidersView } from './CompareProvidersView'

export { default as UnifiedBrainResultView } from './UnifiedBrainResultView'

export { default as AIResultCard } from './AIResultCard'

export { default as StickyAIActions } from './StickyAIActions'

/** PROMPT 127 — Deterministic evidence layer components (re-exports from ai-evidence). */
export {
  EvidenceCard,
  ConfidenceMeter,
  UncertaintyNotice,
  MissingDataNotice,
  AIEvidencePresentation,
} from '@/components/ai-evidence'
