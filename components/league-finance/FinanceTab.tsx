'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Wallet } from 'lucide-react'
import { LeagueDuesTrackerPanel } from '@/components/league-settings/LeagueDuesTrackerPanel'
import {
  MANUAL_PAYMENT_PRESETS,
  getManualPaymentPreset,
  type ManualPaymentPresetId,
} from '@/lib/league-finance/manualPaymentPresets'

type FinanceSummary = {
  /** False while AllFantasy holds no league money (lib/monetization/leagueEntryFeeKillSwitch.ts). */
  moneyHoldingEnabled?: boolean
  finance: {
    isPaidLeague: boolean
    entryFeeCents: number
    currency: string
    treasuryBalanceCents: number
    treasuryProvider: string
    externalEscrowUrl: string | null
    externalEscrowLabel: string | null
    allowManualPaymentMark: boolean
  }
  season: number
  myDues: {
    status: string
    amountDueCents: number
    amountPaidCents: number
    paymentProvider: string | null
    paidAt: string | null
  } | null
  allDues: Array<{
    userId: string
    status: string
    amountDueCents: number
    amountPaidCents: number
    paymentProvider: string | null
  }> | null
  payouts: Array<{
    id: string
    requestedByUserId: string
    amountCents: number
    status: string
    recipientNote: string | null
    freezeReason: string | null
    createdAt: string
  }>
  audit: Array<{
    eventType: string
    entityType: string
    createdAt: string
    payload: unknown
  }> | null
  role: string
}

function centsToUsd(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

export function FinanceTab({
  leagueId,
  isCommissioner,
}: {
  leagueId: string
  isCommissioner: boolean
}) {
  const [data, setData] = useState<FinanceSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [payoutAmount, setPayoutAmount] = useState('')
  const [payoutNote, setPayoutNote] = useState('')
  const [manualUser, setManualUser] = useState('')
  const [manualAmount, setManualAmount] = useState('')
  const [manualRef, setManualRef] = useState('')
  const [manualProviderId, setManualProviderId] = useState<ManualPaymentPresetId>('manual')
  const [settingsPaid, setSettingsPaid] = useState(false)
  const [settingsEntryCents, setSettingsEntryCents] = useState('')
  const [settingsManual, setSettingsManual] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/finance/summary`, {
        credentials: 'include',
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? 'Failed to load finance')
      }
      const j = (await res.json()) as FinanceSummary
      setData(j)
      setSettingsPaid(j.finance.isPaidLeague)
      setSettingsEntryCents(String(Math.max(0, Math.round(j.finance.entryFeeCents / 100))))
      setSettingsManual(j.finance.allowManualPaymentMark)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const payEntry = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/finance/entry-checkout`, {
        method: 'POST',
        credentials: 'include',
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((j as { error?: string }).error ?? 'Checkout failed')
      const url = (j as { url?: string }).url
      if (url) window.location.href = url
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Checkout error')
    } finally {
      setBusy(false)
    }
  }

  const submitPayoutRequest = async () => {
    const n = parseFloat(payoutAmount)
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter a valid payout amount (USD).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/finance/payout-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          amountCents: Math.round(n * 100),
          recipientNote: payoutNote || undefined,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((j as { error?: string }).error ?? 'Request failed')
      setPayoutAmount('')
      setPayoutNote('')
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Payout request failed')
    } finally {
      setBusy(false)
    }
  }

  const payoutAction = async (payoutId: string, action: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/finance/payout/${encodeURIComponent(payoutId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ action }),
        },
      )
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((j as { error?: string }).error ?? 'Update failed')
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const saveSettings = async () => {
    setBusy(true)
    setError(null)
    try {
      const entryCents = Math.round(parseFloat(settingsEntryCents || '0') * 100)
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/finance/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          isPaidLeague: settingsPaid,
          entryFeeCents: entryCents,
          allowManualPaymentMark: settingsManual,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((j as { error?: string }).error ?? 'Save failed')
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const activeManualPreset = useMemo(
    () => getManualPaymentPreset(manualProviderId) ?? getManualPaymentPreset('manual'),
    [manualProviderId],
  )

  const manualMark = async () => {
    const amt = parseFloat(manualAmount)
    if (!manualUser.trim() || !Number.isFinite(amt)) {
      setError('Manager user id and amount required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/finance/manual-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          targetUserId: manualUser.trim(),
          amountCents: Math.round(amt * 100),
          externalReference: manualRef || undefined,
          paymentProvider: manualProviderId,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((j as { error?: string }).error ?? 'Failed')
      setManualUser('')
      setManualAmount('')
      setManualRef('')
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div
        className="rounded-xl border border-white/[0.08] bg-[#0a1228]/90 p-6 text-sm text-white/60"
        data-testid="finance-tab-loading"
      >
        Loading finance…
      </div>
    )
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-amber-500/25 bg-[#0a1228]/90 p-6 text-sm text-amber-100/90">
        {error ?? 'Unable to load finance.'}
      </div>
    )
  }

  const { finance, myDues, payouts } = data
  const showPayCta = finance.isPaidLeague && finance.entryFeeCents > 0 && myDues?.status !== 'paid' && myDues?.status !== 'waived'


  /*
   * 🛑 AllFantasy DOES NOT HOLD LEAGUE MONEY. While the switch is off every payment, payout and treasury
   * action below is refused by its route, so offering the buttons would only produce errors. The league
   * collects dues itself; the tracker records who has paid.
   */
  if (data.moneyHoldingEnabled === false) {
    return (
      <div className="space-y-4" data-testid="finance-tracker-only">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/75">
          <p className="font-semibold text-white">AllFantasy doesn&rsquo;t hold league money</p>
          <p className="mt-1">
            Pay dues straight to your league&rsquo;s collector — Venmo, Cash App, PayPal, LeagueSafe or FanCred. Your commissioner tracks who has paid here.
          </p>
        </div>
        <LeagueDuesTrackerPanel leagueId={leagueId} />
      </div>
    )
  }

  return (
    <div className="space-y-4 px-4 pb-8 pt-2" data-testid="finance-tab-root">
      <div className="flex items-center gap-2 text-white">
        <Wallet className="h-5 w-5 text-cyan-400/90" aria-hidden />
        <h2 className="text-base font-semibold tracking-tight">League finance</h2>
      </div>

      {error ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-100/95">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 rounded-xl border border-white/[0.08] bg-[#081226]/90 p-4 text-[13px] text-white/80">
        <div className="flex flex-wrap justify-between gap-2">
          <span className="text-white/55">Treasury (tracked)</span>
          <span className="font-semibold text-white">{centsToUsd(finance.treasuryBalanceCents)}</span>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <span className="text-white/55">Entry fee</span>
          <span className="text-white">
            {finance.isPaidLeague && finance.entryFeeCents > 0
              ? centsToUsd(finance.entryFeeCents)
              : 'Free'}
          </span>
        </div>
        {finance.externalEscrowUrl ? (
          <a
            href={finance.externalEscrowUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 hover:text-cyan-300"
            data-testid="finance-external-escrow-link"
          >
            {finance.externalEscrowLabel ?? 'External escrow / LeagueSafe-style link'} →
          </a>
        ) : (
          <p className="text-[12px] text-white/45">
            PayPal, Coinbase, and other rails can be tracked via commissioner manual entries and provider labels on
            dues rows.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-[#0a1228]/80 p-4">
        <h3 className="text-[13px] font-semibold text-white">Your dues</h3>
        <p className="mt-2 text-[13px] text-white/65">
          Status:{' '}
          <span className="font-medium text-white">{myDues?.status ?? 'none'}</span>
          {myDues ? (
            <>
              {' '}
              · Paid {centsToUsd(myDues.amountPaidCents)} / due {centsToUsd(myDues.amountDueCents)}
            </>
          ) : null}
        </p>
        {showPayCta ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void payEntry()}
            className="mt-3 w-full rounded-xl border border-cyan-500/35 bg-cyan-500/15 py-2.5 text-[13px] font-semibold text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-50"
            data-testid="finance-pay-entry"
          >
            Pay entry with Stripe
          </button>
        ) : null}
      </div>

      {isCommissioner ? (
        <div className="space-y-3 rounded-xl border border-white/[0.08] bg-[#081226]/85 p-4">
          <h3 className="text-[13px] font-semibold text-white">Commissioner — league settings</h3>
          <label className="flex items-center gap-2 text-[13px] text-white/75">
            <input
              type="checkbox"
              checked={settingsPaid}
              onChange={(e) => setSettingsPaid(e.target.checked)}
              data-testid="finance-settings-paid-toggle"
            />
            Paid league (enforce entry before join)
          </label>
          <label className="block text-[12px] text-white/55">
            Entry fee (USD)
            <input
              type="number"
              min={0}
              step="0.01"
              value={settingsEntryCents}
              onChange={(e) => setSettingsEntryCents(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/[0.12] bg-[#040915] px-3 py-2 text-white"
              data-testid="finance-settings-entry-fee"
            />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-white/75">
            <input
              type="checkbox"
              checked={settingsManual}
              onChange={(e) => setSettingsManual(e.target.checked)}
            />
            Allow manual payment marks
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveSettings()}
            className="w-full rounded-xl border border-white/[0.12] bg-white/[0.06] py-2 text-[13px] font-semibold text-white/90 hover:bg-white/[0.1]"
            data-testid="finance-settings-save"
          >
            Save finance settings
          </button>

          <div className="border-t border-white/[0.06] pt-3">
            <h4 className="text-[12px] font-semibold text-white/80">Record manual payment</h4>
            <p className="mt-1 text-[11px] text-white/45">Choose how they paid — stored on their dues row for audit.</p>
            <div
              className="mt-2 flex flex-wrap gap-1.5"
              role="group"
              aria-label="Payment method preset"
              data-testid="finance-manual-preset-group"
            >
              {MANUAL_PAYMENT_PRESETS.map((p) => {
                const active = manualProviderId === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setManualProviderId(p.id)}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      active
                        ? 'border-cyan-500/45 bg-cyan-500/15 text-cyan-100'
                        : 'border-white/[0.1] bg-[#040915]/80 text-white/65 hover:border-white/[0.18] hover:text-white/85'
                    }`}
                    data-testid={`finance-manual-preset-${p.id}`}
                  >
                    {p.shortLabel}
                  </button>
                )
              })}
            </div>
            <input
              placeholder="Manager user ID"
              value={manualUser}
              onChange={(e) => setManualUser(e.target.value)}
              className="mt-3 w-full rounded-lg border border-white/[0.12] bg-[#040915] px-3 py-2 text-[13px] text-white"
              data-testid="finance-manual-user"
            />
            <input
              placeholder="Amount USD"
              value={manualAmount}
              onChange={(e) => setManualAmount(e.target.value)}
              className="mt-2 w-full rounded-lg border border-white/[0.12] bg-[#040915] px-3 py-2 text-[13px] text-white"
              data-testid="finance-manual-amount"
            />
            <input
              placeholder={activeManualPreset?.refPlaceholder ?? 'Reference (optional)'}
              value={manualRef}
              onChange={(e) => setManualRef(e.target.value)}
              className="mt-2 w-full rounded-lg border border-white/[0.12] bg-[#040915] px-3 py-2 text-[13px] text-white"
              data-testid="finance-manual-ref"
            />
            {activeManualPreset ? (
              <p className="mt-1 text-[11px] text-white/40">{activeManualPreset.refHint}</p>
            ) : null}
            <button
              type="button"
              disabled={busy || !finance.allowManualPaymentMark}
              onClick={() => void manualMark()}
              className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.06] py-2 text-[13px] text-white/90 hover:bg-white/[0.1] disabled:opacity-40"
              data-testid="finance-manual-submit"
            >
              Mark paid
            </button>
            {!finance.allowManualPaymentMark ? (
              <p className="mt-1 text-[11px] text-amber-200/80">Enable “Allow manual payment marks” above and save.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-white/[0.08] bg-[#0a1228]/80 p-4">
        <h3 className="text-[13px] font-semibold text-white">Payout requests</h3>
        <div className="mt-2 space-y-2">
          {payouts.length === 0 ? (
            <p className="text-[12px] text-white/45">No payout requests yet.</p>
          ) : (
            payouts.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-white/[0.06] bg-[#040915]/80 px-3 py-2 text-[12px] text-white/75"
                data-testid={`finance-payout-row-${p.id}`}
              >
                <div className="flex flex-wrap justify-between gap-1">
                  <span>{centsToUsd(p.amountCents)}</span>
                  <span className="text-white/50">{p.status}</span>
                </div>
                {p.recipientNote ? <p className="mt-1 text-white/55">{p.recipientNote}</p> : null}
                {isCommissioner ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-md border border-emerald-500/30 px-2 py-1 text-[11px] text-emerald-200"
                      onClick={() => void payoutAction(p.id, 'approve')}
                      data-testid={`finance-payout-approve-${p.id}`}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-md border border-white/15 px-2 py-1 text-[11px]"
                      onClick={() => void payoutAction(p.id, 'paid')}
                      data-testid={`finance-payout-paid-${p.id}`}
                    >
                      Mark paid out
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-md border border-amber-500/30 px-2 py-1 text-[11px] text-amber-200"
                      onClick={() => void payoutAction(p.id, 'freeze')}
                      data-testid={`finance-payout-freeze-${p.id}`}
                    >
                      Freeze
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-md border border-red-500/30 px-2 py-1 text-[11px] text-red-200"
                      onClick={() => void payoutAction(p.id, 'reject')}
                      data-testid={`finance-payout-reject-${p.id}`}
                    >
                      Reject
                    </button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        <div className="mt-4 border-t border-white/[0.06] pt-3">
          <h4 className="text-[12px] font-semibold text-white/85">Request a payout</h4>
          <input
            placeholder="Amount (USD)"
            value={payoutAmount}
            onChange={(e) => setPayoutAmount(e.target.value)}
            className="mt-2 w-full rounded-lg border border-white/[0.12] bg-[#040915] px-3 py-2 text-[13px] text-white"
            data-testid="finance-payout-amount"
          />
          <input
            placeholder="Note (optional)"
            value={payoutNote}
            onChange={(e) => setPayoutNote(e.target.value)}
            className="mt-2 w-full rounded-lg border border-white/[0.12] bg-[#040915] px-3 py-2 text-[13px] text-white"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void submitPayoutRequest()}
            className="mt-2 w-full rounded-xl border border-cyan-500/30 bg-cyan-500/10 py-2 text-[13px] font-semibold text-cyan-100"
            data-testid="finance-payout-submit"
          >
            Submit request
          </button>
          <p className="mt-2 text-[11px] text-white/40">
            Requests unlock in playoffs / completed phase per league lifecycle rules.
          </p>
        </div>
      </div>

      {isCommissioner && data.allDues && data.allDues.length > 0 ? (
        <div className="rounded-xl border border-white/[0.08] bg-[#081226]/85 p-4">
          <h3 className="text-[13px] font-semibold text-white">Member dues (commissioner)</h3>
          <ul className="mt-2 space-y-1 text-[12px] text-white/65" data-testid="finance-all-dues">
            {data.allDues.map((d) => (
              <li key={d.userId} className="flex justify-between gap-2">
                <span className="truncate font-mono text-[11px]">{d.userId}</span>
                <span>
                  {d.status} · {centsToUsd(d.amountPaidCents)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isCommissioner && data.audit && data.audit.length > 0 ? (
        <div className="rounded-xl border border-white/[0.08] bg-[#040915]/80 p-4">
          <h3 className="text-[13px] font-semibold text-white">Finance audit (recent)</h3>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-[11px] text-white/50" data-testid="finance-audit-list">
            {data.audit.map((a) => (
              <li key={`${a.eventType}-${a.createdAt}`}>
                {a.eventType} · {new Date(a.createdAt).toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
