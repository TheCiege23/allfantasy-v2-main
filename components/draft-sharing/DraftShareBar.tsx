'use client'

/**
 * Share bar for draft results: download image + copy link + share to X, Reddit, etc.
 * Uses DRAFT_SHARE_CARD_ID for capture (see DraftShareCard).
 */

import { useCallback, useState } from 'react'
import html2canvas from 'html2canvas'
import { DRAFT_SHARE_CARD_ID } from './DraftShareCard'
import {
  buildDraftShareUrl,
  getDraftShareCopyText,
  type DraftShareChannel,
} from '@/lib/draft-sharing/shareUrls'
import type { DraftShareCardPayload } from '@/lib/draft-sharing/types'

const CHANNELS: { id: DraftShareChannel; label: string }[] = [
  { id: 'copy_link', label: 'Copy link' },
  { id: 'x', label: 'X' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'discord', label: 'Discord' },
]

interface DraftShareBarProps {
  payload: DraftShareCardPayload
  shareUrl: string
  /** Optional capture id if different from default */
  captureId?: string
  onDownload?: () => void
  onCopy?: (channel: DraftShareChannel) => void
  className?: string
}

export function DraftShareBar({
  payload,
  shareUrl,
  captureId = DRAFT_SHARE_CARD_ID,
  onDownload,
  onCopy,
  className = '',
}: DraftShareBarProps) {
  const [copied, setCopied] = useState<DraftShareChannel | null>(null)

  const title =
    payload.variant === 'draft_grade'
      ? `Draft Grade: ${(payload as any).teamName} — ${(payload as any).grade}`
      : payload.variant === 'draft_winner'
        ? `Winner of the Draft: ${(payload as any).winnerName}`
        : `${payload.leagueName} — Draft Rankings`

  const shareOptions = {
    title,
    shareUrl,
    leagueName: payload.leagueName,
  }

  const captureAndDownload = useCallback(async () => {
    const el = document.getElementById(captureId)
    if (!el) return
    try {
      const canvas = await html2canvas(el, {
        scale: 2,
        backgroundColor: '#0f172a',
        useCORS: true,
        logging: false,
      })
      const dataUrl = canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `allfantasy-draft-${payload.variant}-${Date.now()}.png`
      a.click()
      onDownload?.()
    } catch {
      // ignore
    }
  }, [captureId, payload.variant, onDownload])

  const copyForChannel = useCallback(
    (channel: DraftShareChannel) => {
      const text = getDraftShareCopyText(channel, shareOptions)
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(channel)
        onCopy?.(channel)
        setTimeout(() => setCopied(null), 2000)
      })
    },
    [shareOptions, onCopy]
  )

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <button
        type="button"
        onClick={captureAndDownload}
        className="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-600 transition"
      >
        Download image
      </button>
      {CHANNELS.map(({ id, label }) => {
        const intentUrl = buildDraftShareUrl(id, shareOptions)
        if (intentUrl) {
          return (
            <a
              key={id}
              href={intentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-600 transition"
            >
              Share to {label}
            </a>
          )
        }
        return (
          <button
            key={id}
            type="button"
            onClick={() => copyForChannel(id)}
            className="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-600 transition"
          >
            {copied === id ? 'Copied!' : id === 'copy_link' ? 'Copy link' : `Copy for ${label}`}
          </button>
        )
      })}
    </div>
  )
}
