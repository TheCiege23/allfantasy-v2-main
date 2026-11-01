'use client'

import { useState } from 'react'

export function JuryVotingCard({
  finalists,
  onConfirm,
}: {
  finalists: { id: string; name: string }[]
  onConfirm?: (id: string) => void
}) {
  const [sel, setSel] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-[13px] text-emerald-100">
        ✓ Jury vote recorded. Stay tuned for the reveal.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-4">
      <p className="sv-kicker text-[11px]">⚖️ Jury vote</p>
      <p className="mt-1 text-[13px] text-white/80">Cast your vote for the season winner.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {finalists.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setSel(f.id)}
            className={`min-h-[56px] rounded-xl border px-2 text-[13px] font-semibold ${
              sel === f.id ? 'border-[#e8c98e] bg-[rgba(232,201,142,0.14)] text-white' : 'border-white/10 bg-black/30 text-white/80'
            }`}
          >
            {f.name}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={!sel}
        className="mt-3 w-full min-h-[48px] rounded-lg bg-[var(--survivor-torch,#f0a35e)] text-[13px] font-bold text-[#1a0f05] disabled:opacity-40"
        onClick={() => {
          if (sel) onConfirm?.(sel)
          setDone(true)
        }}
      >
        Confirm jury vote
      </button>
    </div>
  )
}
