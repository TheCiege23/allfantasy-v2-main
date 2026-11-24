'use client'

import { useMemo, useState } from 'react'
import type { PartnerSettings } from '@/lib/partner-codes/settings'

const MIXES = {
  pro: { label: 'Mostly Pro', share: [0.7, 0.2, 0.1] },
  balanced: { label: 'Balanced', share: [0.48, 0.32, 0.2] },
  supreme: { label: 'Mostly Supreme', share: [0.25, 0.25, 0.5] },
} as const
type MixKey = keyof typeof MIXES

/** Rough card-fee estimate for the "after fees" figure: 2.9% + 30¢ a payment. */
const feeCents = (cents: number) => Math.round(cents * 0.029) + 30

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * /commissioner-partners earnings calculator. Uses the live settings and plan
 * prices passed from the server, so it can't drift from the real rules.
 */
export function EarningsCalculator({ settings: s, prices }: { settings: PartnerSettings; prices: Record<string, number> }) {
  const [paid, setPaid] = useState(40)
  const [active, setActive] = useState(60)
  const [mix, setMix] = useState<MixKey>('balanced')
  const [yearlyPct, setYearlyPct] = useState(15)

  const r = useMemo(() => {
    const monthly = [prices.af_pro_monthly ?? 999, prices.af_commissioner_monthly ?? 1499, prices.af_supreme_monthly ?? 1999]
    const yearly = [prices.af_pro_yearly ?? 7999, prices.af_commissioner_yearly ?? 12999, prices.af_supreme_yearly ?? 15999]
    const y = yearlyPct / 100
    // Average monthly-equivalent payment per subscriber, and its fee.
    let avgCents = 0
    let avgFee = 0
    MIXES[mix].share.forEach((share, i) => {
      avgCents += share * ((1 - y) * monthly[i] + (y * yearly[i]) / 12)
      avgFee += share * ((1 - y) * feeCents(monthly[i]) + (y * feeCents(yearly[i])) / 12)
    })
    const basis = s.commissionBasis === 'net' ? avgCents - avgFee : avgCents
    const cashOn = paid >= s.cashThresholdPaidSubs
    const monthlyCommission = cashOn ? Math.round((basis * paid * s.commissionPercent) / 100) : 0
    const totalActive = Math.max(active, paid)
    const freePlan =
      totalActive >= s.freeSupremeActiveUsers || paid >= s.freeSupremePaidSubs
        ? 'AF Supreme free'
        : totalActive >= s.freeCommissionerActiveUsers
          ? 'AF Commissioner free'
          : null
    return { monthlyCommission, cashOn, freePlan, revenue: Math.round(avgCents * paid), freeValue: freePlan === 'AF Supreme free' ? monthly[2] : freePlan ? monthly[1] : 0 }
  }, [paid, active, mix, yearlyPct, prices, s])

  const slider = 'h-7 w-full accent-purple-500'
  return (
    <section aria-labelledby="calc-h" className="flex flex-wrap gap-10 rounded-3xl border border-[#2a2f5a] bg-[#12163e] p-6 sm:p-8">
      <div className="flex min-w-0 flex-[999_1_420px] flex-col gap-6">
        <h2 id="calc-h" className="text-2xl font-extrabold">Earnings calculator</h2>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between"><label htmlFor="calc-paid" className="font-semibold">Paid subscribers on your code</label><span className="font-extrabold text-white">{paid}</span></div>
          <input id="calc-paid" type="range" min={0} max={500} step={1} value={paid} onChange={(e) => setPaid(Number(e.target.value))} className={slider} />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between"><label htmlFor="calc-active" className="font-semibold">Active users (free or paid)</label><span className="font-extrabold text-white">{Math.max(active, paid)}</span></div>
          <input id="calc-active" type="range" min={0} max={500} step={1} value={active} onChange={(e) => setActive(Number(e.target.value))} className={slider} />
        </div>
        <fieldset>
          <legend className="mb-2.5 font-semibold">Plan mix</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(MIXES) as MixKey[]).map((k) => (
              <button key={k} type="button" aria-pressed={mix === k} onClick={() => setMix(k)} className={`min-h-11 rounded-xl px-4 font-semibold ${mix === k ? 'border border-purple-500 bg-[#2a1f4d] text-white' : 'border border-[#3b3f6e] text-[#c7cbe6]'}`}>
                {MIXES[k].label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between"><label htmlFor="calc-yearly" className="font-semibold">Pay yearly</label><span className="font-extrabold text-white">{yearlyPct}%</span></div>
          <input id="calc-yearly" type="range" min={0} max={100} step={5} value={yearlyPct} onChange={(e) => setYearlyPct(Number(e.target.value))} className={slider} />
        </div>
      </div>
      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
        <div className="flex flex-col gap-1 rounded-2xl border border-violet-600 bg-[#0a0e1a] p-6">
          <span className="text-sm text-[#a3a8c9]">You'd earn each month</span>
          <span className="text-[44px] font-extrabold leading-tight text-white">{money(r.monthlyCommission)}</span>
          <span className={`text-sm font-semibold ${r.cashOn ? 'text-emerald-400' : 'text-purple-200'}`}>
            {r.cashOn ? `${s.commissionPercent}% of about ${money(r.revenue)} a month, after fees` : `${s.cashThresholdPaidSubs - paid} more paid subscribers to start cash`}
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded-2xl border border-[#2a2f5a] bg-[#0a0e1a] p-5">
          <span className="text-sm text-[#a3a8c9]">Free plan unlocked</span>
          <span className="text-xl font-extrabold text-purple-50">{r.freePlan ?? `Not yet: ${s.freeCommissionerActiveUsers} active users to start`}</span>
          {r.freePlan ? <span className="text-[13px] text-[#a3a8c9]">Worth {money(r.freeValue)} a month</span> : null}
        </div>
        <div className="flex flex-col gap-1 rounded-2xl border border-[#2a2f5a] bg-[#0a0e1a] p-5">
          <span className="text-sm text-[#a3a8c9]">Your friends save</span>
          <span className="text-xl font-extrabold text-purple-50">{s.discountPercent}% for {s.discountMonths} months</span>
        </div>
        <p className="text-xs text-[#a3a8c9]">An estimate. Fees and refunds vary; your statement shows the real numbers.</p>
      </div>
    </section>
  )
}
