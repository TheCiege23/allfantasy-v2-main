'use client'

import React, { useEffect, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react'
import {
  confirmChimmyActionCard,
  type ChimmyActionCard as Card,
  type ChimmyActionConfirmResult,
} from '@/lib/chimmy-chat/actionCards'

/**
 * A move Chimmy PREPARED — shown with exactly what will change, where, and every warning — that
 * happens only if the user taps Confirm.
 *
 * 🛑 THE CONFIRM TAP IS THE ONLY WRITE, AND IT SENDS ONLY THE TOKEN. Nothing rendered here is sent
 * back; the server re-derives the move from the signed token. So the button is the consent, and the
 * card is its description.
 *
 * ⚠ A LOST RESPONSE LEAVES THE BUTTON LIVE. When the request itself fails we cannot know whether the
 * move happened; the action id is claimed once server-side, so tapping again is safe and reports the
 * recorded outcome. A definitive answer (done, refused, expired) disables it for good.
 */

type Phase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done'; result: ChimmyActionConfirmResult }
  | { kind: 'failed'; result: ChimmyActionConfirmResult; final: boolean }

function who(p: { name: string; position: string | null; team: string | null }): string {
  const bits = [p.position, p.team].filter(Boolean).join(' · ')
  return bits ? `${p.name} (${bits})` : p.name
}

export interface ChimmyActionCardProps {
  card: Card
  onDismiss?: (actionId: string) => void
  /** Injected in tests; the real one posts to /api/chimmy/actions/confirm. */
  confirm?: (card: Card) => Promise<ChimmyActionConfirmResult>
  /** Injected in tests. */
  now?: () => number
}

export default function ChimmyActionCard({ card, onDismiss, confirm = (c) => confirmChimmyActionCard(c), now = Date.now }: ChimmyActionCardProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const expiresAt = Date.parse(card.expiresAt)
  const [expired, setExpired] = useState(() => Number.isFinite(expiresAt) && expiresAt <= now())

  useEffect(() => {
    if (!Number.isFinite(expiresAt) || expired) return
    const ms = Math.max(0, expiresAt - now())
    const t = setTimeout(() => setExpired(true), Math.min(ms, 2_147_000_000))
    return () => clearTimeout(t)
  }, [expiresAt, expired, now])

  const settled = phase.kind === 'done' || (phase.kind === 'failed' && phase.final)
  const disabled = phase.kind === 'sending' || settled || (expired && phase.kind === 'idle')

  async function onConfirm() {
    if (disabled) return
    setPhase({ kind: 'sending' })
    const result = await confirm(card)
    if (result.ok) {
      setPhase({ kind: 'done', result })
      return
    }
    /* A server verdict is final; a transport failure (no verdict arrived) is retryable. */
    setPhase({ kind: 'failed', result, final: result.retryable !== true })
  }

  const leagueLine = [card.league.name, card.league.sport, card.week ? `Week ${card.week}` : null].filter(Boolean).join(' · ')

  return (
    <div
      className="rounded-2xl border border-cyan-400/30 bg-cyan-500/[0.06] p-4 text-sm text-white/90"
      data-testid="chimmy-action-card"
      data-action-kind={card.kind}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-cyan-200/80">Chimmy is ready — your call</p>
          <h3 className="text-base font-semibold text-white">{card.title}</h3>
          {leagueLine ? <p className="text-xs text-white/60">{leagueLine}</p> : null}
        </div>
        {onDismiss && !settled ? (
          <button
            type="button"
            onClick={() => onDismiss(card.actionId)}
            className="rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-white/80"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {card.lineup ? (
        <div className="space-y-2" data-testid="chimmy-action-lineup">
          {card.lineup.moveIn.map((p) => (
            <div key={`in-${p.name}`} className="flex items-center gap-2">
              <ArrowUpFromLine className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden />
              <span>
                Start <strong>{who(p)}</strong>
                {p.slot ? <span className="text-white/60"> in {p.slot}</span> : null}
              </span>
            </div>
          ))}
          {card.lineup.moveOut.map((p) => (
            <div key={`out-${p.name}`} className="flex items-center gap-2">
              <ArrowDownToLine className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
              <span>
                Bench <strong>{who(p)}</strong>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {card.trade ? (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="chimmy-action-trade">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="mb-1 text-xs uppercase tracking-wide text-white/50">You send</p>
            {card.trade.youGive.map((p) => (
              <p key={`give-${p.name}`}>{who(p)}</p>
            ))}
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="mb-1 flex items-center gap-1 text-xs uppercase tracking-wide text-white/50">
              <ArrowLeftRight className="h-3 w-3" aria-hidden /> You get from {card.trade.partnerTeamName}
            </p>
            {card.trade.youGet.map((p) => (
              <p key={`get-${p.name}`}>{who(p)}</p>
            ))}
          </div>
          {card.trade.reviewNote ? <p className="text-xs text-white/60 sm:col-span-2">{card.trade.reviewNote}</p> : null}
        </div>
      ) : null}

      {card.warnings.length > 0 ? (
        <ul className="mt-3 space-y-1" data-testid="chimmy-action-warnings">
          {card.warnings.map((w) => (
            <li key={w} className="flex items-start gap-2 text-xs text-amber-100/90">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {phase.kind === 'done' ? (
          <p className="flex items-center gap-2 text-emerald-200" role="status">
            <CheckCircle2 className="h-4 w-4" aria-hidden /> {phase.result.message}
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={onConfirm}
              disabled={disabled}
              data-testid="chimmy-action-confirm"
              className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase.kind === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {card.kind === 'trade' ? 'Confirm — send offer' : 'Confirm — set lineup'}
            </button>
            {expired && phase.kind === 'idle' ? (
              <span className="text-xs text-white/60">This card expired. Ask Chimmy again for a fresh one.</span>
            ) : (
              <span className="text-xs text-white/50">Nothing changes until you tap Confirm.</span>
            )}
          </>
        )}
      </div>
      {phase.kind === 'failed' ? (
        <p className="mt-2 text-xs text-rose-200" role="alert">
          {phase.result.message}
        </p>
      ) : null}
    </div>
  )
}
