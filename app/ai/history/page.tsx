'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { LayoutGrid, ChevronLeft, Loader2, Trash2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { getChimmyChatHrefWithPrompt } from '@/lib/ai-product-layer'

/**
 * /ai/history — Saved AI results. Opens saved results; link from hub "Open saved".
 */
export default function AIHistoryPage() {
  type HistoryItem = {
    id: string
    createdAt: string
    tool: string
    sport: string
    aiMode?: string | null
    provider?: string | null
    prompt?: string | null
    stale?: boolean
    output: {
      evidence: string[]
      aiExplanation: string
      actionPlan?: string | null
      confidence?: number | null
      confidenceLabel?: 'low' | 'medium' | 'high' | null
      confidenceReason?: string | null
      uncertainty?: string | null
      usedDeterministicFallback?: boolean
    }
  }

  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/ai/history?limit=50', { cache: 'no-store' })
      const data = (await response.json().catch(() => null)) as
        | { items?: unknown; userMessage?: string; message?: string }
        | null
      if (!response.ok) {
        const message =
          data?.userMessage ??
          data?.message ??
          'Unable to load saved AI history right now.'
        setError(message)
        setItems([])
        return
      }
      const parsedItems = Array.isArray(data?.items)
        ? data.items.filter((item): item is HistoryItem => {
            if (!item || typeof item !== 'object') return false
            const candidate = item as Record<string, unknown>
            return typeof candidate.id === 'string' && typeof candidate.createdAt === 'string'
          })
        : []
      setItems(parsedItems)
    } catch {
      setError('Network error while loading AI history.')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const handleDelete = async (id: string) => {
    if (!id || deletingId) return
    setDeletingId(id)
    try {
      const response = await fetch('/api/ai/history', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = (await response.json().catch(() => null)) as
        | { userMessage?: string; message?: string }
        | null
      if (!response.ok) {
        const message =
          data?.userMessage ??
          data?.message ??
          'Unable to delete this saved AI result.'
        toast.error(message)
        return
      }
      setItems((current) => current.filter((item) => item.id !== id))
      toast.success('Saved AI result removed.')
    } catch {
      toast.error('Network error while deleting this saved AI result.')
    } finally {
      setDeletingId(null)
    }
  }

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [items]
  )

  return (
    <div className="mode-surface min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Link
          href="/ai/tools"
          className="mb-6 inline-flex items-center gap-2 text-sm text-white/60 hover:text-white/90"
          data-testid="ai-history-back-link"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to AI tools
        </Link>
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-white">Saved AI history</h1>
            <p className="text-sm text-white/50">Review, revisit, and remove previous AI analyses.</p>
          </div>
          <button
            type="button"
            onClick={() => void loadHistory()}
            data-testid="ai-history-refresh-button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] py-16 text-white/50">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading saved AI history...
          </div>
        ) : error ? (
          <div
            className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200"
            data-testid="ai-history-error-state"
          >
            <p>{error}</p>
            <button
              type="button"
              onClick={() => void loadHistory()}
              className="mt-3 inline-flex items-center rounded-lg border border-amber-400/30 bg-amber-500/15 px-3 py-1.5 text-xs hover:bg-amber-500/20"
            >
              Retry
            </button>
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] py-16 text-center">
            <LayoutGrid className="mb-4 h-12 w-12 text-white/30" aria-hidden />
            <h2 className="text-lg font-semibold text-white">No saved analyses yet</h2>
            <p className="mt-2 max-w-sm text-sm text-white/50">
              Save a result from AI Tools to see it here.
            </p>
            <Link
              href="/ai/tools"
              className="mt-6 rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
              data-testid="ai-history-open-tools-link"
            >
              Open AI tools
            </Link>
          </div>
        ) : (
          <ul className="space-y-3" data-testid="ai-history-list">
            {sortedItems.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                data-testid={`ai-history-item-${item.id}`}
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">
                      {item.tool.replace(/_/g, ' ')} · {item.sport}
                    </p>
                    <p className="text-xs text-white/45">
                      {new Date(item.createdAt).toLocaleString()}
                      {item.aiMode ? ` · ${item.aiMode}` : ''}
                      {item.provider ? ` · ${item.provider}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDelete(item.id)}
                    data-testid={`ai-history-delete-button-${item.id}`}
                    disabled={deletingId === item.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-200 hover:bg-red-500/15 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deletingId === item.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
                {item.prompt && (
                  <p className="mb-2 text-xs text-white/50">
                    Prompt: {item.prompt}
                  </p>
                )}
                <p className="text-sm text-white/85">
                  {item.output.aiExplanation}
                </p>
                {Array.isArray(item.output.evidence) && item.output.evidence.length > 0 && (
                  <ul className="mt-2 list-disc list-inside text-xs text-white/60">
                    {item.output.evidence.slice(0, 3).map((evidence, index) => (
                      <li key={`${item.id}-evidence-${index}`}>{evidence}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {typeof item.output.confidence === 'number' && (
                    <span className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-white/70">
                      Confidence {item.output.confidence}%
                    </span>
                  )}
                  {item.output.usedDeterministicFallback && (
                    <span className="rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-amber-200/90">
                      Deterministic fallback
                    </span>
                  )}
                  {item.stale && (
                    <span className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-white/55">
                      Legacy saved format
                    </span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href="/ai/tools"
                    className="rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                  >
                    Open AI tools
                  </Link>
                  <Link
                    href={getChimmyChatHrefWithPrompt(item.output.aiExplanation)}
                    className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20"
                  >
                    Open in Chimmy
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
