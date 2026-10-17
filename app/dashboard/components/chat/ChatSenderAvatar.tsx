"use client"

import { useState } from "react"

function resolveSleeperAvatarUrl(value: string | null): string | null {
  if (!value) return null
  const v = value.trim()
  if (!v) return null
  if (v.startsWith("http://") || v.startsWith("https://") || v.startsWith("/")) {
    return v
  }
  return `https://sleepercdn.com/avatars/${v}`
}

/** First two letters for initials circle (spec: first 2 letters of display name). */
export function chatSenderInitials(displayName: string): string {
  const n = displayName.trim()
  if (!n) return "?"
  if (n.length >= 2) return n.slice(0, 2).toUpperCase()
  return (n[0]! + n[0]!).toUpperCase()
}

type ChatSenderAvatarProps = {
  authorAvatar: string | null
  authorDisplayName: string
  /** Pixel size (width/height). Default 32 (Chimmy); league chat uses 26. */
  size?: number
  className?: string
}

/**
 * Avatar: Sleeper CDN when hash/URL set; gradient initials on missing/broken image.
 */
export function ChatSenderAvatar({
  authorAvatar,
  authorDisplayName,
  size = 32,
  className = '',
}: ChatSenderAvatarProps) {
  const [broken, setBroken] = useState(false)
  const resolved = resolveSleeperAvatarUrl(authorAvatar)

  if (resolved && !broken) {
    return (
      <div
        className={`relative shrink-0 overflow-hidden rounded-full border border-white/[0.12] ${className}`}
        style={{ width: size, height: size }}
      >
        <img
          src={resolved}
          alt=""
          className="h-full w-full object-cover"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)' }}
          onError={() => setBroken(true)}
        />
      </div>
    )
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full border border-white/[0.12] bg-gradient-to-br from-indigo-500 to-cyan-500 text-[11px] font-bold uppercase text-white ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {chatSenderInitials(authorDisplayName)}
    </div>
  )
}
