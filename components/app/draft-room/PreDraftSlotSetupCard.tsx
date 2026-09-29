/**
 * Pre-Draft Setup Card (Slice 4.5).
 *
 * Commissioner-only read of draft slotOrder: counts how many slots still
 * reference `placeholder-*` / synthetic ids, and offers a single button to
 * materialize the remaining slots into real AI-managed Roster rows via
 * POST /api/leagues/[leagueId]/setup/materialize-slots.
 *
 * Caller is responsible for rendering this only when the viewer is a
 * commissioner.
 */

'use client'

import React, { useMemo, useState } from 'react'

import type { DraftSessionSnapshot, SlotOrderEntry } from '@/lib/live-draft-engine/types'

export interface PreDraftSlotSetupCardProps {
  leagueId: string
  session: DraftSessionSnapshot | null
  /** Called with the server's updated slotOrder so the caller can merge it back into local state. */
  onSlotOrderUpdated?: (nextSlotOrder: SlotOrderEntry[]) => void
  className?: string
}

interface MaterializeResponse {
  ok: boolean
  createdCount?: number
  replacedCount?: number
  alreadyMaterializedCount?: number
  slotOrder?: SlotOrderEntry[]
  error?: string
}

function isPlaceholder(rosterId: string): boolean {
  return typeof rosterId === 'string' && rosterId.startsWith('placeholder-')
}

export function PreDraftSlotSetupCard(props: PreDraftSlotSetupCardProps) {
  const { leagueId, session, onSlotOrderUpdated, className } = props
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const slotOrder: SlotOrderEntry[] = session?.slotOrder ?? []
  const totalSlots = slotOrder.length
  const placeholderCount = useMemo(
    () => slotOrder.filter((entry) => isPlaceholder(entry.rosterId)).length,
    [slotOrder],
  )
  const realSlotCount = totalSlots - placeholderCount

  async function handleFill() {
    setSubmitting(true)
    setSuccess(null)
    setError(null)
    try {
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/setup/materialize-slots`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store' },
      )
      let body: MaterializeResponse = { ok: false }
      try {
        body = (await res.json()) as MaterializeResponse
      } catch {
        /* ignore */
      }
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `Request failed (${res.status})`)
      }
      if (Array.isArray(body.slotOrder)) onSlotOrderUpdated?.(body.slotOrder)
      const created = body.createdCount ?? 0
      if (created > 0) {
        setSuccess(
          `Draft slots are ready. ${created} placeholder team${
            created === 1 ? ' was' : 's were'
          } replaced with real rosters.`,
        )
      } else {
        setSuccess('All draft slots were already materialized. Nothing to do.')
      }
    } catch (err) {
      setError((err as Error).message ?? 'Failed to materialize slots')
    } finally {
      setSubmitting(false)
    }
  }

  const allReady = totalSlots > 0 && placeholderCount === 0

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border p-3 text-sm ${
        allReady
          ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
          : 'border-amber-400/35 bg-amber-500/10 text-amber-100'
      } ${className ?? ''}`}
      data-testid="predraft-slot-setup-card"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em]">
          Pre-Draft Setup
        </h3>
        <span
          className="rounded border border-white/15 px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] text-white/70"
          data-testid="predraft-slot-counts"
        >
          {realSlotCount}/{totalSlots} real · {placeholderCount} placeholder
        </span>
      </header>

      {allReady ? (
        <p className="text-[12px]" data-testid="predraft-slot-ready">
          All draft slots are backed by real rosters. You're good to draft.
        </p>
      ) : (
        <>
          <p className="text-[12px] text-white/80">
            {placeholderCount} draft slot{placeholderCount === 1 ? '' : 's'} still point to
            placeholder teams. Fill them with AI-managed rosters before the draft starts so
            picks, edits, and post-draft assignment land on real teams.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="predraft-slot-fill-button"
              disabled={submitting || totalSlots === 0}
              onClick={handleFill}
              className="rounded border border-amber-300/45 bg-amber-500/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-50 hover:bg-amber-500/30 disabled:opacity-50"
            >
              {submitting ? 'Filling…' : 'Fill empty slots with AI managers'}
            </button>
          </div>
        </>
      )}

      {success ? (
        <div
          role="status"
          data-testid="predraft-slot-success"
          className="rounded border border-emerald-400/35 bg-emerald-500/10 p-2 text-[12px] text-emerald-100"
        >
          {success}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          data-testid="predraft-slot-error"
          className="rounded border border-rose-400/35 bg-rose-500/10 p-2 text-[12px] text-rose-100"
        >
          {error}
        </div>
      ) : null}
    </div>
  )
}

export default PreDraftSlotSetupCard
