'use client'

/**
 * Share bar for AI Insight Cards: download image + share to X, Instagram, Discord, Reddit.
 * Uses useAICardCapture for image; builds intent URLs and copyable captions per platform.
 */

import { type AICardShareChannel } from '@/lib/ai-insight-cards/shareUrls'
import type { AICardPayload } from '@/lib/ai-insight-cards/types'

export interface AICardShareBarProps {
  /** Card payload (used to build captions and share text) */
  payload: AICardPayload
  /** Optional share URL (e.g. /share/xxx) */
  shareUrl?: string
  /** Optional hashtags */
  hashtags?: string[]
  /** Called when user requests download */
  onDownload?: () => void
  /** Called when user copies caption */
  onCopy?: (channel: AICardShareChannel) => void
  className?: string
}

