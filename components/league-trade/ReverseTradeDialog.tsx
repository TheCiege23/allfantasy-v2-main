'use client'

/**
 * The confirmation surface for reversing an executed trade — shared by both trade engines.
 *
 * ⚠ IT ASKS THE SERVER BEFORE IT OFFERS THE BUTTON. Reversal overwrites two rosters. A dialog that let a
 * commissioner type a reason and press "Reverse" only to be told the rosters had changed since would be
 * a dialog that trains people to ignore it. So the preflight runs on open, and a trade that cannot be
 * reversed shows WHY — in plain language — with no reverse control at all.
 *
 * ⚠ THE PREFLIGHT IS ADVICE, NOT PERMISSION. The server re-checks everything inside the reversal's own
 * transaction, so a refusal can still arrive after "Reverse" is pressed. The dialog handles that the same
 * way as a preflight refusal rather than as an error.
 *
 * Engine-agnostic by construction: it takes `preflight` and `reverse` callbacks and never knows which
 * endpoint is behind them.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'

import {
  describeBlocker,
  type ReversalOutcome,
  type ReversalPreflight,
  type ReversalReadiness,
} from '@/lib/trade-reversal/client'

type Phase =
  | { kind: 'checking' }
  | { kind: 'blocked'; readiness: ReversalReadiness; message?: string }
  | { kind: 'ready'; error?: string }
  | { kind: 'reversing' }
  | { kind: 'unavailable'; message: string }

const REASON_MAX = 500

export function ReverseTradeDialog(props: {
  /** Who traded with whom, e.g. "Cold Takes FC ⇄ Thunderbolts". */
  title: string
  /** An engine-specific caveat the commissioner should see before confirming. */
  note?: string
  preflight: () => Promise<ReversalPreflight>
  reverse: (reason: string) => Promise<ReversalOutcome>
  onClose: () => void
  /** Called after a confirmed reversal, so the host can reload what changed. */
  onReversed: () => void
}) {
  const { preflight, reverse, onClose, onReversed } = props
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' })
  const [reason, setReason] = useState('')
  const titleId = useId()
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    void (async () => {
      const result = await preflight()
      if (!alive.current) return
      if (!result.ok) setPhase({ kind: 'unavailable', message: result.message })
      else if (!result.readiness.ok) setPhase({ kind: 'blocked', readiness: result.readiness })
      else setPhase({ kind: 'ready' })
    })()
    return () => {
      alive.current = false
    }
  }, [preflight])

  useEffect(() => {
    if (phase.kind === 'ready') reasonRef.current?.focus()
  }, [phase.kind])

  const busy = phase.kind === 'reversing'
  const close = useCallback(() => {
    if (!busy) onClose()
  }, [busy, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const trimmed = reason.trim()
  const canConfirm = phase.kind === 'ready' && trimmed.length > 0

  const confirm = async () => {
    if (!canConfirm) return
    setPhase({ kind: 'reversing' })
    const outcome = await reverse(trimmed)
    if (!alive.current) return
    if (outcome.ok) {
      onReversed()
      onClose()
      return
    }
    if (outcome.readiness && !outcome.readiness.ok) {
      setPhase({ kind: 'blocked', readiness: outcome.readiness, message: outcome.message })
      return
    }
    setPhase({ kind: 'ready', error: outcome.message })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="reverse-trade-dialog"
        className="w-full max-w-md rounded-xl border border-white/10 bg-[#0b0f17] p-4 text-[12px] text-white/80 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p id={titleId} className="text-[14px] font-semibold text-white">
          Reverse trade
        </p>
        <p className="mt-0.5 text-white/55">{props.title}</p>

        {phase.kind === 'checking' ? (
          <p className="mt-3 text-white/55" data-testid="reverse-trade-checking">
            Checking whether this trade can still be reversed…
          </p>
        ) : null}

        {phase.kind === 'unavailable' ? (
          <p className="mt-3 text-rose-300" role="alert" data-testid="reverse-trade-unavailable">
            {phase.message}
          </p>
        ) : null}

        {phase.kind === 'blocked' ? (
          <div className="mt-3 space-y-2" role="alert">
            {phase.message ? <p className="text-rose-300">{phase.message}</p> : null}
            <p className="font-semibold text-white/80">This trade can’t be reversed:</p>
            <ul className="list-disc space-y-1 pl-4 text-white/65">
              {phase.readiness.blockers.map((b) => (
                <li key={b} data-testid="reverse-trade-blocker">
                  {describeBlocker(b)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {phase.kind === 'ready' || phase.kind === 'reversing' ? (
          <div className="mt-3 space-y-2">
            <p className="text-white/70">
              Both rosters go back to how they were before this trade, including FAAB. Only use this to undo
              a trade that should not have gone through.
            </p>
            {props.note ? <p className="text-amber-200/90">{props.note}</p> : null}
            <label className="block">
              <span className="text-white/70">Reason (recorded with the reversal)</span>
              <textarea
                ref={reasonRef}
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
                disabled={busy}
                rows={3}
                maxLength={REASON_MAX}
                data-testid="reverse-trade-reason"
                className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 p-2 text-[12px] text-white placeholder:text-white/30"
                placeholder="e.g. Commissioner review found collusion"
              />
            </label>
            {phase.kind === 'ready' && phase.error ? (
              <p className="text-rose-300" role="alert" data-testid="reverse-trade-error">
                {phase.error}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            data-testid="reverse-trade-cancel"
            className="min-h-[44px] rounded-lg border border-white/15 px-4 text-[12px] font-semibold text-white/80 disabled:opacity-50"
          >
            {phase.kind === 'blocked' || phase.kind === 'unavailable' ? 'Close' : 'Cancel'}
          </button>
          {phase.kind === 'ready' || phase.kind === 'reversing' ? (
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={!canConfirm}
              data-testid="reverse-trade-confirm"
              className="min-h-[44px] rounded-lg border border-rose-400/50 bg-rose-500/10 px-4 text-[12px] font-semibold text-rose-200 disabled:opacity-50"
            >
              {busy ? 'Reversing…' : 'Reverse trade'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
