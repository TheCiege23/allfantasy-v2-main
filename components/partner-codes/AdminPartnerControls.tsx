'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PartnerSettings } from '@/lib/partner-codes/settings'

async function post(body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch('/api/admin/partner-codes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (res.ok) return null
  const j = await res.json().catch(() => ({}))
  return j.error ?? 'Failed'
}

const small = 'min-h-10 rounded-lg px-3.5 font-semibold'

export function AdminPartnerActions({ kind, id, status }: { kind: 'payout' | 'referral'; id: string; status: string }) {
  const router = useRouter()
  const [err, setErr] = useState<string | null>(null)
  const run = async (action: string) => {
    const note = action === 'hold' ? window.prompt('Why hold it?') ?? undefined : action === 'mark_paid' ? window.prompt('Payment reference (optional)') ?? undefined : undefined
    const e = await post(kind === 'payout' ? { action, payoutId: id, note } : { action, referralId: id })
    setErr(e)
    if (!e) router.refresh()
  }
  return (
    <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
      {kind === 'payout' ? (
        <>
          {status !== 'approved' ? <button type="button" onClick={() => run('approve')} className={`${small} bg-purple-500 text-white`}>Approve</button> : null}
          {status === 'approved' ? <button type="button" onClick={() => run('mark_paid')} className={`${small} bg-emerald-600 text-white`}>Mark paid</button> : null}
          {status !== 'held' ? <button type="button" onClick={() => run('hold')} className={`${small} border border-[#3b3f6e]`}>Hold</button> : null}
        </>
      ) : (
        <>
          <button type="button" onClick={() => run('clear')} className={`${small} border border-[#3b3f6e]`}>Clear</button>
          <button type="button" onClick={() => run('reject')} className={`${small} bg-red-900 text-white`}>Reject</button>
        </>
      )}
      {err ? <span className="w-full text-right text-xs text-rose-300">{err}</span> : null}
    </div>
  )
}

const FIELDS: Array<{ key: keyof PartnerSettings; label: string; kind?: 'select'; options?: Array<[string, string]> }> = [
  { key: 'discountPercent', label: 'Friend discount (%)' },
  { key: 'discountMonths', label: 'Discount months' },
  { key: 'yearlyDiscountMode', label: 'Yearly discount', kind: 'select', options: [['prorated', 'Prorated (3/12)'], ['full_year', 'Full first year']] },
  { key: 'commissionPercent', label: 'Commission (%)' },
  { key: 'commissionBasis', label: 'Commission based on', kind: 'select', options: [['net', 'After fees (net)'], ['gross', 'Before fees (gross)']] },
  { key: 'commissionCapMonths', label: 'Months per subscriber (blank = no limit)' },
  { key: 'cashThresholdPaidSubs', label: 'Paid subscribers for cash' },
  { key: 'freeSupremePaidSubs', label: 'Paid subscribers for AF Supreme' },
  { key: 'freeCommissionerActiveUsers', label: 'Active users for AF Commissioner' },
  { key: 'freeSupremeActiveUsers', label: 'Active users for AF Supreme' },
  { key: 'rewardHoldDays', label: 'Days held before a free plan' },
  { key: 'rewardGraceDays', label: 'Grace days before losing it' },
  { key: 'paymentClearDays', label: 'Days before a payment counts' },
  { key: 'minPayoutCents', label: 'Minimum payout (cents)' },
  { key: 'maxCodeChangesPerYear', label: 'Code changes per year' },
]

export function AdminPartnerSettingsForm({ initial }: { initial: PartnerSettings }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, initial[f.key] == null ? '' : String(initial[f.key])])))
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const save = async () => {
    const settings: Record<string, unknown> = { ...values }
    const e = await post({ action: 'settings', settings })
    setMsg(e ? { ok: false, text: e } : { ok: true, text: 'Saved. New codes and checkouts use these now.' })
  }
  return (
    <div className="mt-3 flex flex-col gap-2.5">
      {FIELDS.map((f) => (
        <label key={f.key} className="flex items-center justify-between gap-3">
          <span>{f.label}</span>
          {f.kind === 'select' ? (
            <select value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} className="min-h-10 rounded-lg border border-[#3b3f6e] bg-[#0a0e1a] px-2.5 text-white">
              {f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ) : (
            <input inputMode="numeric" value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} className="min-h-10 w-24 rounded-lg border border-[#3b3f6e] bg-[#0a0e1a] px-2.5 text-white" />
          )}
        </label>
      ))}
      <button type="button" onClick={save} className="mt-1.5 min-h-11 rounded-xl bg-purple-500 font-bold text-white">Save settings</button>
      {msg ? <p className={`text-[13px] ${msg.ok ? 'text-emerald-400' : 'text-rose-300'}`}>{msg.text}</p> : null}
    </div>
  )
}
