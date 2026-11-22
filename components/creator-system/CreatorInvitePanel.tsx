'use client'

import { useState } from 'react'
import { Check, Copy, Share2 } from 'lucide-react'

interface CreatorInvitePanelProps {
  inviteUrl: string
  inviteCode?: string
  onCopy?: () => void
  onShare?: () => void
}

export function CreatorInvitePanel({
  inviteUrl,
  inviteCode,
  onCopy,
  onShare,
}: CreatorInvitePanelProps) {
  const [copied, setCopied] = useState(false)
  const [shared, setShared] = useState(false)
  const nativeNavigator =
    typeof window !== 'undefined'
      ? (window.navigator as Navigator & { share?: (data?: ShareData) => Promise<void> })
      : null

  const handleCopy = async () => {
    if (!nativeNavigator?.clipboard) return
    await nativeNavigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    onCopy?.()
    setTimeout(() => setCopied(false), 1800)
  }

  const handleShare = async () => {
    if (nativeNavigator?.share) {
      try {
        await nativeNavigator.share({
          title: 'Join this creator league',
          url: inviteUrl,
        })
      } catch {
        if (nativeNavigator.clipboard) await nativeNavigator.clipboard.writeText(inviteUrl)
      }
    } else {
      if (nativeNavigator?.clipboard) await nativeNavigator.clipboard.writeText(inviteUrl)
    }

    setShared(true)
    onShare?.()
    setTimeout(() => setShared(false), 1800)
  }

  return (
    <div
      className="rounded-[28px] border p-5"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--panel) 75%, transparent)',
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
            Share invite link
          </h3>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Creator-safe share URL with direct join support.
          </p>
        </div>
        {inviteCode && (
          <div className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
            Invite code: <span style={{ color: 'var(--text)' }}>{inviteCode}</span>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          readOnly
          value={inviteUrl}
          className="min-w-0 flex-1 rounded-2xl border px-4 py-3 text-sm bg-transparent"
          style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
        />
        <button
          type="button"
          onClick={handleCopy}
          data-testid="creator-invite-copy-button"
          className="inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold"
          style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button
          type="button"
          onClick={handleShare}
          data-testid="creator-invite-share-button"
          className="inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold"
          style={{ background: 'var(--accent)', color: 'var(--bg)' }}
        >
          <Share2 className="h-4 w-4" />
          {shared ? 'Shared' : 'Share invite'}
        </button>
      </div>
    </div>
  )
}
