'use client'

import { useState } from 'react'

export function ChallengePickCard({
  title,
  instructions,
  children,
  onLock,
}: {
  title: string
  instructions: string
  children: React.ReactNode
  onLock?: (payload: string) => void
}) {
  const [v, setV] = useState('')
  return (
    <div className="sv-chimmy-card rounded-xl border p-4">
      <p className="sv-kicker text-[11px]">⚡ Private submission</p>
      <p className="sv-h mt-1 text-[15px]">{title}</p>
      <p className="mt-2 text-[12px] text-white/65">{instructions}</p>
      <div className="mt-3">{children}</div>
      <input
        className="mt-3 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13px] text-white placeholder:text-white/40 focus:border-[rgba(240,163,94,0.55)] focus:outline-none"
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="Your pick"
        aria-label="Challenge pick"
      />
      <button
        type="button"
        className="mt-3 w-full min-h-[48px] rounded-lg bg-[var(--survivor-torch,#f0a35e)] text-[13px] font-semibold text-[#1a0f05] hover:bg-[#f4b47a]"
        onClick={() => onLock?.(v)}
      >
        Lock in pick
      </button>
    </div>
  )
}
