"use client"

import { useState } from "react"
import { Copy, Check, Share2, MessageCircle, Mail, MessageSquare } from "lucide-react"
import { buildInviteShareUrl } from "@/lib/league-invite/buildInviteShareUrl"

const DEFAULT_MESSAGE = "Join my bracket pool on AllFantasy!"

interface LeagueInviteShareButtonsProps {
  inviteUrl: string
  message?: string
  className?: string
}

export function LeagueInviteShareButtons({
  inviteUrl,
  message = DEFAULT_MESSAGE,
  className = "",
}: LeagueInviteShareButtonsProps) {
  const [copied, setCopied] = useState(false)

  function copyLink() {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function nativeShare() {
    if (navigator.share) {
      navigator.share({ title: "Join my bracket pool!", text: message, url: inviteUrl })
    } else {
      copyLink()
    }
  }

  const shareStyle = "p-2 rounded-lg transition hover:opacity-90"
  const iconStyle = "rgba(251,146,60,0.15)"
  const iconColor = "#fb923c"

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={copyLink}
        className={shareStyle}
        style={{ background: iconStyle, color: iconColor }}
        title="Copy link"
        aria-label="Copy invite link"
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      </button>
      <a
        href={buildInviteShareUrl(inviteUrl, "sms", { message })}
        target="_blank"
        rel="noopener noreferrer"
        className={shareStyle}
        style={{ background: iconStyle, color: iconColor }}
        title="Share via SMS"
        aria-label="Share via SMS"
      >
        <MessageCircle className="w-4 h-4" />
      </a>
      <a
        href={buildInviteShareUrl(inviteUrl, "email", { message, subject: "Join my bracket pool" })}
        target="_blank"
        rel="noopener noreferrer"
        className={shareStyle}
        style={{ background: iconStyle, color: iconColor }}
        title="Share via email"
        aria-label="Share via email"
      >
        <Mail className="w-4 h-4" />
      </a>
      <a
        href={buildInviteShareUrl(inviteUrl, "twitter", { message })}
        target="_blank"
        rel="noopener noreferrer"
        className={shareStyle}
        style={{ background: iconStyle, color: iconColor }}
        title="Share on X (Twitter)"
        aria-label="Share on X (Twitter)"
      >
        <MessageSquare className="w-4 h-4" />
      </a>
      <a
        href={buildInviteShareUrl(inviteUrl, "reddit", { message })}
        target="_blank"
        rel="noopener noreferrer"
        className={shareStyle}
        style={{ background: iconStyle, color: iconColor }}
        title="Share on Reddit"
        aria-label="Share on Reddit"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.88-7.004 4.88-3.874 0-7.004-2.186-7.004-4.88 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.43.126 2.43-.126 0-.15-.072-.285-.172-.386a.326.326 0 0 0-.464 0 .33.33 0 0 0-.095.23.33.33 0 0 0 .094.231c.27.27.27.708 0 .979-.27.27-.709.27-.979 0a.33.33 0 0 0-.231-.095z" />
        </svg>
      </a>
      <button
        type="button"
        onClick={copyLink}
        className={shareStyle}
        style={{ background: iconStyle, color: iconColor }}
        title="Copy link (paste in Discord)"
        aria-label="Copy link for Discord"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
      </button>
      <button
        type="button"
        onClick={nativeShare}
        className={shareStyle}
        style={{ background: iconStyle, color: iconColor }}
        title="Share"
        aria-label="Share"
      >
        <Share2 className="w-4 h-4" />
      </button>
    </div>
  )
}
