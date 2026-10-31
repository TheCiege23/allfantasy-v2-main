'use client'

import { paidToolFetch, approvePaidToolQuote } from '@/lib/tokens/paidToolClient'
import { useRef } from 'react'
import { useCallback, useState } from 'react'

export type SurvivorAiResponseBody = {
  error?: string
  code?: string
  message?: string
  preview?: { tokenCost: number; featureLabel?: string; ruleCode?: string }
  narrative?: string
  tokenSpend?: { ledgerId?: string; tokenCost?: number | null; balanceAfter?: number } | null
}

/**
 * Call POST /api/leagues/[leagueId]/survivor/ai with entitlement + token confirmation flow.
 * On 409 (token_confirmation_required), re-call with confirmTokenSpend: true after user confirms.
 */
export function useSurvivorAiRequest() {
  const [loading, setLoading] = useState(false)
  const offer = useRef<unknown>(null)

  const run = useCallback(
    async (leagueId: string, type: string, confirmTokenSpend: boolean) => {
      if (confirmTokenSpend && !approvePaidToolQuote(offer.current)) return { ok: false, status: 409, body: { error: 'Review the current token price first.' } as SurvivorAiResponseBody }
      setLoading(true)
      try {
        const res = await paidToolFetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/ai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, confirmTokenSpend }),
        })
        const body = (await res.json().catch(() => ({}))) as SurvivorAiResponseBody
        if (res.status === 409 && body.code === 'token_confirmation_required') offer.current = body
        return { ok: res.ok, status: res.status, body }
      } finally {
        setLoading(false)
      }
    },
    []
  )

  return { run, loading }
}
