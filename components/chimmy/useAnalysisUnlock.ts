"use client"
import { useRef, useState } from 'react'
import type { SendChimmyMessageResult } from '@/lib/chimmy-chat/ChimmyChatService'

/** Keep just the active request in memory. Files and authorization callbacks are never persisted. */
export function useAnalysisUnlock(apply: (id: string, result: SendChimmyMessageResult) => void, onError: (message: string) => void, onBusy?: (busy: boolean) => void) {
  const pending = useRef<{ id: string; unlock: NonNullable<SendChimmyMessageResult['unlock']> } | null>(null)
  const running = useRef(false)
  const attempted = useRef(false)
  const [busy, setBusy] = useState(false)
  const register = (id: string, unlock?: SendChimmyMessageResult['unlock']) => {
    pending.current = unlock ? { id, unlock } : null
    attempted.current = false
  }
  const unlock = async (id: string) => {
    if (running.current || pending.current?.id !== id) return
    running.current = true; attempted.current = true; setBusy(true); onBusy?.(true)
    try {
      const result = await pending.current.unlock()
      if (!result.ok) { onError(result.error || result.response); return }
      register(id, result.unlock)
      apply(id, result)
    } catch { onError('The analysis could not be opened. Retry to check the same request safely.') }
    finally { running.current = false; setBusy(false); onBusy?.(false) }
  }
  return {
    busy, activeId: pending.current?.id, register, unlock,
    // Read the ref so an older React callback also sees an unlock already in flight.
    isBusy: () => running.current,
    retryIfAttempted: async () => {
      if (running.current) return true
      if (!attempted.current || !pending.current) return false
      await unlock(pending.current.id)
      return true
    },
  }
}
