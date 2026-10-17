'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { recordSavedLeagueOverrides } from '@/lib/league-settings/savedLeagueOverrides'

export type LeagueSettingsSectionId =
  | 'general'
  | 'scoring'
  | 'roster'
  | 'draft'
  | 'waivers'
  | 'trades'
  | 'playoffs'
  | 'commissioner'
  | 'conceptRules'
  | 'ai'

const DEBOUNCE_MS = 420

/**
 * Debounced PATCH to `/api/leagues/:leagueId/settings` with `{ section, updates }`.
 * Optimistic: no local rollback of arbitrary league shape — refetch via `onSuccess` or parent GET.
 */
export function useLeagueSettingsSectionAutosave(
  leagueId: string | undefined,
  section: LeagueSettingsSectionId,
  options?: {
    enabled?: boolean
    onSuccess?: (data: unknown) => void
  },
) {
  const enabled = options?.enabled !== false && Boolean(leagueId)
  const onSuccessRef = useRef(options?.onSuccess)
  onSuccessRef.current = options?.onSuccess

  const [saving, setSaving] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<Record<string, unknown>>({})
  const seqRef = useRef(0)

  const flush = useCallback(async () => {
    const updates = pendingRef.current
    pendingRef.current = {}
    if (!enabled || !leagueId || Object.keys(updates).length === 0) return

    const mySeq = ++seqRef.current
    setSaving(true)
    setLastError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ section, updates }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = typeof data?.error === 'string' ? data.error : 'Save failed'
        setLastError(msg)
        toast.error(msg)
        return
      }
      // The modal's league comes from page props nothing refreshes; remember what was saved so a
      // reopened tab does not re-seed the old value (lib/league-settings/savedLeagueOverrides.ts).
      recordSavedLeagueOverrides(leagueId, updates)
      if (mySeq === seqRef.current) {
        onSuccessRef.current?.(data)
      }
    } catch {
      const msg = 'Network error'
      setLastError(msg)
      toast.error(msg)
    } finally {
      if (mySeq === seqRef.current) setSaving(false)
    }
  }, [enabled, leagueId, section])

  const queuePatch = useCallback(
    (updates: Record<string, unknown>) => {
      if (!enabled || !leagueId) return
      pendingRef.current = { ...pendingRef.current, ...updates }
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void flush()
      }, DEBOUNCE_MS)
    },
    [enabled, leagueId, flush],
  )

  // Unmount (tab switch, modal close) FLUSHES a pending edit instead of dropping it: on a phone the
  // last keystroke and the close tap are routinely inside the debounce window.
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
        void flushRef.current()
      }
    }
  }, [])

  return { queuePatch, flush: () => void flush(), saving, lastError }
}
