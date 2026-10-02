"use client"

import { useState } from "react"
import {
  Check,
  Copy,
  Mail,
  MessageCircle,
  MessageSquare,
  Share2,
  Users,
} from "lucide-react"
import { buildInviteShareUrl } from "@/lib/invite-engine/shareUrls"
import type { InviteShareChannel } from "@/lib/invite-engine/types"
import { copyText } from "@/lib/clipboard/copyText"

const DEFAULT_MESSAGE = "Join me on AllFantasy for smarter fantasy tools, league intel, and coaching from Chimmy."

const CHANNELS: { key: InviteShareChannel; label: string; icon: typeof Copy; action: "copy" | "external" | "manual_copy" }[] = [
  { key: "copy_link", label: "Copy link", icon: Copy, action: "copy" },
  { key: "sms", label: "SMS", icon: MessageCircle, action: "external" },
  { key: "email", label: "Email", icon: Mail, action: "external" },
  { key: "twitter", label: "X", icon: Share2, action: "external" },
  { key: "discord", label: "Discord", icon: MessageSquare, action: "manual_copy" },
  { key: "reddit", label: "Reddit", icon: Users, action: "external" },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, action: "external" },
]

export interface ReferralShareBarProps {
  referralLink: string
  message?: string
  onShare?: (channel: InviteShareChannel) => void
  className?: string
  testIdPrefix?: string
}


export function ReferralShareBar({
  referralLink,
  message = DEFAULT_MESSAGE,
  onShare,
  className = "",
  testIdPrefix = "referral-share",
}: ReferralShareBarProps) {
  const [copiedChannel, setCopiedChannel] = useState<InviteShareChannel | null>(null)
  /*
   * Copy link and Discord used to RETURN on a failed copy — no message, no fallback, the button
   * simply did nothing, and in-app browsers (where invite links get opened) refuse the clipboard.
   * lib/clipboard/copyText now tries a second mechanism first; if that fails too, the link is shown
   * as tap-to-select text so it can still be copied by hand.
   */
  const [copyFailed, setCopyFailed] = useState(false)

  const logShare = (channel: InviteShareChannel) => {
    onShare?.(channel)
    fetch("/api/referral/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel }),
    }).catch(() => {})
  }

  const handleShare = async (channel: InviteShareChannel, action: "copy" | "external" | "manual_copy") => {
    if (action === "copy" || action === "manual_copy") {
      const copied = await copyText(referralLink)
      setCopyFailed(!copied)
      if (!copied) return
      setCopiedChannel(channel)
      logShare(channel)
      window.setTimeout(() => setCopiedChannel((current) => (current === channel ? null : current)), 2000)
      return
    }

    const url = buildInviteShareUrl(referralLink, channel, { message, subject: "Join me on AllFantasy" })
    logShare(channel)

    if (channel === "email" || channel === "sms") {
      window.location.href = url
      return
    }

    window.open(url, "_blank", "noopener,noreferrer")
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="mr-1 text-xs font-medium" style={{ color: "var(--muted)" }}>
        Share:
      </span>
      {CHANNELS.map(({ key, label, icon: Icon, action }) => {
        const copied = copiedChannel === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => void handleShare(key, action)}
            data-testid={`${testIdPrefix}-${key}`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-premium focus-ring"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            {copied ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
            {copied ? "Copied" : label}
          </button>
        )
      })}
      {copyFailed ? (
        <p className="basis-full text-xs" role="status" style={{ color: "var(--muted)" }} data-testid={`${testIdPrefix}-copy-fallback`}>
          Couldn&apos;t copy automatically. Press and hold (or select) the link to copy it:{" "}
          <span className="select-all break-all font-mono" style={{ color: "var(--text)" }}>
            {referralLink}
          </span>
        </p>
      ) : null}
    </div>
  )
}
