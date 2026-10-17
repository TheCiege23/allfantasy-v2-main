'use client'

import React from 'react'
import { useProviderStatus } from '@/hooks/useProviderStatus'
import { RefreshCw } from 'lucide-react'

export interface ChimmyProviderStatusProps {
  /** Override from last response meta (e.g. { openai: 'ok', grok: 'error' }) */
  lastMeta?: Record<string, string> | null
  className?: string
}

/**
 * Small provider status indicator for Chimmy shell. No secrets.
 * Uses last response meta when available, else GET /api/ai/providers/status.
 * PROMPT 156: error state shows retry so no dead control.
 */
export default function ChimmyProviderStatus({ lastMeta, className = '' }: ChimmyProviderStatusProps) {
  const { status, loading, error, refetch } = useProviderStatus()

  const display = lastMeta
    ? Object.entries(lastMeta).map(([k, v]) => ({ name: k, ok: v === 'ok' }))
    : status
      ? [
          { name: 'OpenAI', ok: status.openai },
          { name: 'DeepSeek', ok: status.deepseek },
          { name: 'Grok', ok: status.grok },
        ]
      : []

  if (error && !lastMeta) {
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        <span className="text-[11px] text-white/40">Status unavailable</span>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex p-0.5 rounded hover:bg-white/10 text-white/50 hover:text-white/70"
          aria-label="Retry provider status"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
    )
  }

  if (display.length === 0 && !loading) return null

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
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
    </div>
  )
}
