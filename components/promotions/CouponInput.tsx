"use client"

import { useState, useCallback } from "react"
import { CheckCircle2, Loader2, Tag, X } from "lucide-react"

type CouponState =
  | { status: "idle" }
  | { status: "validating" }
  | {
      status: "applied"
      normalizedCode: string
      displayCode: string
      discountPercent: number
      stripePrefillCode: string
      subtotalCents: number | null
      discountAmountCents: number | null
      totalCents: number | null
    }
  | { status: "error"; reason: "not_found" | "already_used" | "not_applicable" | "requires_auth" | "inactive" | "unknown" }

type Props = {
  /** "token_pack" | "subscription" */
  productType: "token_pack" | "subscription"
  /** Optional SKU — enables price preview in validation response */
  sku?: string
  /** Called when a coupon is successfully applied */
  onApplied?: (couponCode: string, discountPercent: number) => void
  /** Called when a coupon is removed */
  onRemoved?: () => void
  /** Optional placeholder — defaults to "WassupFred" */
  placeholder?: string
  className?: string
}

function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

const ERROR_MESSAGES: Record<string, string> = {
  not_found: "Code not found. Check spelling and try again.",
  already_used: "This code has already been used on your account.",
  not_applicable: "This code doesn't apply to this product.",
  requires_auth: "Sign in to use this one-time sponsor code.",
  inactive: "This code is no longer active.",
  unknown: "Could not apply code. Please try again.",
}

export default function CouponInput({
  productType,
  sku,
  onApplied,
  onRemoved,
  placeholder = "WassupFred",
  className = "",
}: Props) {
  const [inputValue, setInputValue] = useState("")
  const [couponState, setCouponState] = useState<CouponState>({ status: "idle" })

  const handleApply = useCallback(async () => {
    const code = inputValue.trim()
    if (!code) return

    setCouponState({ status: "validating" })

    try {
      const res = await fetch("/api/coupons/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, productType, sku }),
      })

      if (res.status === 401) {
        setCouponState({ status: "error", reason: "requires_auth" })
        return
      }

      const data = await res.json()

      if (!data.valid) {
        setCouponState({
          status: "error",
          reason: data.reason ?? "unknown",
        })
        return
      }

      setCouponState({
        status: "applied",
        normalizedCode: data.normalizedCode,
        displayCode: data.displayCode,
        discountPercent: data.discountPercent,
        stripePrefillCode: data.stripePrefillCode,
        subtotalCents: data.subtotalCents ?? null,
        discountAmountCents: data.discountAmountCents ?? null,
        totalCents: data.totalCents ?? null,
      })

      onApplied?.(data.normalizedCode, data.discountPercent)
    } catch {
      setCouponState({ status: "error", reason: "unknown" })
    }
  }, [inputValue, productType, sku, onApplied])

  const handleRemove = useCallback(() => {
    setCouponState({ status: "idle" })
    setInputValue("")
    onRemoved?.()
  }, [onRemoved])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault()
        handleApply()
      }
    },
    [handleApply]
  )

  // ── Applied state ─────────────────────────────────────────────────────────

  if (couponState.status === "applied") {
    return (
      <div className={`rounded-xl border border-emerald-400/30 bg-emerald-400/[0.07] p-3 ${className}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span className="text-sm font-bold text-emerald-300">
              {couponState.displayCode} applied — {couponState.discountPercent}% off your first purchase
            </span>
          </div>
          <button
            type="button"
            onClick={handleRemove}
            aria-label="Remove coupon"
            className="shrink-0 rounded-lg p-1 text-white/40 transition hover:text-white/70"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Price breakdown */}
        {couponState.subtotalCents != null && couponState.discountAmountCents != null && couponState.totalCents != null && (
          <div className="mt-2 space-y-1 border-t border-white/10 pt-2 text-xs">
            <div className="flex justify-between text-white/55">
              <span>Subtotal</span>
              <span>{centsToUsd(couponState.subtotalCents)}</span>
            </div>
            <div className="flex justify-between text-emerald-400">
              <span>Discount ({couponState.discountPercent}%)</span>
              <span>−{centsToUsd(couponState.discountAmountCents)}</span>
            </div>
            <div className="flex justify-between font-bold text-white">
              <span>Total due today</span>
              <span>{centsToUsd(couponState.totalCents)}</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Input state ───────────────────────────────────────────────────────────

  return (
    <div className={`space-y-1.5 ${className}`}>
      <label className="flex items-center gap-1.5 text-xs font-bold text-white/55">
        <Tag className="h-3 w-3" />
        Sponsor or promo code
      </label>

      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value)
            if (couponState.status === "error") setCouponState({ status: "idle" })
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="flex-1 min-h-10 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder-white/30 transition focus:border-cyan-300/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
        />
        <button
          type="button"
          onClick={handleApply}
          disabled={!inputValue.trim() || couponState.status === "validating"}
          className="min-h-10 rounded-xl bg-white/[0.08] px-4 text-sm font-black text-white/80 transition hover:bg-white/[0.14] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {couponState.status === "validating" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Apply"
          )}
        </button>
      </div>

      {/* Error message */}
      {couponState.status === "error" && (
        <p className="text-xs text-red-400">
          {ERROR_MESSAGES[couponState.reason] ?? ERROR_MESSAGES.unknown}
        </p>
      )}
    </div>
  )
}
