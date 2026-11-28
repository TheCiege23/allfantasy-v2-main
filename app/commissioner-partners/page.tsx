import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isPartnerCodesEnabled } from '@/lib/partner-codes/flags'
import { loadPartnerSettings } from '@/lib/partner-codes/service'
import { EarningsCalculator } from '@/components/partner-codes/EarningsCalculator'
import { getMonetizationCatalog } from '@/lib/monetization/catalog'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const metadata = {
  title: 'Commissioner Partner Program · AllFantasy',
  description: 'Make your own code. Friends save, you unlock free plans and earn cash every month.',
}

/**
 * Public explainer for the Commissioner Partner Program. Every number comes
 * from PartnerProgramSettings and the plan catalog, so it always matches the
 * real rules. (`/partners` is the B2B partner portal — a different product.)
 */
export default async function CommissionerPartnersPage() {
  if (!isPartnerCodesEnabled()) notFound()
  const s = await loadPartnerSettings()
  const prices = Object.fromEntries(getMonetizationCatalog().subscriptions.map((i) => [i.sku, Math.round(i.amountUsd * 100)]))
  const steps = [
    { t: 'Claim your code', b: 'Pick something your league will remember, like TheCiege.' },
    { t: 'Share it anywhere', b: 'League chat, group text, Discord, your podcast. One link does it.' },
    { t: 'Unlock rewards', b: `AF Commissioner free at ${s.freeCommissionerActiveUsers} active users, AF Supreme free at ${s.freeSupremeActiveUsers} (or ${s.freeSupremePaidSubs} paid), ${s.commissionPercent}% cash from ${s.cashThresholdPaidSubs} paid subscribers.` },
  ]
  return (
    <main className="min-h-dvh bg-[#0a0e1a] text-[#e8e9f5]">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-14 px-5 py-14">
        <section className="flex max-w-3xl flex-col gap-4">
          <span className="text-[13px] font-bold uppercase tracking-[0.08em] text-purple-300">Commissioner Partner Program</span>
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">Your league already listens to you. Get rewarded for it.</h1>
          <p className="text-lg text-[#c7cbe6]">
            Make your own code. Friends get {s.discountPercent}% off their first {s.discountMonths} months on the web. You unlock free plans as your people join, then earn {s.commissionPercent}% of what your paid subscribers pay, every month.
          </p>
          <div><Link href="/partner-code" className="inline-flex min-h-11 items-center rounded-xl bg-purple-500 px-5 font-bold text-white hover:bg-purple-400">Get my code</Link></div>
        </section>

        <section aria-labelledby="how-h" className="flex flex-col gap-5">
          <h2 id="how-h" className="text-2xl font-extrabold">How it works</h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {steps.map((x, i) => (
              <li key={x.t} className="flex flex-col gap-2 rounded-2xl border border-[#2a2f5a] bg-[#12163e] p-5">
                <span className="text-2xl font-extrabold text-purple-300">{i + 1}</span>
                <strong className="text-[17px]">{x.t}</strong>
                <span className="text-sm text-[#a3a8c9]">{x.b}</span>
              </li>
            ))}
          </ol>
        </section>

        <EarningsCalculator settings={s} prices={prices} />

        <section aria-labelledby="rules-h" className="flex max-w-3xl flex-col gap-3">
          <h2 id="rules-h" className="text-xl font-extrabold">The fine print, in plain words</h2>
          <ul className="list-disc space-y-2 pl-5 text-[#c7cbe6]">
            <li>A paid subscriber counts once their first payment is {s.paymentClearDays} days old with no refund.</li>
            <li>Cash is {s.commissionPercent}% of what your subscribers pay after payment fees and refunds, starting with payments after you reach {s.cashThresholdPaidSubs} paid subscribers.</li>
            <li>Yearly plans pay you 1/12 each month. Refunds come off your next statement.</li>
            <li>Free plans stay on while you keep that many users.</li>
            <li>The {s.discountPercent}% off is for subscribing on the web at allfantasy.ai. Friends who subscribe in the iPhone or Android app don't get it, but they still count for you and still earn you cash.</li>
            <li>You can't use your own code. We need your tax info (through Stripe) before we can send cash.</li>
          </ul>
          <p className="text-sm text-[#a3a8c9]">
            The full rules are in the{' '}
            <Link href="/commissioner-partners/terms" className="font-semibold text-purple-300 underline underline-offset-2">
              Commissioner Partner Program Terms
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  )
}
