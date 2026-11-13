'use client'

import React from 'react'
import type { UncertaintyItem } from '@/lib/ai-context-envelope'
import UncertaintyBlock from './UncertaintyBlock'

interface UncertaintyNoticeProps {
  /** Uncertainty items — show when deterministic data is incomplete. */
  items: UncertaintyItem[]
  title?: string
  defaultExpanded?: boolean
  className?: string
}

/**
 * Uncertainty notice — shown when confidence is limited or data incomplete.
 * AI must not invent missing metrics; this surfaces what is uncertain.
 */
export default function UncertaintyNotice({
  items,
  title = 'Uncertainty',
  defaultExpanded,
  className = '',
}: UncertaintyNoticeProps) {
  return (
    <UncertaintyBlock
      items={items}
      title={title}
      defaultExpanded={defaultExpanded}
      className={className}
    />
  )
}
