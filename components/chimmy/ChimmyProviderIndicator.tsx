'use client'

import React from 'react'
import { useProviderStatus } from '@/hooks/useProviderStatus'
import { GitCompare } from 'lucide-react'

export interface ChimmyProviderIndicatorProps {
  /** Override from last response meta (e.g. { openai: 'ok', grok: 'error' }) */
  lastMeta?: Record<string, string> | null
  /** When provided, shows "Compare" / "Open provider comparison" button */
  onOpenCompare?: () => void
  /** Only show compare when multiple providers responded (from parent) */
  canCompare?: boolean
  className?: string
}

/**
 * Provider status indicator for Chimmy. Shows which providers are available.
 * Optional "Open provider comparison" action — no dead buttons.
 */
export default function ChimmyProviderIndicator({
  lastMeta,
  onOpenCompare,
  canCompare = false,
  className = '',
}: ChimmyProviderIndicatorProps) {
  const { status, loading } = useProviderStatus()

  const display = lastMeta
    ? Object.entries(lastMeta).map(([k, v]) => ({ name: k, ok: v === 'ok' }))
    : status
      ? [
          { name: 'OpenAI', ok: status.openai },
          { name: 'DeepSeek', ok: status.deepseek },
          { name: 'Grok', ok: status.grok },
          { name: 'OpenClaw', ok: status.openclaw },
          { name: 'OpenClaw Growth', ok: status.openclawGrowth },
        ]
      : []

  if (display.length === 0 && !loading && !(canCompare && onOpenCompare)) return null

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {loading ? (
        <span className="text-[11px] text-white/40">Checking…</span>
      ) : (
        display.map(({ name, ok }) => (
          <span
            key={name}
            className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-emerald-500/80' : 'bg-white/20'}`}
            title={`${name}: ${ok ? 'available' : 'unavailable'}`}
            aria-hidden
          />
        ))
      )}
      {canCompare && onOpenCompare && (
        <button
          type="button"
          onClick={onOpenCompare}
          data-testid="chimmy-open-provider-compare-button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-white/70 hover:bg-white/10 hover:text-white/90 min-h-[36px]"
          aria-label="Open provider comparison"
        >
          <GitCompare className="h-3.5 w-3.5" />
          Compare
        </button>
      )}
    </div>
  )
}
