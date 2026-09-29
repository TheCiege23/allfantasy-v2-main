"use client"

import { Pin } from "lucide-react"
import type { PlatformChatMessage } from "@/types/platform-shared"
import { getPinnedDisplayBody, getReferencedMessageIdFromPin } from "@/lib/league-chat"

type Props = {
  pinned: PlatformChatMessage[]
  onUnpin?: (pinMessageId: string) => void
  onSelectPinned?: (pinMessage: PlatformChatMessage, referencedMessageId: string) => void
  canUnpin?: boolean
  className?: string
}

export default function PinnedSection({
  pinned,
  onUnpin,
  onSelectPinned,
  canUnpin = false,
  className = "",
}: Props) {
  if (pinned.length === 0) return null

  return (
    <div
      className={`rounded-xl border px-3 py-2 ${className}`}
      style={{
        borderColor: "var(--border)",
        background: "color-mix(in srgb, var(--accent-cyan-strong) 6%, var(--panel))",
      }}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
        <Pin className="h-3 w-3" />
        Pinned
      </div>
      <ul className="mt-1.5 space-y-1.5">
        {pinned.map((m) => {
          const referencedMessageId = getReferencedMessageIdFromPin(m)
          const canSelect = Boolean(onSelectPinned && referencedMessageId)
          return (
            <li
              key={m.id}
              className="flex items-start justify-between gap-2 rounded-lg border px-2 py-1.5 text-[11px]"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              {canSelect ? (
                <button
                  type="button"
                  onClick={() => onSelectPinned?.(m, referencedMessageId!)}
                  className="min-w-0 flex-1 line-clamp-2 text-left hover:underline"
                  style={{ color: "var(--text)" }}
                  title="Jump to pinned message"
                >
                  {getPinnedDisplayBody(m)}
                </button>
              ) : (
                <span className="min-w-0 flex-1 line-clamp-2">{getPinnedDisplayBody(m)}</span>
              )}
              {canUnpin && onUnpin && (
                <button
                  type="button"
                  onClick={() => onUnpin(m.id)}
                  className="shrink-0 text-[11px] font-medium"
                  style={{ color: "var(--muted2)" }}
                >
                  Unpin
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
