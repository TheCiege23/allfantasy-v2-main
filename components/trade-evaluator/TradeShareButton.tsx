'use client'

import { useState } from 'react'
import { shareableLeagueGrade } from '@/components/dynasty-trade/sharedTrade'
import type { DynastyTradeGrade } from '@/components/dynasty-trade/leagueGradeWinner'

/**
 * "Share this trade" — a public /trade/{id} link (2026-11-12).
 *
 * The retired /dynasty-trade-analyzer was the only trade tool that could share a result, so this
 * moved here with it: the same `POST /api/trade/share` (sign-in required, 30-day link) and the same
 * stored shape, so /trade/[id] reads new shares exactly as it reads old ones.
 *
 * 🛑 THE grade only — `shareableLeagueGrade` keeps the six fields the share page draws and nothing
 * else (components/dynasty-trade/sharedTrade.ts).
 */
export type ShareAsset = { id: string; name: string; type: 'player' | 'pick' }

export function TradeShareButton({
  sideA,
  sideB,
  grade,
  teamAName,
  teamBName,
  factors,
  leagueContext,
}: {
  sideA: ShareAsset[]
  sideB: ShareAsset[]
  grade: DynastyTradeGrade | null
  teamAName: string
  teamBName: string
  factors: string[]
  leagueContext: string | null
}) {
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'copied' | 'link' | 'error'; url?: string }>({ kind: 'idle' })

  const share = async () => {
    setState({ kind: 'busy' })
    try {
      const res = await fetch('/api/trade/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sideA: sideA.slice(0, 20),
          sideB: sideB.slice(0, 20),
          analysis: {
            leagueGrade: shareableLeagueGrade(grade),
            factors,
            teamAName,
            teamBName,
            ...(leagueContext ? { leagueContext } : {}),
          },
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const { shareId } = (await res.json()) as { shareId: string }
      const url = `${window.location.origin}/trade/${shareId}`
      try {
        await navigator.clipboard.writeText(url)
        setState({ kind: 'copied', url })
      } catch {
        setState({ kind: 'link', url })
      }
    } catch {
      setState({ kind: 'error' })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="trade-share">
      <button
        type="button"
        onClick={share}
        disabled={state.kind === 'busy' || sideA.length + sideB.length === 0}
        className="min-h-[44px] rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-4 text-sm font-semibold text-cyan-100 disabled:opacity-50"
      >
        {state.kind === 'busy' ? 'Creating link…' : 'Share this trade'}
      </button>
      <span role="status" aria-live="polite" className="text-xs text-white/60">
        {state.kind === 'copied' ? 'Link copied — it works for 30 days.' : null}
        {state.kind === 'link' && state.url ? (
          <a href={state.url} className="underline">
            {state.url}
          </a>
        ) : null}
        {state.kind === 'error' ? 'Could not create a share link. Try again.' : null}
      </span>
    </div>
  )
}

