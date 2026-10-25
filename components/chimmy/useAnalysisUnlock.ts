"use client"
import { useRef, useState } from 'react'
import type { SendChimmyMessageResult } from '@/lib/chimmy-chat/ChimmyChatService'

/** Keep just the active request in memory. Files and authorization callbacks are never persisted. */
export function useAnalysisUnlock(apply: (id: string, result: SendChimmyMessageResult) => void, onError: (message: string) => void) {
  const pending = useRef<{ id: string; unlock: NonNullable<SendChimmyMessageResult['unlock']> } | null>(null)
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const register = (id: string, unlock?: SendChimmyMessageResult['unlock']) => { pending.current = unlock ? { id, unlock } : null }
  return {
    busy, activeId: pending.current?.id, register,
    unlock: async (id: string) => {
      if (running.current || pending.current?.id !== id) return
      running.current = true; setBusy(true)
      try {
        const result = await pending.current.unlock()
        if (!result.ok) { onError(result.error || result.response); return }
        register(id, result.unlock)
        apply(id, result)
      } catch { onError('The analysis could not be opened. Retry to check the same request safely.') }
      finally { running.current = false; setBusy(false) }
    },
  }
}
