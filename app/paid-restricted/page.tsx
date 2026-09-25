import Link from "next/link"

import { CARD_PAID_LOCK_MESSAGE } from "@/lib/geo/cardLockCopy"
import { RESTRICTED_STATES } from "@/lib/geo/restrictedStates"

export const dynamic = "force-dynamic"

type PaidRestrictedParams = { state?: string; reason?: string }

export default async function PaidRestrictedPage({
  searchParams,
}: {
  searchParams?: Promise<PaidRestrictedParams> | PaidRestrictedParams
}) {
  const sp = searchParams instanceof Promise ? await searchParams : searchParams ?? {}

  /*
   * The card lock (lib/subscription/paidStateRefusal): this ACCOUNT, not this
   * connection, is kept off paid features, because a purchase on it used a
   * restricted state's billing address and was refunded. There is no state to
   * name — the lock records the fact, not the address.
   */
  if (sp.reason === "billing") {
    return (
      <main className="min-h-screen bg-gradient-to-b from-neutral-950 via-slate-950 to-neutral-950 px-4 py-12 text-white sm:px-6">
        <div className="mx-auto max-w-xl">
          <img src="/af-crest.png" alt="" className="mx-auto mb-6 h-16 w-16 object-contain opacity-90" />
          <h1 className="mb-3 text-center text-2xl font-black sm:text-3xl">🟡 Paid Features Aren&apos;t Available on This Account</h1>
          <p className="mb-8 text-center text-sm leading-7 text-white/70">{CARD_PAID_LOCK_MESSAGE}</p>
          <div className="mb-8 text-center">
            <Link href="/core" className="inline-flex rounded-xl bg-cyan-500/90 px-6 py-3 text-sm font-semibold text-slate-950">
              Keep using AllFantasy.ai for free →
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-4 text-sm">
            <a href="mailto:support@allfantasy.ai" className="text-cyan-400 hover:text-cyan-300">
              Contact Support
            </a>
            <Link href="/terms" className="text-cyan-400 hover:text-cyan-300">
              Terms of Service
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const code = typeof sp.state === "string" ? sp.state.toUpperCase() : "HI"
  const meta = RESTRICTED_STATES.find((s) => s.code === code && s.level === "paid_block")
  const stateName = meta?.name ?? code

  return (
    <main className="min-h-screen bg-gradient-to-b from-neutral-950 via-slate-950 to-neutral-950 px-4 py-12 text-white sm:px-6">
      <div className="mx-auto max-w-xl">
        <img src="/af-crest.png" alt="" className="mx-auto mb-6 h-16 w-16 object-contain opacity-90" />
        <h1 className="mb-3 text-center text-2xl font-black sm:text-3xl">
          🟡 Paid Leagues Are Not Available in {stateName}
        </h1>
        <p className="mb-8 text-center text-sm leading-7 text-white/70">
          You can use AllFantasy.ai for free — but due to {stateName} state law, we cannot allow participation in paid leagues,
          paid subscriptions, or any contest involving real money from your location.
        </p>

        <div className="mb-8 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5 text-sm">
          <p className="mb-3 font-semibold text-emerald-200">What you CAN do:</p>
          <ul className="space-y-2 text-emerald-100/90">
            <li>✅ Create a free account</li>
            <li>✅ Join and participate in free leagues</li>
            <li>✅ Use AI tools (Chimmy AI, Trade Analyzer, etc.)</li>
            <li>✅ Draft, set lineups, manage rosters</li>
            <li>✅ Compete for fun with friends</li>
          </ul>
        </div>

        <div className="mb-8 rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-sm">
          <p className="mb-3 font-semibold text-red-200">What is restricted in your state:</p>
          <ul className="space-y-2 text-red-100/90">
            <li>❌ Paid league entry fees</li>
            <li>❌ AF Pro or AF Commissioner subscriptions</li>
            <li>❌ Any contest with real money prizes</li>
          </ul>
        </div>

        <div className="mb-8 text-center">
          <Link
            href="/signup"
            className="inline-flex rounded-xl bg-cyan-500/90 px-6 py-3 text-sm font-semibold text-slate-950"
          >
            Continue with Free Account →
          </Link>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 text-xs leading-6 text-white/60">
          <p className="mb-2 font-semibold text-white/80">Why is this restricted?</p>
          <p>
            {meta?.details ??
              `${stateName} state law currently classifies paid fantasy sports contests as a form of illegal gambling. We comply with all state laws.`}
          </p>
          <p className="mt-3">
            <strong>Legal citation:</strong> {meta?.legalBasis ?? "See state gaming regulations."}
          </p>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-4 text-sm">
          <a href="mailto:support@allfantasy.ai" className="text-cyan-400 hover:text-cyan-300">
            Contact Support
          </a>
          <Link href="/terms" className="text-cyan-400 hover:text-cyan-300">
            Terms of Service
          </Link>
        </div>
      </div>
    </main>
  )
}
