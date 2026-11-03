'use client'

import { useCallback, useRef, useState } from 'react'

type CommandFeedback = {
  kind: 'success' | 'error'
  text: string
}

type ChimmyDmResponse = {
  ok?: boolean
  chimmyActionId?: string
  privateMessage?: string | null
  error?: string
}

export function useZombieDmCommand(leagueId: string) {
  const [isSending, setIsSending] = useState(false)
  const [feedback, setFeedback] = useState<CommandFeedback | null>(null)
  const sending = useRef(false)
  const pending = useRef<{ leagueId: string; message: string; commandId: string } | null>(null)

  const sendCommand = useCallback(
    async (message: string) => {
      if (sending.current) return false
      sending.current = true
      if (!pending.current || pending.current.leagueId !== leagueId || pending.current.message !== message) pending.current = { leagueId, message, commandId: crypto.randomUUID() }
      setIsSending(true)
      setFeedback(null)
      try {
        const res = await fetch('/api/zombie/chimmy/dm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(pending.current),
        })

        const payload = (await res.json().catch(() => ({}))) as ChimmyDmResponse
        if (!res.ok || !payload.ok) {
          if (res.status < 500 && (payload.chimmyActionId || res.status === 400 || res.status === 401 || res.status === 403)) pending.current = null
          setFeedback({
            kind: 'error',
            text: payload.privateMessage || payload.error || 'Command failed. Try again.',
          })
          return false
        }

        pending.current = null
        setFeedback({
          kind: 'success',
          text: payload.privateMessage || 'Command sent to @Chimmy in DM.',
        })
        window.dispatchEvent(new CustomEvent('zombie-items-updated', { detail: { leagueId } }))
        return true
      } catch {
        setFeedback({ kind: 'error', text: 'Connection interrupted. Retry the same command to check the saved result; it will reuse the original request.' })
        return false
      } finally {
        sending.current = false
        setIsSending(false)
      }
    },
    [leagueId],
  )

  return { isSending, feedback, sendCommand }
}