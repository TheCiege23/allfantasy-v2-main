'use client'

import { useCallback, useState } from 'react'
import { DraftShareCard, DRAFT_SHARE_CARD_ID } from './DraftShareCard'
import { DraftShareBar } from './DraftShareBar'
import type { DraftShareCardPayload, DraftShareVariant } from '@/lib/draft-sharing/types'

interface DraftShareModalProps {
  leagueId: string
  season: string
  /** Roster options for "Share my grade" (rosterId, optional name) */
  rosterOptions?: { rosterId: string; name?: string; grade?: string }[]
  onClose: () => void
  className?: string
}

export function DraftShareModal({
  leagueId,
  season,
  rosterOptions = [],
  onClose,
  className = '',
}: DraftShareModalProps) {
  const [step, setStep] = useState<'choose' | 'sharing'>('choose')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState('')
  const [payload, setPayload] = useState<DraftShareCardPayload | null>(null)
  const [, setVariant] = useState<DraftShareVariant>('draft_rankings')
  const [selectedRosterId, setSelectedRosterId] = useState<string | null>(null)

  const createShare = useCallback(
    async (v: DraftShareVariant, rosterId?: string | null) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/share/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leagueId,
            season,
            variant: v,
            ...(v === 'draft_grade' && rosterId ? { rosterId } : {}),
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data.error || 'Failed to create share')
          return
        }
        setShareUrl(data.shareUrl || '')
        setPayload(data.payload || null)
        setVariant(v)
        setStep('sharing')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong')
      } finally {
        setLoading(false)
      }
    },
    [leagueId, season]
  )

  if (step === 'sharing' && payload) {
    return (
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 ${className}`}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="bg-zinc-900 rounded-2xl border border-zinc-700 p-6 max-w-full overflow-auto">
          <div className="flex justify-end mb-2">
            <button
              type="button"
              onClick={onClose}
              className="text-zinc-400 hover:text-white text-sm"
            >
              Close
            </button>
          </div>
          <div className="flex flex-col items-center gap-4">
            <DraftShareCard payload={payload} captureId={DRAFT_SHARE_CARD_ID} />
            <DraftShareBar payload={payload} shareUrl={shareUrl} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 ${className}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-zinc-900 rounded-2xl border border-zinc-700 p-6 max-w-sm w-full">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-white">Share draft results</h3>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white">
            ×
          </button>
        </div>
        <p className="text-sm text-zinc-400 mb-4">
          Create an image + link to share on X, Reddit, Discord, or Instagram.
        </p>
        {error && (
          <p className="text-sm text-red-400 mb-3">{error}</p>
        )}
        <div className="space-y-3">
          <button
            type="button"
            disabled={loading}
            onClick={() => createShare('draft_rankings')}
            className="w-full rounded-xl bg-amber-600 text-white px-4 py-2.5 font-medium hover:bg-amber-500 disabled:opacity-60"
          >
            {loading ? 'Creating…' : 'Share team rankings'}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => createShare('draft_winner')}
            className="w-full rounded-xl bg-zinc-700 text-white px-4 py-2.5 font-medium hover:bg-zinc-600 disabled:opacity-60"
          >
            Share winner of draft
          </button>
          {rosterOptions.length > 0 && (
            <div className="pt-2 border-t border-zinc-700">
              <label className="block text-xs text-zinc-500 mb-1">Share one team&apos;s grade</label>
              <select
                className="w-full rounded-lg bg-zinc-800 border border-zinc-600 text-white px-3 py-2 text-sm"
                value={selectedRosterId ?? ''}
                onChange={(e) => setSelectedRosterId(e.target.value || null)}
              >
                <option value="">Select roster</option>
                {rosterOptions.map((r) => (
                  <option key={r.rosterId} value={r.rosterId}>
                    {r.name ?? `Roster ${r.rosterId}`} {r.grade != null ? `(${r.grade})` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={loading || !selectedRosterId}
                onClick={() => createShare('draft_grade', selectedRosterId ?? undefined)}
                className="w-full mt-2 rounded-xl bg-zinc-700 text-white px-4 py-2.5 font-medium hover:bg-zinc-600 disabled:opacity-60"
              >
                Share this grade
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
