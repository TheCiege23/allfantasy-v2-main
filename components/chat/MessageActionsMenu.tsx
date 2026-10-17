"use client"

import { useState, useRef, useEffect } from "react"
import { useSession } from "next-auth/react"
import { MoreHorizontal, Flag, UserX, UserCheck } from "lucide-react"

type MessageActionsMenuProps = {
  messageId: string
  threadId: string
  senderUserId: string | null
  senderName: string
  isBlocked: boolean
  onReportMessage: () => void
  onReportUser: () => void
  onBlockUser: () => void
  onUnblockUser: () => void
  className?: string
}

export default function MessageActionsMenu({
  messageId,
  threadId,
  senderUserId,
  senderName,
  isBlocked,
  onReportMessage,
  onReportUser,
  onBlockUser,
  onUnblockUser,
  className = "",
}: MessageActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("click", close)
    return () => document.removeEventListener("click", close)
  }, [open])

  // Nothing here applies to your own message — it offered "Report <you>" and "Block <you>".
  // Read from the session, not a prop, so every caller (Messages, the home chat dock) is
  // covered; defensive like PostHogUserIdentifier. Same rule as MessageModerationMenu.
  const viewerId = (useSession()?.data?.user as { id?: string } | undefined)?.id ?? null
  if (senderUserId && viewerId && senderUserId === viewerId) return null

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        // A 44×44 tap target (Apple HIG) around a 14px icon. The -11px margins cancel the extra
        // size so the message header row keeps its 22px footprint and nothing around it moves.
        className="-m-[11px] inline-flex h-11 w-11 items-center justify-center rounded-full opacity-60 hover:opacity-100"
        style={{ color: "var(--muted)" }}
        aria-label="Message actions"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-lg border py-1 shadow-lg"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          <button
            type="button"
            onClick={() => { onReportMessage(); setOpen(false) }}
            className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm"
            style={{ color: "var(--text)" }}
          >
            <Flag className="h-3.5 w-3.5" />
            Report message
          </button>
          {senderUserId && (
            <button
              type="button"
              onClick={() => { onReportUser(); setOpen(false) }}
              className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm"
              style={{ color: "var(--text)" }}
            >
              <Flag className="h-3.5 w-3.5" />
              Report {senderName}
            </button>
          )}
          {senderUserId && (
            isBlocked ? (
              <button
                type="button"
                onClick={() => { onUnblockUser(); setOpen(false) }}
                className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm"
                style={{ color: "var(--text)" }}
              >
                <UserCheck className="h-3.5 w-3.5" />
                Unblock {senderName}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { onBlockUser(); setOpen(false) }}
                className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm"
                style={{ color: "var(--text)" }}
              >
                <UserX className="h-3.5 w-3.5" />
                Block {senderName}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
