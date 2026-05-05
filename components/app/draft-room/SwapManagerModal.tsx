'use client'

/**
 * Slice 5 — Commissioner-only "Swap managers" modal.
 * Touches slot ownership only; past picks remain with their original roster.
 * Effect is forward-only (next pick + onward).
 */

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'

type SlotEntry = { slot: number; rosterId: string; displayName: string }

type SettingsResponse = {
  commissionerAiDraft?: {
    slotOrder?: SlotEntry[]
  } | null
  variantSettings?: {
    sessionStatus?: string | null
  }
}

export type SwapManagerModalProps = {
  leagueId: string
  onClose: () => void
  onAction: (
    action: string,
    payload?: Record<string, unknown>,
  ) => Promise<unknown>
}

export function SwapManagerModal({ leagueId, onClose, onAction }: SwapManagerModalProps) {
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [slotOrder, setSlotOrder] = useState<SlotEntry[]>([])
  const [fromSlot, setFromSlot] = useState<number | null>(null)
  const [toSlot, setToSlot] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/leagues/${leagueId}/draft/settings`, { credentials: 'same-origin' })
        if (!res.ok) throw new Error(`Failed to load slot order (${res.status})`)
        const data = (await res.json()) as SettingsResponse
        const raw = data.commissionerAiDraft?.slotOrder ?? []
        const sorted = [...raw].sort((a, b) => a.slot - b.slot)
        if (!cancelled) {
          setSlotOrder(sorted)
          if (sorted.length >= 2) {
            setFromSlot(sorted[0].slot)
            setToSlot(sorted[1].slot)
          }
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId])

  const fromEntry = useMemo(
    () => slotOrder.find((s) => s.slot === fromSlot) ?? null,
    [slotOrder, fromSlot],
  )
  const toEntry = useMemo(
    () => slotOrder.find((s) => s.slot === toSlot) ?? null,
    [slotOrder, toSlot],
  )
  const sameSlot = fromSlot != null && toSlot != null && fromSlot === toSlot

  const handleSwap = async () => {
    if (fromSlot == null || toSlot == null) {
      setError('Pick two slots to swap.')
      return
    }
    if (fromSlot === toSlot) {
      setError('From and To must be different slots.')
      return
    }
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      const result = (await onAction('swap_manager', { fromSlot, toSlot })) as
        | { ok?: boolean; error?: string; code?: string }
        | undefined
      if (result && result.ok === false) {
        setError(result.error ?? 'Swap failed')
        return
      }
      setSuccess(
        `Swapped slot ${fromSlot} (${fromEntry?.displayName ?? '?'}) ↔ slot ${toSlot} (${toEntry?.displayName ?? '?'}).`,
      )
    } catch (err) {
      setError((err as Error).message ?? 'Swap failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      data-testid="swap-manager-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Swap managers"
    >
      <div className="relative w-full max-w-md rounded-2xl bg-zinc-900 p-6 text-zinc-100 shadow-xl">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          data-testid="swap-manager-close"
        >
          <X size={18} />
        </button>
        <h2 className="mb-1 text-xl font-semibold">Swap managers</h2>
        <p className="mb-4 text-xs text-zinc-400">
          Past picks stay with their original roster. Only future control of each slot is swapped.
          The draft is not paused and the timer is not reset.
        </p>

        {loading ? (
          <div className="py-8 text-center text-zinc-400">Loading…</div>
        ) : (
          <div className="space-y-3">
            {error ? (
              <div className="rounded-md border border-red-700 bg-red-950/40 p-3 text-sm text-red-200" role="alert">
                {error}
              </div>
            ) : null}
            {success ? (
              <div className="rounded-md border border-emerald-700 bg-emerald-950/40 p-3 text-sm text-emerald-200">
                {success}
              </div>
            ) : null}

            <label className="block text-xs font-medium text-zinc-400" htmlFor="swap-from-slot">
              From slot
            </label>
            <select
              id="swap-from-slot"
              data-testid="swap-manager-from-slot"
              value={fromSlot ?? ''}
              onChange={(e) => setFromSlot(Number(e.target.value))}
              disabled={submitting}
              className="w-full rounded-md border border-zinc-700 bg-black/30 p-2 text-sm"
            >
              {slotOrder.map((entry) => (
                <option key={entry.slot} value={entry.slot}>
                  Slot {entry.slot} — {entry.displayName}
                </option>
              ))}
            </select>

            <label className="block text-xs font-medium text-zinc-400" htmlFor="swap-to-slot">
              To slot
            </label>
            <select
              id="swap-to-slot"
              data-testid="swap-manager-to-slot"
              value={toSlot ?? ''}
              onChange={(e) => setToSlot(Number(e.target.value))}
              disabled={submitting}
              className="w-full rounded-md border border-zinc-700 bg-black/30 p-2 text-sm"
            >
              {slotOrder.map((entry) => (
                <option key={entry.slot} value={entry.slot}>
                  Slot {entry.slot} — {entry.displayName}
                </option>
              ))}
            </select>

            {sameSlot ? (
              <p className="text-xs text-amber-300">From and To must be different slots.</p>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
                data-testid="swap-manager-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSwap}
                disabled={submitting || sameSlot || slotOrder.length < 2}
                className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
                data-testid="swap-manager-confirm"
              >
                {submitting ? 'Swapping…' : 'Swap'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default SwapManagerModal
