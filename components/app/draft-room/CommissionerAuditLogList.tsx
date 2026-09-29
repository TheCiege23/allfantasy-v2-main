/**
 * Commissioner audit log list (Slice 4).
 *
 * Read-only view of DraftPickAuditLog entries for the current league. Shows
 * who changed what, when, and why. Caller (DraftRoomPageClient) is responsible
 * for rendering this only for commissioners.
 *
 * Filters: action + optional date range.
 * Pagination: cursor-based; "Load more" button appends the next page.
 * Refresh: button re-fetches from the top.
 */

'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  fetchCommissionerAuditLog,
  type CommissionerAuditLogRow,
} from '@/lib/live-draft-engine/commissioner/clientCommissionerAuditLog'
import type { CommissionerPickEditAction } from '@/lib/live-draft-engine/commissioner/commissionerPickEditService'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'

export interface CommissionerAuditLogListProps {
  leagueId: string
  /** Used to resolve rosterId → displayName in the list rows. Safe if empty. */
  slotOrder?: SlotOrderEntry[]
  /** Monotonic token: bump this (e.g. session version) after a successful edit
   *  to auto-refresh the list. Optional. */
  refreshKey?: number
  className?: string
}

const ACTION_LABEL: Record<CommissionerPickEditAction, string> = {
  REMOVE_PLAYER_FROM_PICK: 'Removed player',
  REPLACE_PLAYER_ON_PICK: 'Replaced player',
  ASSIGN_PLAYER_TO_PICK: 'Assigned player',
  CHANGE_PICK_OWNER: 'Changed pick owner',
}

const ACTION_FILTER_OPTIONS: Array<{ value: '' | CommissionerPickEditAction; label: string }> = [
  { value: '', label: 'All actions' },
  { value: 'REMOVE_PLAYER_FROM_PICK', label: 'Remove player' },
  { value: 'REPLACE_PLAYER_ON_PICK', label: 'Replace player' },
  { value: 'ASSIGN_PLAYER_TO_PICK', label: 'Assign player' },
  { value: 'CHANGE_PICK_OWNER', label: 'Change pick owner' },
]

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return iso
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function rosterLabel(slotOrder: SlotOrderEntry[] | undefined, rosterId: string | null): string {
  if (!rosterId) return '—'
  const hit = slotOrder?.find((e) => e.rosterId === rosterId)
  return hit?.displayName ?? rosterId
}

function describeRow(
  row: CommissionerAuditLogRow,
  slotOrder: SlotOrderEntry[] | undefined,
): { title: string; detail: string } {
  const title = `${ACTION_LABEL[row.action]} · pick #${row.overallPickNumber} (R${row.round})`
  switch (row.action) {
    case 'REMOVE_PLAYER_FROM_PICK':
      return {
        title,
        detail: `Cleared ${row.oldPlayerName ?? 'player'} from ${rosterLabel(slotOrder, row.oldRosterId)}.`,
      }
    case 'REPLACE_PLAYER_ON_PICK':
      return {
        title,
        detail: `${row.oldPlayerName ?? 'previous'} → ${row.newPlayerName ?? 'new'} on ${rosterLabel(slotOrder, row.newRosterId)}.`,
      }
    case 'ASSIGN_PLAYER_TO_PICK':
      return {
        title,
        detail: `${row.newPlayerName ?? 'player'} → ${rosterLabel(slotOrder, row.newRosterId)}.`,
      }
    case 'CHANGE_PICK_OWNER':
      return {
        title,
        detail: `${rosterLabel(slotOrder, row.oldRosterId)} → ${rosterLabel(slotOrder, row.newRosterId)}.`,
      }
    default:
      return { title, detail: '' }
  }
}

export function CommissionerAuditLogList(props: CommissionerAuditLogListProps) {
  const { leagueId, slotOrder, refreshKey, className } = props
  const [rows, setRows] = useState<CommissionerAuditLogRow[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionFilter, setActionFilter] = useState<'' | CommissionerPickEditAction>('')
  const abortRef = useRef<AbortController | null>(null)

  const loadFirstPage = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    try {
      const page = await fetchCommissionerAuditLog({
        leagueId,
        limit: 25,
        action: actionFilter || null,
        signal: controller.signal,
      })
      setRows(page.items)
      setNextCursor(page.nextCursor)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError((err as Error).message ?? 'Failed to load audit log')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [leagueId, actionFilter])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loading) return
    setLoading(true)
    setError(null)
    try {
      const page = await fetchCommissionerAuditLog({
        leagueId,
        limit: 25,
        cursor: nextCursor,
        action: actionFilter || null,
      })
      setRows((prev) => [...prev, ...page.items])
      setNextCursor(page.nextCursor)
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load more')
    } finally {
      setLoading(false)
    }
  }, [nextCursor, loading, leagueId, actionFilter])

  useEffect(() => {
    void loadFirstPage()
    return () => abortRef.current?.abort()
  }, [loadFirstPage, refreshKey])

  const body = useMemo(() => {
    if (loading && rows.length === 0) {
      return <p className="py-3 text-center text-[11px] text-white/55">Loading audit log…</p>
    }
    if (rows.length === 0) {
      return <p className="py-3 text-center text-[11px] text-white/55">No audit entries yet.</p>
    }
    return (
      <ul className="flex flex-col gap-1.5" data-testid="commish-audit-list">
        {rows.map((row) => {
          const { title, detail } = describeRow(row, slotOrder)
          return (
            <li
              key={row.id}
              data-testid={`commish-audit-row-${row.id}`}
              className="rounded border border-white/10 bg-black/30 p-2 text-[11px] text-white/80"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold text-amber-100/95">{title}</span>
                <span className="shrink-0 text-[11px] text-white/50">{formatWhen(row.createdAt)}</span>
              </div>
              {detail ? <p className="mt-0.5 text-white/70">{detail}</p> : null}
              {row.reason ? (
                <p className="mt-0.5 italic text-white/55" title={row.reason}>
                  “{row.reason}”
                </p>
              ) : null}
              <p className="mt-0.5 text-[11px] text-white/35">by {row.actorUserId.slice(0, 8)}…</p>
            </li>
          )
        })}
      </ul>
    )
  }, [loading, rows, slotOrder])

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/85 ${className ?? ''}`}
      data-testid="commish-audit-panel"
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-100/90">
          Recent commissioner edits
        </h3>
        <button
          type="button"
          onClick={() => void loadFirstPage()}
          disabled={loading}
          data-testid="commish-audit-refresh"
          className="rounded border border-white/15 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-white/65 hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <div className="flex items-center gap-2">
        <label className="text-[11px] uppercase tracking-[0.12em] text-white/55">Filter:</label>
        <select
          data-testid="commish-audit-filter"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value as '' | CommissionerPickEditAction)}
          className="rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white"
        >
          {ACTION_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value || 'all'} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div
          role="alert"
          data-testid="commish-audit-error"
          className="rounded border border-rose-400/35 bg-rose-500/10 p-2 text-[11px] text-rose-100"
        >
          {error}
        </div>
      ) : null}

      {body}

      {nextCursor ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loading}
          data-testid="commish-audit-load-more"
          className="self-center rounded border border-white/15 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-white/75 hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </div>
  )
}

export default CommissionerAuditLogList
