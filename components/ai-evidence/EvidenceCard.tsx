'use client'

import React from 'react'
import type { EvidenceItem } from '@/lib/ai-context-envelope'
import EvidenceBlock from './EvidenceBlock'

interface EvidenceCardProps {
  /** Evidence items from deterministic layer only. Renders before AI explanation. */
  items: EvidenceItem[]
  /** Optional title (default: "What the data says"). */
  title?: string
  /** Default expanded. */
  defaultExpanded?: boolean
  toolId?: string
  className?: string
}

/**
 * Evidence card — deterministic facts only. Show before AI explanation.
 * No AI-invented metrics. Supported sports: NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */
export default function EvidenceCard({
  items,
  title = 'What the data says',
  defaultExpanded = true,
  toolId,
  className = '',
}: EvidenceCardProps) {
  return (
    <EvidenceBlock
      items={items}
      title={title}
      defaultExpanded={defaultExpanded}
      toolId={toolId}
      className={className}
    />
  )
}
