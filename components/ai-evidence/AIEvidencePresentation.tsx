'use client'

import React from 'react'
import type { NormalizedToolOutput } from '@/lib/ai-context-envelope'
import EvidenceCard from './EvidenceCard'
import ConfidenceMeter from './ConfidenceMeter'
import UncertaintyNotice from './UncertaintyNotice'
import MissingDataNotice from './MissingDataNotice'
import CaveatsBlock from './CaveatsBlock'

interface AIEvidencePresentationProps {
  /** Normalized tool output (evidence, uncertainty, missingData, caveats, confidence). */
  output: NormalizedToolOutput
  /** Show confidence (default true). Confidence is always displayed when true. */
  showConfidence?: boolean
  /** Optional tool id for evidence list id. */
  toolId?: string
  className?: string
}

/**
 * Renders full evidence presentation. MANDATORY: Evidence visible before AI explanation; confidence always displayed.
 * Order: Evidence → Confidence → Uncertainty → Missing data → Caveats.
 * No AI-invented metrics; uncertainty shown when data missing.
 */
export default function AIEvidencePresentation({
  output,
  showConfidence = true,
  toolId,
  className = '',
}: AIEvidencePresentationProps) {
  const hasEvidence = output.evidence && output.evidence.length > 0
  const hasUncertainty = output.uncertainty && output.uncertainty.length > 0
  const hasMissing = output.missingData && output.missingData.length > 0
  const hasCaveats = output.caveats && output.caveats.length > 0

  if (!hasEvidence && !hasUncertainty && !hasMissing && !hasCaveats && !showConfidence) return null

  return (
    <div className={`space-y-3 ${className}`}>
      {/* 1. Evidence first — before AI explanation */}
      {hasEvidence && (
        <EvidenceCard
          items={output.evidence!}
          title="What the data says"
          defaultExpanded={true}
          toolId={toolId}
        />
      )}

      {/* 2. Confidence always displayed */}
      {showConfidence && (
        <ConfidenceMeter
          confidence={output.confidence ?? undefined}
          scorePct={output.confidence?.scorePct ?? undefined}
          label={output.confidence?.label}
          reason={output.confidence?.reason}
          cappedByData={output.confidence?.cappedByData}
          capReason={output.confidence?.capReason}
          size="md"
        />
      )}

      {/* 3. Uncertainty when data incomplete */}
      {hasUncertainty && (
        <UncertaintyNotice
          items={output.uncertainty!}
          defaultExpanded={output.confidence?.cappedByData}
        />
      )}

      {/* 4. Missing data — never silently ignored */}
      {hasMissing && (
        <MissingDataNotice
          items={output.missingData!}
          defaultExpanded={output.confidence?.cappedByData}
        />
      )}

      {hasCaveats && <CaveatsBlock caveats={output.caveats!} defaultExpanded={true} />}
    </div>
  )
}
