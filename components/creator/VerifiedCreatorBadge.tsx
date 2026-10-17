"use client"

import { BadgeCheck } from "lucide-react"
import Link from "next/link"

export interface VerifiedCreatorBadgeProps {
  handle: string
  displayName?: string | null
  badge?: string | null
  size?: "sm" | "md"
  showLabel?: boolean
  linkToProfile?: boolean
  className?: string
}

export function VerifiedCreatorBadge({
  handle,
  displayName,
  badge,
  size = "sm",
  showLabel = true,
  linkToProfile = true,
  className = "",
}: VerifiedCreatorBadgeProps) {
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"
  const textSize = size === "sm" ? "text-[11px]" : "text-xs"

  const badgeLabel = badge?.trim().toLowerCase() === "partner" ? "Partner Creator" : "Verified Creator"

  const content = (
    <span
      data-testid="creator-verified-badge"
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${textSize} ${className}`}
      style={{
        background: "color-mix(in srgb, #3b82f6 14%, transparent)",
        color: "#60a5fa",
        border: "1px solid color-mix(in srgb, #3b82f6 35%, transparent)",
      }}
    >
      <BadgeCheck className={iconSize} />
      {showLabel && <span>{badgeLabel}</span>}
    </span>
  )

  if (linkToProfile && handle) {
    return (
      <Link href={`/creators/${encodeURIComponent(handle)}`} className="hover:opacity-90 transition">
        {content}
      </Link>
    )
  }
  return content
}
