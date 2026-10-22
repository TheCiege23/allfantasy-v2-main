'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { recordSavedLeagueOverrides } from '@/lib/league-settings/savedLeagueOverrides'
import { useSettingsSaveScope } from '@/components/league-settings/home/SettingsSaveScope'

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
 * PATCH `/api/leagues/:leagueId/settings` with `{ section, updates }`.
 *
 * Two modes, chosen by where the tab is rendered:
 *  - Inside a League Settings page's <SettingsSaveScope>: edits are HELD and the page's sticky
 *    "Save changes" bar saves them (or Discard drops them). Nothing saves on its own, so every
 *    settings page saves the same way.
 *  - Anywhere else (the older settings modal): debounced autosave, as it always did.
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
  // Autosave has no Save button, so the commissioner needs a visible "it took" signal.
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<Record<string, unknown>>({})
  const seqRef = useRef(0)
  const scope = useSettingsSaveScope()
  const manual = scope != null

  const flush = useCallback(async () => {
    const updates = pendingRef.current
    pendingRef.current = {}
    if (!enabled || !leagueId || Object.keys(updates).length === 0) return true

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
        // Keep the edits so "Save changes" can be tried again (manual mode).
        if (manual) pendingRef.current = { ...updates, ...pendingRef.current }
        return false
      }
      // The modal's league comes from page props nothing refreshes; remember what was saved so a
      // reopened tab does not re-seed the old value (lib/league-settings/savedLeagueOverrides.ts).
      recordSavedLeagueOverrides(leagueId, updates)
      window.dispatchEvent(new CustomEvent('af:league-settings-saved', { detail: { leagueId } }))
      if (mySeq === seqRef.current) {
        setSavedAt(Date.now())
        onSuccessRef.current?.(data)
      }
      return true
    } catch {
      const msg = 'Network error'
      setLastError(msg)
      toast.error(msg)
      if (manual) pendingRef.current = { ...updates, ...pendingRef.current }
      return false
    } finally {
      if (mySeq === seqRef.current) setSaving(false)
      scope?.notify()
    }
  }, [enabled, leagueId, section, manual, scope])

  const queuePatch = useCallback(
    (updates: Record<string, unknown>) => {
      if (!enabled || !leagueId) return
      pendingRef.current = { ...pendingRef.current, ...updates }
      if (manual) {
        scope?.notify()
        return
      }
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void flush()
      }, DEBOUNCE_MS)
    },
    [enabled, leagueId, flush, manual, scope],
  )

  // Manual mode: register with the page's save bar.
  const flushForScope = useRef(flush)
  flushForScope.current = flush
  useEffect(() => {
    if (!scope) return
    return scope.register(`${section}:${Math.random().toString(36).slice(2)}`, {
      isDirty: () => Object.keys(pendingRef.current).length > 0,
      save: () => flushForScope.current(),
      discard: () => {
        pendingRef.current = {}
      },
    })
  }, [scope, section])

  // Unmount (tab switch, modal close) FLUSHES a pending edit instead of dropping it: on a phone the
  // last keystroke and the close tap are routinely inside the debounce window.
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => {
    return () => {
      // Manual mode never saves behind the commissioner's back; the page asks before leaving.
      if (manual) return
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
        void flushRef.current()
      }
    }
  }, [manual])

  return { queuePatch, flush: () => void flush(), saving, lastError, savedAt, manual }
}
