'use client'
/**
 * Fantasy OS Suite — Phase OS-A2: League Context Wiring.
 *
 * Shows what Decision OS currently believes about a league's financial state, and — only when
 * `canManage` is true — lets a real person (the league's commissioner/co-commissioner, or a site
 * admin, per `leagueContextAuthorization.ts`) confirm free/paid or reset to unknown. The server is
 * the real gate; `canManage` only controls whether this component RENDERS the controls, matching this
 * card's own read-only default.
 *
 * Deliberately NOT a payment or collection surface — no "pay now," no balance, no treasury. That is
 * `LeagueFinance`'s job (a separate, already-existing AF-native system). This card only records a
 * belief, and says so explicitly in its own copy.
 */
import { useCallback, useEffect, useState } from 'react'
import { DollarSign } from 'lucide-react'
import type { LeagueFinancialContext } from '@/lib/decision-os/leagueFinancialContext'
import { describeLeagueFinancialContext } from '@/lib/decision-os/leagueFinancialContext'
import {
  DecisionOsBadge,
  DecisionOsEmptyState,
  DecisionOsPanel,
  decisionOsCardClassName,
} from './DecisionOsCardPrimitives'

type LeagueContextCardProps = {
  leagueId: string | null
  /** Only render manage controls when true. Read-only summary always renders once loaded. */
  canManage?: boolean
  variant?: 'commissioner' | 'league'
}

export default function LeagueContextCard({ leagueId, canManage = false, variant = 'commissioner' }: LeagueContextCardProps) {
  const [context, setContext] = useState<LeagueFinancialContext | null>(null)
  const [buyInAmount, setBuyInAmount] = useState('')
  const [buyInCurrency, setBuyInCurrency] = useState('usd')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!leagueId) {
      setContext(null)
      return
    }
    void fetch(`/api/decision-os/league-context?leagueId=${encodeURIComponent(leagueId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => (res.ok ? (res.json() as Promise<LeagueFinancialContext>) : null))
      .then(setContext)
      .catch(() => setContext(null))
  }, [leagueId])

  useEffect(() => {
    load()
  }, [load])

  async function submit(action: 'confirm_free' | 'confirm_paid' | 'reset') {
    if (!leagueId) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/decision-os/league-context', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          action,
          buyInAmount: action === 'confirm_paid' && buyInAmount ? Number(buyInAmount) : undefined,
          buyInCurrency: action === 'confirm_paid' ? buyInCurrency : undefined,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      setContext(body as LeagueFinancialContext)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (!leagueId) {
    return (
      <section data-testid={`league-context-card-${variant}`} className={decisionOsCardClassName}>
        <div className="p-5">
          <DecisionOsEmptyState
            icon={DollarSign}
            title="League Context is loading"
            description="This league's financial state will appear here once loaded."
          />
        </div>
      </section>
    )
  }

  return (
    <section
      data-testid={`league-context-card-${variant}`}
      className={decisionOsCardClassName}
      aria-label="League Context"
    >
      <div className="border-b border-subtle bg-surface-muted/60 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <DecisionOsBadge icon={DollarSign}>League Context</DecisionOsBadge>
        </div>
        <h2 className="mt-3 text-xl font-black tracking-tight text-primary">Is this league free or paid?</h2>
        <p className="mt-1 text-xs leading-5 text-secondary">
          A recorded belief, not a payment or collection system — see{' '}
          <span className="font-semibold">League Finance</span> for AllFantasy&apos;s own paid-league
          treasury feature.
        </p>
      </div>

      <div className="space-y-4 p-5">
        <DecisionOsPanel title="Current status">
          <p className="mt-2 text-sm font-bold text-primary" data-testid="league-context-summary">
            {context ? describeLeagueFinancialContext(context) : 'Loading…'}
          </p>
        </DecisionOsPanel>

        {error ? (
          <div
            data-testid="league-context-error"
            className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700"
          >
            {error}
          </div>
        ) : null}

        {canManage ? (
          <div className="space-y-3" data-testid="league-context-manage-controls">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                placeholder="Buy-in amount (optional)"
                value={buyInAmount}
                onChange={(e) => setBuyInAmount(e.target.value)}
                data-testid="league-context-buyin-amount"
                className="w-44 rounded-lg border border-subtle bg-surface px-3 py-1.5 text-sm text-primary outline-none focus:border-brand-primary/60"
              />
              <input
                type="text"
                maxLength={8}
                value={buyInCurrency}
                onChange={(e) => setBuyInCurrency(e.target.value)}
                data-testid="league-context-buyin-currency"
                className="w-20 rounded-lg border border-subtle bg-surface px-3 py-1.5 text-sm text-primary outline-none focus:border-brand-primary/60"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submit('confirm_free')}
                data-testid="league-context-confirm-free"
                className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-xs font-black uppercase tracking-wide text-emerald-700 transition hover:bg-emerald-500/20 disabled:opacity-40"
              >
                Confirm Free
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submit('confirm_paid')}
                data-testid="league-context-confirm-paid"
                className="rounded-xl border border-brand-primary/25 bg-brand-primary/10 px-4 py-2 text-xs font-black uppercase tracking-wide text-brand-primary transition hover:bg-brand-primary/20 disabled:opacity-40"
              >
                Confirm Paid
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submit('reset')}
                data-testid="league-context-reset"
                className="rounded-xl border border-subtle bg-surface px-4 py-2 text-xs font-black uppercase tracking-wide text-muted transition hover:text-primary disabled:opacity-40"
              >
                Reset to Unknown
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
