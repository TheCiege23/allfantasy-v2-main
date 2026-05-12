'use client'

import { useCallback } from 'react'
import type { MutableRefObject } from 'react'
import type { DraftSessionSnapshot } from '@/lib/live-draft-engine/types'
import { mergeDraftSessionSnapshot } from '@/lib/draft-room/mergeDraftSessionSnapshot'

export type CommissionerControlApiResult =
  | ({ ok: true } & Record<string, unknown>)
  | { ok: false; error: string; cancelled?: boolean }

type GovernanceBanner = {
  variant: 'success' | 'error' | 'info'
  message: string
}

function commissionerActionSuccessCopy(action: string): string {
  switch (String(action).toLowerCase()) {
    case 'start':
      return 'Draft started — live picks are now enabled.'
    case 'pause':
      return 'Draft paused — pick clock frozen for everyone.'
    case 'resume':
      return 'Draft resumed — pick clock restored.'
    case 'reset_timer':
      return 'Pick timer reset to full time for the current pick.'
    case 'undo_pick':
      return 'Last pick was removed from the board.'
    case 'set_timer_seconds':
      return 'Pick clock length updated.'
    case 'force_autopick':
      return 'Auto-pick executed for the on-clock team.'
    case 'skip_pick':
      return 'Current pick was skipped.'
    case 'complete':
      return 'Draft marked complete.'
    default:
      return 'Commissioner action completed.'
  }
}

export type UseCommissionerActionsProps = {
  leagueId: string
  controlActionInflightRef: MutableRefObject<number>
  setSession: React.Dispatch<React.SetStateAction<DraftSessionSnapshot | null>>
  setCommissionerLoading: React.Dispatch<React.SetStateAction<boolean>>
  setGovernanceBanner: React.Dispatch<React.SetStateAction<GovernanceBanner | null>>
  fetchSession: () => Promise<unknown>
  fetchQueue: () => Promise<unknown>
  fetchChat: () => Promise<unknown>
  fetchDraftPool: () => Promise<unknown>
  fetchDraftAssistantContext: () => Promise<unknown>
  fetchDraftSettings: () => Promise<unknown>
}

export type UseCommissionerActionsReturn = {
  handleCommissionerAction: (action: string, payload?: Record<string, unknown>) => Promise<CommissionerControlApiResult>
  handleCommissionerUndoPick: () => Promise<CommissionerControlApiResult>
  handleCommissionerResetTimer: () => Promise<CommissionerControlApiResult>
}

export function useCommissionerActions({
  leagueId,
  controlActionInflightRef,
  setSession,
  setCommissionerLoading,
  setGovernanceBanner,
  fetchSession,
  fetchQueue,
  fetchChat,
  fetchDraftPool,
  fetchDraftAssistantContext,
  fetchDraftSettings,
}: UseCommissionerActionsProps): UseCommissionerActionsReturn {
  const handleCommissionerAction = useCallback(
    async (action: string, payload?: Record<string, unknown>): Promise<CommissionerControlApiResult> => {
      setCommissionerLoading(true)
      controlActionInflightRef.current += 1
      /** Slice C.1: snapshot the current session so we can roll back on API failure, then
       * apply an optimistic patch so the UI freezes/resumes/resets instantly while the
       * /draft/controls POST is still in flight. The in-flight ref keeps the 2s live-sync
       * poll from clobbering this patch with the server's pre-action snapshot. */
      let priorSession: DraftSessionSnapshot | null = null
      setSession((prev) => {
        priorSession = prev
        if (!prev) return prev
        const liveRemaining =
          prev.timer?.status === 'running' && typeof prev.timer.timerEndAt === 'string'
            ? Math.max(0, Math.ceil((new Date(prev.timer.timerEndAt).getTime() - Date.now()) / 1000))
            : prev.timer?.remainingSeconds ?? prev.pausedRemainingSeconds ?? prev.timerSeconds ?? null
        if (action === 'pause') {
          return {
            ...prev,
            status: 'paused',
            pausedRemainingSeconds: liveRemaining,
            timerEndAt: null,
            timer: prev.timer
              ? { ...prev.timer, status: 'paused', remainingSeconds: liveRemaining, pauseReason: 'commissioner' }
              : prev.timer,
          } as DraftSessionSnapshot
        }
        if (action === 'resume') {
          // Do NOT apply optimistic status: 'in_progress' before server confirms.
          // The clock starts only once the authoritative snapshot arrives so the
          // displayed timerEndAt matches the server's DB write (avoids client/server
          // clock drift and false "pick available" state during the POST flight).
          return prev
        }
        if (action === 'reset_timer') {
          const sec = prev.timerSeconds ?? liveRemaining ?? null
          if (prev.status === 'in_progress' && sec != null && sec > 0) {
            const endAt = new Date(Date.now() + sec * 1000).toISOString()
            return {
              ...prev,
              timerEndAt: endAt,
              pausedRemainingSeconds: null,
              timer: prev.timer
                ? { ...prev.timer, status: 'running', remainingSeconds: sec, timerEndAt: endAt, pauseReason: null }
                : prev.timer,
            } as DraftSessionSnapshot
          }
          if (prev.status === 'paused' && sec != null) {
            return {
              ...prev,
              pausedRemainingSeconds: sec,
              timer: prev.timer ? { ...prev.timer, status: 'paused', remainingSeconds: sec } : prev.timer,
            } as DraftSessionSnapshot
          }
        }
        return prev
      })
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/controls`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...payload }),
        })
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
        const errMsg =
          typeof data.error === 'string'
            ? data.error
            : typeof (data as { message?: unknown }).message === 'string'
              ? String((data as { message: string }).message)
              : null

        if (!res.ok) {
          const code = typeof data.code === 'string' ? data.code : null
          const msg = errMsg || `Commissioner action failed (${res.status}).`
          if (code === 'POOL_NOT_READY') {
            setGovernanceBanner({
              variant: 'info',
              message: 'Player pool is warming — this takes about 10 seconds. Try again shortly.',
            })
            if (priorSession) setSession(priorSession)
            // Trigger pool warming in background so the next retry is fast.
            void fetchDraftPool()
            return { ok: false, error: msg }
          }
          setGovernanceBanner({ variant: 'error', message: msg })
          if (priorSession) setSession(priorSession)
          return { ok: false, error: msg }
        }

        let usedSessionFallback = false
        if (data.session) {
          setSession((prev) => mergeDraftSessionSnapshot(prev, data.session as DraftSessionSnapshot))
        } else {
          usedSessionFallback = true
          await fetchSession()
          void fetchDraftSettings()
          void fetchChat()
          void fetchDraftPool()
        }

        void fetchQueue()
        if (action === 'undo_pick') {
          void fetchChat()
          void fetchDraftPool()
          void fetchDraftAssistantContext()
        }
        if (action === 'pause' || action === 'resume' || (action === 'start' && !usedSessionFallback)) {
          void fetchDraftPool()
        }
        if (action === 'resume' && !usedSessionFallback) {
          void fetchSession()
        }
        if (action === 'set_timer_seconds') void fetchDraftSettings()

        const successMsg = commissionerActionSuccessCopy(action)
        setGovernanceBanner({ variant: 'success', message: successMsg })

        return { ok: true, ...data }
      } catch {
        const msg = 'Network error — try your commissioner action again.'
        setGovernanceBanner({ variant: 'error', message: msg })
        if (priorSession) setSession(priorSession)
        return { ok: false, error: msg }
      } finally {
        setCommissionerLoading(false)
        controlActionInflightRef.current = Math.max(0, controlActionInflightRef.current - 1)
      }
    },
    [
      leagueId,
      controlActionInflightRef,
      setSession,
      setCommissionerLoading,
      setGovernanceBanner,
      fetchSession,
      fetchQueue,
      fetchChat,
      fetchDraftPool,
      fetchDraftAssistantContext,
      fetchDraftSettings,
    ],
  )

  const handleCommissionerUndoPick = useCallback(() => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        'Undo the last drafted pick for everyone in this league? Traded-pick swaps may need a manual double-check.',
      )
    ) {
      return Promise.resolve({ ok: false as const, error: 'Cancelled.', cancelled: true })
    }
    return handleCommissionerAction('undo_pick')
  }, [handleCommissionerAction])

  const handleCommissionerResetTimer = useCallback(() => {
    if (typeof window !== 'undefined' && !window.confirm('Reset the pick clock to full time for the current pick?')) {
      return Promise.resolve({ ok: false as const, error: 'Cancelled.', cancelled: true })
    }
    return handleCommissionerAction('reset_timer')
  }, [handleCommissionerAction])

  return { handleCommissionerAction, handleCommissionerUndoPick, handleCommissionerResetTimer }
}
