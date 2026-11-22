'use client'

import React from 'react'
import type { MissingDataItem } from '@/lib/ai-context-envelope'
import MissingDataBlock from './MissingDataBlock'

interface MissingDataNoticeProps {
  /** Missing data items — never silently ignored. */
  items: MissingDataItem[]
  title?: string
  defaultExpanded?: boolean
  className?: string
}

/**
 * Missing data notice — surface when deterministic data is missing.
 * AI must not invent; show uncertainty warning and what is missing.
 */
export default function MissingDataNotice({
  items,
  title = 'Missing data',
  defaultExpanded,
  className = '',
}: MissingDataNoticeProps) {
  return (
    <MissingDataBlock
      items={items}
      title={title}
      defaultExpanded={defaultExpanded}
      className={className}
    />
  )
}
