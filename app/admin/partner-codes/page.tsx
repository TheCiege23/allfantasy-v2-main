import { redirect } from 'next/navigation'
import { getAdminAccessState } from '@/lib/adminAuth'
import { prisma } from '@/lib/prisma'
import { loadPartnerSettings } from '@/lib/partner-codes/service'
import { FLAG_COPY, type FlagReason } from '@/lib/partner-codes/fraud'
import { AdminLogoReview, AdminPartnerActions, AdminPartnerSettingsForm } from '@/components/partner-codes/AdminPartnerControls'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const metadata = { robots: { index: false, follow: false } }

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Commissioner Partner Codes admin: payouts to review, flagged signups, codes, settings. */
export default async function AdminPartnerCodesPage() {
  const gate = await getAdminAccessState()
  if (gate.status === 'unauthenticated') redirect('/admin-login?next=/admin/partner-codes')
  if (gate.status === 'forbidden') {
    return <main className="min-h-dvh bg-[#020817] p-8 text-white"><p className="text-rose-300">Forbidden — admin access required.</p></main>
  }

  const [settings, payouts, flagged, codes, logos] = await Promise.all([
    loadPartnerSettings(),
    prisma.partnerPayout.findMany({ where: { status: { in: ['pending_review', 'approved', 'held'] } }, orderBy: [{ periodMonth: 'desc' }, { totalCents: 'desc' }], take: 100, include: { partnerCode: { select: { code: true } } } }),
    prisma.partnerReferral.findMany({ where: { status: 'flagged' }, orderBy: { createdAt: 'desc' }, take: 100, include: { partnerCode: { select: { code: true } } } }),
    prisma.partnerCode.findMany({ orderBy: { paidSubsCount: 'desc' }, take: 50 }),
    prisma.partnerCode.findMany({ where: { logoStatus: 'pending', logoUrl: { not: null } }, orderBy: { updatedAt: 'asc' }, take: 50, select: { id: true, code: true, logoUrl: true } }),
  ])
  const tax = await prisma.partnerTaxProfile.findMany({ where: { ownerUserId: { in: payouts.map((p) => p.ownerUserId) } } })
  const taxBy = new Map(tax.map((t) => [t.ownerUserId, t.w9Status]))
  const connectBy = new Map(tax.map((t) => [t.ownerUserId, t.stripeAccountId ? t.stripeTransfersStatus ?? 'pending' : null]))
  const total = payouts.filter((p) => p.status !== 'held').reduce((a, p) => a + p.totalCents, 0)
  const panel = 'rounded-2xl border border-[#2a2f5a] bg-[#12163e] p-5'

  return (
    <main className="min-h-dvh bg-[#0a0e1a] text-sm text-[#e8e9f5]">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-5 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-extrabold">Partner Codes</h1>
          <a href={`/api/admin/partner-codes?export=csv&year=${new Date().getUTCFullYear()}`} className="inline-flex min-h-11 items-center rounded-xl border border-[#3b3f6e] px-4 font-semibold">Export CSV for taxes</a>
        </div>

        <section className={panel} aria-labelledby="pay-h">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="pay-h" className="text-lg font-bold">Payouts to review</h2>
            <span className="text-[#a3a8c9]">{payouts.length} statements · {money(total)} not held</span>
          </div>
          {payouts.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead><tr className="text-left text-[#a3a8c9]"><th scope="col" className="py-2 font-semibold">Code</th><th scope="col" className="py-2 font-semibold">Month</th><th scope="col" className="py-2 text-right font-semibold">Amount</th><th scope="col" className="py-2 font-semibold">Payout account</th><th scope="col" className="py-2 font-semibold">Status</th><th scope="col" className="py-2 text-right font-semibold">Actions</th></tr></thead>
                <tbody>
                  {payouts.map((p) => (
                    <tr key={p.id} className="border-t border-[#23284d]">
                      <th scope="row" className="py-3 text-left font-semibold">{p.partnerCode.code}{p.isDemo ? ' (demo)' : ''}</th>
                      <td className="py-3">{p.periodMonth}</td>
                      <td className="py-3 text-right font-bold">{money(p.totalCents)}</td>
                      <td className={`py-3 ${connectBy.get(p.ownerUserId) === 'active' ? 'text-emerald-400' : 'text-amber-300'}`}>
                        {connectBy.get(p.ownerUserId) === 'active' ? 'Stripe, ready' : connectBy.get(p.ownerUserId) ? 'Stripe, not ready' : taxBy.get(p.ownerUserId) && taxBy.get(p.ownerUserId) !== 'missing' ? 'Manual (W-9 on file)' : 'Not set up'}
                      </td>
                      <td className="py-3">
                        {p.status}{p.heldReason ? ` · ${p.heldReason}` : ''}
                        {p.transferError ? <div className="text-[12px] text-rose-300">{p.transferError}</div> : null}
                      </td>
                      <td className="py-2 text-right"><AdminPartnerActions kind="payout" id={p.id} status={p.status} sendsAutomatically={connectBy.get(p.ownerUserId) === 'active'} failed={!!p.transferError} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="mt-3 text-[#a3a8c9]">Nothing to review.</p>}
        </section>

        <section className={panel} aria-labelledby="logo-h">
          <h2 id="logo-h" className="text-lg font-bold">Logos to review <span className="text-amber-300">· {logos.length}</span></h2>
          <p className="mt-1 text-[#a3a8c9]">Nothing shows on a share image until you approve it. Reject team, league and brand logos, and anything not fit for a share image.</p>
          {logos.length ? (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {logos.map((l) => (
                <li key={l.id} className="flex items-center gap-3 rounded-xl border border-[#2a2f5a] bg-[#0a0e1a] p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={l.logoUrl!} alt={`Logo uploaded for ${l.code}`} width={80} height={80} className="h-20 w-20 rounded-lg bg-white/5 object-cover" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <strong className="truncate">{l.code}</strong>
                    <AdminLogoReview partnerCodeId={l.id} />
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-[#a3a8c9]">None waiting.</p>}
        </section>

        <div className="flex flex-wrap gap-6">
          <section className={`${panel} min-w-0 flex-[999_1_560px]`} aria-labelledby="flag-h">
            <h2 id="flag-h" className="text-lg font-bold">Flagged signups <span className="text-amber-300">· {flagged.length}</span></h2>
            <p className="mt-1 text-[#a3a8c9]">These don't count on any meter or earn commission until you clear them.</p>
            <ul className="mt-3 flex flex-col gap-2.5">
              {flagged.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#2a2f5a] bg-[#0a0e1a] px-3.5 py-3">
                  <div className="min-w-0 flex-[1_1_260px]">
                    <strong>{r.partnerCode.code}</strong> · {r.plan ?? 'no plan yet'}
                    <div className="text-[13px] text-[#a3a8c9]">{r.flagReasons.map((f) => FLAG_COPY[f as FlagReason] ?? f).join(' · ')}</div>
                  </div>
                  <AdminPartnerActions kind="referral" id={r.id} status={r.status} />
                </li>
              ))}
              {!flagged.length ? <li className="text-[#a3a8c9]">None.</li> : null}
            </ul>
          </section>
          <section className={`${panel} min-w-0 flex-[1_1_340px]`} aria-labelledby="set-h">
            <h2 id="set-h" className="text-lg font-bold">Program settings</h2>
            <AdminPartnerSettingsForm initial={settings} />
          </section>
        </div>

        <section className={panel} aria-labelledby="codes-h">
          <h2 id="codes-h" className="text-lg font-bold">Top codes</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead><tr className="text-left text-[#a3a8c9]"><th scope="col" className="py-2 font-semibold">Code</th><th scope="col" className="py-2 text-right font-semibold">Paid</th><th scope="col" className="py-2 text-right font-semibold">Active</th><th scope="col" className="py-2 font-semibold">Free plan</th><th scope="col" className="py-2 font-semibold">Cash</th></tr></thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.id} className="border-t border-[#23284d]">
                    <th scope="row" className="py-2.5 text-left font-semibold">{c.code}{c.isDemo ? ' (demo)' : ''}</th>
                    <td className="py-2.5 text-right">{c.paidSubsCount}</td>
                    <td className="py-2.5 text-right">{c.activeUsersCount}</td>
                    <td className="py-2.5">{c.freePlan}</td>
                    <td className="py-2.5">{c.cashUnlockedAt ? `on since ${c.cashUnlockedAt.toISOString().slice(0, 10)}` : 'not yet'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}
