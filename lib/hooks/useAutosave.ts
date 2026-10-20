'use client'

import { useCallback, useRef, useState } from 'react'
import type { WriteAuthorityEnvelope } from '@/lib/league/write-authority'
import { fetchWithMidSeasonConfirmation } from '@/lib/league/midSeasonConfirmation'

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export type AutosaveOptions = {
  /**
   * Asked when the server answers 409 `mid_season_confirmation_required` (a scoring or roster key
   * changed after the season started). Yes re-sends with `confirmMidSeasonChange: true`; no leaves
   * the change unsaved. Without it such a save simply reports `error`.
   */
  confirmMidSeason?: (message: string) => Promise<boolean>
}

export function useAutosave(leagueId: string, options?: AutosaveOptions) {
  const confirmRef = useRef(options?.confirmMidSeason)
  confirmRef.current = options?.confirmMidSeason
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  /**
   * Write Authority reported by the last successful PATCH. On an imported (SHADOW) league the
   * commissioner just changed AllFantasy's twin — the real ESPN/Yahoo/Sleeper league settings
   * are untouched — so consumers render "Shadow rules updated" instead of a bare "Saved".
   */
  const [writeAuthority, setWriteAuthority] = useState<WriteAuthorityEnvelope | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const save = useCallback(
    async (partial: Record<string, unknown>) => {
      setStatus('saving')
      try {
        const init: RequestInit = {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leagueId, ...partial }),
        }
        const confirm = confirmRef.current
        const res = confirm
          ? await fetchWithMidSeasonConfirmation('/api/league/settings', init, confirm)
          : await fetch('/api/league/settings', init)
        if (!res.ok) {
          const failed = (await res.clone().json().catch(() => null)) as { cancelled?: boolean } | null
          setStatus(failed?.cancelled ? 'idle' : 'error')
          return
        }
        const saved = (await res.json().catch(() => ({}))) as {
          writeAuthority?: WriteAuthorityEnvelope
        }
        setWriteAuthority(saved.writeAuthority ?? null)
        setStatus('saved')
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('af-league-settings-saved', { detail: { leagueId } }),
          )
        }
        setTimeout(() => setStatus('idle'), 1500)
      } catch {
        setStatus('error')
      }
    },
    [leagueId],
  )

  const debouncedSave = useCallback(
    (partial: Record<string, unknown>, delayMs = 450) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        void save(partial)
      }, delayMs)
    },
    [save],
  )

  /** Status-line text for the last save; shadow-aware, so it never implies the host changed. */
  const savedLabel = writeAuthority?.shadow ? (writeAuthority.copy?.title ?? 'Shadow rules updated') : 'Saved'

  return { status, save, debouncedSave, writeAuthority, savedLabel }
}
