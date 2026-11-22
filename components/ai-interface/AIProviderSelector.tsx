'use client'

import React from 'react'
import { useProviderStatus } from '@/hooks/useProviderStatus'
import { RefreshCw } from 'lucide-react'

interface AIProviderSelectorProps {
  /** When true, show which providers are available (for compare view or status). No secrets. */
  showStatus?: boolean
  /** Optional: trigger compare view when user wants to see per-provider output. */
  onCompareClick?: () => void
  /** Only show compare button when multiple providers responded (from parent). */
  canCompare?: boolean
  className?: string
}

/**
 * Displays provider availability from GET /api/ai/providers/status.
 * Use to hide provider selector when only one provider; show "Compare" when canCompare and multiple responded.
 * PROMPT 156: loading and error states shown so no dead provider buttons; retry on error.
 */
export default function AIProviderSelector({
  showStatus = true,
  onCompareClick,
  canCompare = false,
  className = '',
}: AIProviderSelectorProps) {
  const { status, loading, error, refetch, availableCount } = useProviderStatus()

  if (!showStatus) return null

  if (loading) {
    return (
      <div className={`flex flex-wrap items-center gap-2 ${className}`}>
        <span className="text-xs font-medium text-white/50">Providers</span>
        <span className="text-xs text-white/40">Loading…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`flex flex-wrap items-center gap-2 ${className}`}>
        <span className="text-xs font-medium text-white/50">Providers</span>
        <span className="text-xs text-amber-400/90">Unable to load</span>
        <button
          type="button"
          onClick={() => refetch()}
          data-testid="ai-provider-status-retry-button"
          className="min-h-[28px] inline-flex items-center gap-1 rounded border border-white/20 bg-white/5 px-2 text-xs text-white/70 hover:bg-white/10"
          aria-label="Retry loading provider status"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    )
  }

  if (!status) return null

  const labels: string[] = []
  if (status.openai) labels.push('OpenAI')
  if (status.deepseek) labels.push('DeepSeek')
  if (status.grok) labels.push('Grok')
  if (status.openclaw) labels.push('OpenClaw')
  if (status.openclawGrowth) labels.push('OpenClaw Growth')

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="text-xs font-medium text-white/50">Providers</span>
      <span className="text-xs text-white/60">
        {labels.length ? labels.join(', ') : 'None configured'}
      </span>
      {availableCount > 1 && canCompare && onCompareClick && (
        <button
          type="button"
          onClick={onCompareClick}
          data-testid="ai-provider-compare-button"
          className="min-h-[36px] rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10"
        >
          Compare
        </button>
      )}
    </div>
  )
}
