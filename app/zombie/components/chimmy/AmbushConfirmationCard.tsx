'use client'

import { useState } from 'react'
import { useZombieDmCommand } from '@/app/zombie/components/chimmy/useZombieDmCommand'

const TYPES = ['Steal Winnings', 'Horde Boost', 'Intel Gather', 'Force Drop'] as const

export function AmbushConfirmationCard({
  leagueId,
  isWhisperer,
  ambushesLeft,
}: {
  leagueId: string
  isWhisperer: boolean
  ambushesLeft: number
}) {
  const [t, setT] = useState<string>(TYPES[0])
  const { isSending, feedback, sendCommand } = useZombieDmCommand(leagueId)
  if (!isWhisperer || ambushesLeft < 1) return null

  const msg = `@Chimmy ambush ${t.toLowerCase().replace(/\s+/g, '_')}`

  return (
    <div className="rounded-xl border border-[var(--zombie-crimson)]/40 bg-[var(--zombie-crimson)]/10 p-4">
      <p className="text-[13px] font-bold text-red-200">🔴 Whisperer Action</p>
      <p className="mt-1 text-[11px] text-[var(--zombie-text-dim)]">Declare before kickoff. {ambushesLeft} ambush(es) left.</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {TYPES.map((x) => (
          <button
            key={x}
            type="button"
            onClick={() => setT(x)}
            className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${t === x ? 'bg-red-500/40 text-white' : 'bg-white/10 text-white/70'}`}
          >
            {x}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => void sendCommand(msg)}
        disabled={isSending}
        className="mt-3 flex min-h-[56px] w-full items-center justify-center rounded-xl bg-red-600/40 text-[13px] font-bold text-white hover:bg-red-600/55 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSending ? 'Sending…' : 'Invoke Ambush'}
      </button>
      {feedback ? (
        <p className={feedback.kind === 'success' ? 'mt-2 text-[12px] text-emerald-200/90' : 'mt-2 text-[12px] text-red-200/90'}>
          {feedback.text}
        </p>
      ) : null}
    </div>
  )
}
