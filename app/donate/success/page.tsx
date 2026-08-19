"use client"

import { Suspense, useMemo, useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { useEntitlement } from "@/hooks/useEntitlement"
import { useTokenBalance } from "@/hooks/useTokenBalance"

function getMode(searchParams: URLSearchParams | null): "donate" | "lab" {
  if (!searchParams) return "donate"
  return searchParams?.get("mode") === "lab" ? "lab" : "donate"
}

function DonateSuccessContent() {
  const searchParams = useSearchParams()
  const mode = useMemo(() => getMode(searchParams), [searchParams])
  const { refetch: refetchEntitlement } = useEntitlement()
  const { refetch: refetchTokens } = useTokenBalance()
  const didRefetch = useRef(false)

  // After Stripe redirect we land with ?mode=donate|lab; refetch entitlement + tokens so UI shows updated state
  useEffect(() => {
    if (didRefetch.current || !searchParams?.get("mode")) return
    didRefetch.current = true
    refetchEntitlement()
    refetchTokens()
  }, [searchParams, refetchEntitlement, refetchTokens])
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-white">
      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
          <div className="text-xs text-white/60">Thanks for stopping by Stripe checkout</div>
          <h1 className="mt-3 text-2xl font-semibold">
            {mode === "lab" ? "Bracket Lab Pass" : "Thank you for supporting"}
          </h1>
          <p className="mt-2 text-white/70">
            {mode === "lab"
              ? "If your payment just completed, the Lab dashboard will reflect it — this page can't independently verify a specific charge, so check the Lab dashboard directly."
              : "Your support helps fund performance, data costs, and new features. If your payment just completed, this page can't independently verify a specific charge — contact support if anything looks off."}
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a
              href="/lab"
              className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 py-3 font-semibold hover:bg-white/10"
            >
              Go to Lab
            </a>
            <a
              href="/"
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-5 py-3 font-semibold text-slate-950 hover:opacity-95"
            >
              Back to Brackets
            </a>
          </div>

          <p className="mt-6 text-xs text-white/55">
            Bracket Lab is a research/visualization tool. No guarantees. FanCred Brackets does not collect entry fees or pay prizes.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function DonateSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-white flex items-center justify-center">
          <div className="text-white/60">Loading...</div>
        </div>
      }
    >
      <DonateSuccessContent />
    </Suspense>
  )
}

