"use client"

import { useMemo, useState } from "react"

type Mode = "donate" | "lab"
const DONATION_PRESETS = [3, 5, 10, 25]

function getModeFromSearch(): Mode {
  if (typeof window === "undefined") return "donate"
  return new URLSearchParams(window.location.search).get("mode") === "lab" ? "lab" : "donate"
}

export default function DonatePage() {
  const mode = useMemo(getModeFromSearch, [])
  const [amount, setAmount] = useState<number>(mode === "lab" ? 9.99 : 5)
  const [custom, setCustom] = useState<string>("")
  const [loading, setLoading] = useState(false)

  async function startCheckout(finalAmount: number) {
    setLoading(true)
    try {
      const res = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, amount: finalAmount, currency: "usd" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "Failed")
      window.location.href = data.url
    } catch (e: any) {
      alert(e?.message ?? "Checkout failed")
      setLoading(false)
    }
  }

  const title = mode === "lab" ? "Get Bracket Lab Pass" : "Support AllFantasy"
  const subtitle =
    mode === "lab"
      ? "Unlock simulation + strategy exploration tools for this tournament."
      : "Optional support to fund servers, data costs, and performance."

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-white">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <a href="/" className="text-sm text-white/70 hover:text-white">
          &larr; Back to AllFantasy
        </a>

        <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-8">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-2 text-white/70">{subtitle}</p>

          <div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/40 p-5">
            <div className="text-sm font-semibold">Amount</div>

            {mode === "donate" ? (
              <>
                <div className="mt-4 flex flex-wrap gap-2">
                  {DONATION_PRESETS.map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        setAmount(p)
                        setCustom("")
                      }}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                        amount === p && custom === ""
                          ? "bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-950"
                          : "border border-white/15 bg-white/5 hover:bg-white/10"
                      }`}
                    >
                      ${p}
                    </button>
                  ))}
                </div>

                <input
                  value={custom}
                  onChange={(e) => {
                    setCustom(e.target.value)
                    const num = Number(e.target.value)
                    if (!Number.isNaN(num) && num > 0) setAmount(num)
                  }}
                  placeholder="Custom donation (e.g. 12)"
                  className="mt-4 w-full rounded-xl border border-white/15 bg-slate-950/40 px-4 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25"
                />
              </>
            ) : (
              <div className="mt-4 text-lg font-semibold">$9.99</div>
            )}

            <button
              disabled={loading}
              onClick={() => startCheckout(mode === "lab" ? 9.99 : amount)}
              className="mt-6 w-full rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:opacity-95 disabled:opacity-60"
            >
              {loading ? "Redirecting\u2026" : "Continue to Checkout"}
            </button>

            <p className="mt-4 text-xs text-white/55">
              {mode === "lab"
                ? "Bracket Lab is a research/visualization tool and does not guarantee outcomes."
                : "Donations are optional and do not unlock competitive advantages."}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
