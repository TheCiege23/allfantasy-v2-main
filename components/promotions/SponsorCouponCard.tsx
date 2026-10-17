"use client"

/**
 * SponsorCouponCard — WassupFred 20% launch offer
 *
 * Two variants:
 *  - compact (strip): inline bar with copy + claim CTAs
 *  - full (card):     premium card with glow, copy + claim CTAs
 *
 * Deploy on: WC landing page, pricing page, insufficient-token modal,
 * WC upsell sections, dashboard wallet.
 */

import { useState, useEffect } from "react"
import Link from "next/link"
import { Check, Copy, Tag, Zap } from "lucide-react"

type SponsorCouponCardProps = {
  /** Link destination when "Claim 20% Off" is clicked. Defaults to /pricing */
  href?: string
  /** Surface name for analytics events */
  surface: string
  /** Show compact inline strip instead of full card */
  compact?: boolean
  /** Extra Tailwind classes on the root element */
  className?: string
  /** Callbacks for external analytics hooks */
  onView?: () => void
  onCopyClicked?: () => void
  onClaimClicked?: () => void
}

const CODE = "WassupFred"
const NORMALIZED = "WASSUPFRED"

export default function SponsorCouponCard({
  href = "/pricing",
  surface,
  compact = false,
  className = "",
  onView,
  onCopyClicked,
  onClaimClicked,
}: SponsorCouponCardProps) {
  const [copied, setCopied] = useState(false)

  // Fire view once on mount
  useEffect(() => {
    onView?.()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleCopy(e: React.MouseEvent) {
    e.preventDefault()
    onCopyClicked?.()
    navigator.clipboard.writeText(NORMALIZED).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2200)
  }

  function handleClaim() {
    onClaimClicked?.()
  }

  // ── Compact strip variant ─────────────────────────────────────────────────

  if (compact) {
    return (
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-2.5 ${className}`}
        data-testid="sponsor-coupon-strip"
      >
        <Tag className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />
        <p className="flex-1 text-xs text-white/70">
          <span className="font-black text-amber-200">Sponsor launch offer</span>
          {" — "}use code{" "}
          <span className="font-black text-amber-200">{CODE}</span>
          {" for "}
          <span className="font-black text-white">20% off</span>
          {" "}your first tokens or subscription
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Code copied" : "Copy WassupFred code"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-xs font-bold text-amber-200 transition hover:bg-amber-300/20 active:scale-[0.97]"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied!" : "Copy code"}
          </button>
          <Link
            href={href}
            onClick={handleClaim}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-amber-200 to-amber-400 px-2.5 py-1 text-xs font-black text-slate-950 shadow-[0_4px_14px_-4px_rgba(251,191,36,0.5)] transition hover:scale-[1.015] active:scale-[0.97]"
          >
            <Zap className="h-3 w-3" />
            Claim 20% Off
          </Link>
        </div>
      </div>
    )
  }

  // ── Full card variant ─────────────────────────────────────────────────────

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-amber-300/25 bg-gradient-to-br from-amber-300/[0.10] via-slate-950/70 to-slate-950 p-5 sm:p-6 ${className}`}
      data-testid="sponsor-coupon-card"
    >
      {/* Glow */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-amber-300/10 blur-3xl" aria-hidden />

      <div className="relative">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <span
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-300/30 bg-amber-300/10 shadow-[0_0_20px_-5px_rgba(251,191,36,0.35)]"
            aria-hidden
          >
            <Tag className="h-4 w-4 text-amber-300" />
          </span>
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.20em] text-amber-300/80">Sponsor Offer</div>
            <div className="text-sm font-black text-white">WassupFred × AllFantasy</div>
          </div>
        </div>

        {/* Body */}
        <p className="text-sm leading-6 text-white/70">
          Use code{" "}
          <span className="rounded bg-amber-300/10 px-1.5 py-0.5 font-black text-amber-200">{CODE}</span>
          {" for "}
          <span className="font-black text-white">20% off</span>
          {" "}your first token pack or subscription.
        </p>
        <p className="mt-1 text-xs text-white/40">
          One-time use per account · Launch period only · All plans eligible
        </p>

        {/* CTAs */}
        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Code copied" : "Copy WassupFred code"}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-amber-300/30 bg-amber-300/10 py-3 text-sm font-black text-amber-200 transition hover:bg-amber-300/20 active:scale-[0.98]"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Code copied!" : "Copy WassupFred"}
          </button>
          <Link
            href={href}
            onClick={handleClaim}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-amber-200 to-amber-400 py-3 text-sm font-black text-slate-950 shadow-[0_8px_28px_-8px_rgba(251,191,36,0.55)] transition hover:scale-[1.015] active:scale-[0.98]"
          >
            <Zap className="h-4 w-4" />
            Claim 20% Off
          </Link>
        </div>
      </div>
    </div>
  )
}
