'use client'

import { useMemo, useState } from 'react'
import { Check, Copy, Mail, MessageCircle, Share2 } from 'lucide-react'
import { buildInviteShareTargets } from '@/lib/invite-engine/shareUrls'
import type { InviteShareChannel, InviteShareTargetDto } from '@/lib/invite-engine/types'
import { ShareModal } from '@/components/share'
import { useShareModal } from '@/hooks/useShareModal'
import type { ShareDestination, ShareableKind, ShareVisibility } from '@/lib/share-engine/types'

interface InviteShareSheetProps {
  inviteUrl: string
  inviteLinkId?: string
  token?: string
  message?: string
  title?: string
  sport?: string
  weekOrRound?: string
  visibility?: ShareVisibility
  onShare?: (channel: InviteShareChannel) => void
  shareKind?: ShareableKind
  testIdPrefix?: string
}

const ICONS: Record<InviteShareChannel, typeof Copy> = {
  copy_link: Copy,
  sms: MessageCircle,
  email: Mail,
  twitter: Share2,
  discord: MessageCircle,
  reddit: Share2,
  whatsapp: MessageCircle,
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {}

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'absolute'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const successful = document.execCommand('copy')
    document.body.removeChild(textarea)
    return successful
  } catch {
    return false
  }
}

export function InviteShareSheet({
  inviteUrl,
  inviteLinkId,
  token,
  message = 'Join me on AllFantasy!',
  title = 'Join me on AllFantasy!',
  sport,
  weekOrRound,
  visibility = 'invite_only',
  onShare,
  shareKind = 'league_invite',
  testIdPrefix = 'invite-share',
}: InviteShareSheetProps) {
  const shareModal = useShareModal()
  const [feedbackByChannel, setFeedbackByChannel] = useState<Record<string, string>>({})

  const targets = useMemo(
    () => buildInviteShareTargets(inviteUrl, { message, subject: 'Join me on AllFantasy' }),
    [inviteUrl, message]
  )

  const setFeedback = (channel: InviteShareChannel, messageText: string) => {
    setFeedbackByChannel((current) => ({ ...current, [channel]: messageText }))
    window.setTimeout(() => {
      setFeedbackByChannel((current) => {
        const next = { ...current }
        delete next[channel]
        return next
      })
    }, 2000)
  }

  const logShare = (channel: InviteShareChannel) => {
    onShare?.(channel)
    fetch('/api/invite/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteLinkId, token, channel }),
    }).catch(() => {})
  }

  const mapDestinationToInviteChannel = (destination: ShareDestination): InviteShareChannel | null => {
    switch (destination) {
      case 'copy_link':
        return 'copy_link'
      case 'x':
        return 'twitter'
      case 'discord':
        return 'discord'
      case 'reddit':
        return 'reddit'
      case 'email':
        return 'email'
      case 'sms':
        return 'sms'
      case 'native_share':
        return 'copy_link'
      default:
        return null
    }
  }

  const handleCopyTarget = async (target: InviteShareTargetDto) => {
    const copied = await copyToClipboard(inviteUrl)
    const successLabel = target.channel === 'discord' ? 'Copied for Discord' : 'Copied!'
    setFeedback(target.channel, copied ? successLabel : 'Copy failed')
    logShare(target.channel)
  }

  const openPremiumShare = () => {
    shareModal.openShare({
      kind: shareKind,
      url: inviteUrl,
      title,
      description: message,
      sport,
      weekOrRound,
      cta: 'Copy the link or share it to your favorite app',
      visibility,
      safeForPublic: visibility === 'public',
      helperText:
        visibility === 'public'
          ? 'Only public-safe invite details are shown in this preview.'
          : 'This preview keeps private league details hidden until the invite link is opened.',
    })
  }

  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--panel) 40%, transparent)' }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          Share invite
        </h3>
        <button
          type="button"
          onClick={openPremiumShare}
          data-testid={`${testIdPrefix}-preview`}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        >
          <Share2 className="h-4 w-4" />
          Share preview
        </button>
      </div>

      <div className="mb-3 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
        {inviteUrl}
      </div>

      <div className="flex flex-wrap gap-2">
        {targets.map((target) => {
          const Icon = ICONS[target.channel]
          const feedback = feedbackByChannel[target.channel]
          const label = feedback || target.label

          if (target.action === 'copy' || target.action === 'manual_copy') {
            return (
              <button
                key={target.channel}
                type="button"
                onClick={() => handleCopyTarget(target)}
                data-testid={`${testIdPrefix}-${target.channel}`}
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                {feedback ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                {label}
              </button>
            )
          }

          return (
            <a
              key={target.channel}
              href={target.href ?? inviteUrl}
              target={target.channel === 'email' || target.channel === 'sms' ? undefined : '_blank'}
              rel={target.channel === 'email' || target.channel === 'sms' ? undefined : 'noreferrer'}
              onClick={() => logShare(target.channel)}
              data-testid={`${testIdPrefix}-${target.channel}`}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <Icon className="h-4 w-4" />
              {label}
            </a>
          )
        })}
      </div>

      <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
        Discord uses a manual copy fallback so there are no dead share buttons.
      </p>

      {shareModal.hasPayload && (
        <ShareModal
          open={shareModal.open}
          onOpenChange={shareModal.onOpenChange}
          payload={shareModal.payload}
          onShareComplete={(destination) => {
            const channel = mapDestinationToInviteChannel(destination)
            if (channel) logShare(channel)
          }}
        />
      )}
    </div>
  )
}
