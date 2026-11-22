"use client"

import { getAvatarPresetEmoji } from "@/lib/avatar"

interface IdentityImageRendererProps {
  avatarUrl?: string | null
  avatarPreset?: string | null
  displayName?: string | null
  username?: string | null
  size?: "sm" | "md" | "lg"
  className?: string
}

const sizeClasses = {
  sm: "h-8 w-8 text-sm",
  md: "h-12 w-12 text-lg",
  lg: "h-20 w-20 text-2xl",
}

/**
 * Renders user identity image: uploaded avatar, preset emoji, or initial.
 * Use in profile, settings, nav, chat, and anywhere user identity is shown.
 */
export function IdentityImageRenderer({
  avatarUrl,
  avatarPreset,
  displayName,
  username,
  size = "md",
  className = "",
}: IdentityImageRendererProps) {
  const initial = (displayName || username || "?").charAt(0).toUpperCase()
  const emoji = getAvatarPresetEmoji(avatarPreset)
  const sizeClass = sizeClasses[size]

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={`rounded-full object-cover ${sizeClass} ${className}`}
        style={{ borderColor: "var(--border)", borderWidth: 1 }}
      />
    )
  }

  if (emoji) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full border font-medium ${sizeClass} ${className}`}
        style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
      >
        {emoji}
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full border font-semibold ${sizeClass} ${className}`}
      style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
    >
      {initial}
    </span>
  )
}
