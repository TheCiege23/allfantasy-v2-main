"use client"

import Link from "next/link"
import { Gift, Share2, Trophy } from "lucide-react"

interface ReferralCTACardProps {
  title?: string
  description?: string
  ctaLabel?: string
  ctaHref?: string
  variant?: "default" | "rewards" | "leaderboard"
  testId?: string
}

export function ReferralCTACard({
  title = "Share your referral link",
  description = "Earn rewards when friends sign up with your link.",
  ctaLabel = "Get your link",
  ctaHref = "/referral",
  variant = "default",
  testId,
}: ReferralCTACardProps) {
  const Icon = variant === "rewards" ? Gift : variant === "leaderboard" ? Trophy : Share2

  return (
    <div
      className="rounded-2xl border p-4 transition hover:opacity-95"
      style={{
        borderColor: "var(--border)",
        background:
          variant === "leaderboard"
            ? "color-mix(in srgb, var(--accent) 10%, transparent)"
            : "color-mix(in srgb, var(--panel) 72%, transparent)",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ background: "var(--accent)", color: "var(--bg)" }}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold" style={{ color: "var(--text)" }}>
            {title}
          </h3>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {description}
          </p>
          <Link
            href={ctaHref}
            data-testid={testId}
            className="mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
          >
            {ctaLabel}
          </Link>
        </div>
      </div>
    </div>
  )
}
