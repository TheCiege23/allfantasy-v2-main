'use client'

import { useState } from 'react'

export function VoteSubmissionCard({
  targets,
  onConfirm,
  disabled,
}: {
  targets: { id: string; name: string; immune?: boolean }[]
  onConfirm?: (id: string) => void
  disabled?: boolean
}) {
  const [sel, setSel] = useState<string | null>(null)
  const [step, setStep] = useState<'pick' | 'confirm' | 'done'>('pick')

  return (
    <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.07] p-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-violet-200">🗳 Tribal Council</p>
      <p className="mt-1 text-[13px] text-white/80">Cast a private ballot — nothing is public until the reveal.</p>
      {step === 'done' ? (
        <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-[12px] text-emerald-100">
          ✓ Your vote has been recorded. Timestamp logged.
        </p>
      ) : step === 'confirm' && sel ? (
        <div className="mt-3 space-y-3" role="dialog" aria-label="Confirm vote">
          <p className="text-[14px] text-white">Vote for {targets.find((t) => t.id === sel)?.name}?</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="min-h-[44px] flex-1 rounded-lg border border-white/15 text-[13px] text-white/80"
              onClick={() => setStep('pick')}
            >
              Back
            </button>
            <button
              type="button"
              className="min-h-[44px] flex-1 rounded-lg bg-sky-500/80 text-[13px] font-semibold text-white"
              onClick={() => {
                onConfirm?.(sel)
                setStep('done')
              }}
            >
              Confirm vote
            </button>
          </div>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {targets.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                disabled={disabled || t.immune}
                aria-label={`Vote for ${t.name}`}
                onClick={() => {
                  setSel(t.id)
                  setStep('confirm')
                }}
                className="flex min-h-[48px] w-full items-center gap-3 rounded-lg border border-white/10 bg-black/30 px-3 text-left text-[13px] text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-sm">
                  {t.name.slice(0, 1)}
                </span>
                <span className="flex-1">{t.name}</span>
                {t.immune ? <span className="text-[11px] text-white/40">Immune</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
