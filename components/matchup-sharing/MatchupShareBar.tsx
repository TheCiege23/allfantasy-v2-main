'use client'

import { useCallback, useState } from 'react'
import html2canvas from 'html2canvas'
import { MATCHUP_SHARE_CARD_ID } from './MatchupShareCard'
import {
  buildMatchupShareUrl,
  getMatchupShareCopyText,
  type MatchupShareChannel,
} from '@/lib/matchup-sharing/shareUrls'
import type { MatchupSharePayload } from '@/lib/matchup-sharing/types'

const CHANNELS: { id: MatchupShareChannel; label: string }[] = [
  { id: 'copy_link', label: 'Copy link' },
  { id: 'x', label: 'X' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'discord', label: 'Discord' },
]

interface MatchupShareBarProps {
  payload: MatchupSharePayload
  shareUrl: string
  captureId?: string
  onDownload?: () => void
  onCopy?: (channel: MatchupShareChannel) => void
  className?: string
}

export function MatchupShareBar({
  payload,
  shareUrl,
  captureId = MATCHUP_SHARE_CARD_ID,
  onDownload,
  onCopy,
  className = '',
}: MatchupShareBarProps) {
  const [copied, setCopied] = useState<MatchupShareChannel | null>(null)

  const title = `${payload.team1Name} vs ${payload.team2Name} — ${payload.projectedWinner} favored`

  const shareOptions = { title, shareUrl }

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
      a.download = `allfantasy-matchup-${Date.now()}.png`
      a.click()
      onDownload?.()
    } catch {
      // ignore
    }
  }, [captureId, onDownload])

  const copyForChannel = useCallback(
    (channel: MatchupShareChannel) => {
      const text = getMatchupShareCopyText(channel, shareOptions)
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
        const intentUrl = buildMatchupShareUrl(id, shareOptions)
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
