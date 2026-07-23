'use client'

import { useCallback, useRef, useState } from 'react'
import type { WriteAuthorityEnvelope } from '@/lib/league/write-authority'

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function useAutosave(leagueId: string) {
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
        const res = await fetch('/api/league/settings', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leagueId, ...partial }),
        })
        if (!res.ok) {
          setStatus('error')
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
