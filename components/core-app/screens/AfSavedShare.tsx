'use client'

import { useState } from 'react'
import { sendProductAnalyticsBeacon } from '@/lib/analytics/client'
import { receiptsCardMessages } from '@/lib/core-app/messages/receiptsCard'
import { langFromFlag } from '@/lib/core-app/messages/coreLocale'
import { messagesFor } from '@/lib/i18n/messages'

/**
 * "AF saved me" — a share image for a triage tip that came good: AllFantasy said start A over B, you
 * did, and A outscored B. Offered only for that case; a tip you ignored or that lost is not a brag.
 *
 * ⚠ DRAWN IN THE BROWSER, NOT BY A ROUTE. The repo sits at Vercel's 2048-route ceiling, and every
 * fact on the card is already on the screen, so a canvas does the job with no server work and no
 * new endpoint. It shares through the phone's share sheet (Web Share with a file) and falls back to
 * a download where that is unavailable.
 */

export type SavedTip = {
  recommended: { name: string; points: number }
  instead: { name: string; points: number }
  leagueName: string
  week: number
}

/** The card's words (lib/core-app/messages/receiptsCard.ts) — `es` is the prop the Receipts card passes. */
const savedCopy = (es: boolean) => messagesFor(receiptsCardMessages, langFromFlag(es))

export function savedMargin(t: SavedTip): number {
  return Math.round((t.recommended.points - t.instead.points) * 10) / 10
}

/** The words on the card, kept separate from the drawing so they can be tested. */
export function savedLines(t: SavedTip, es: boolean): { headline: string; detail: string; footer: string } {
  const margin = savedMargin(t).toFixed(1)
  const m = savedCopy(es)
  return {
    headline: m.savedHeadline(margin),
    detail: m.savedDetail(t.recommended.name, t.recommended.points.toFixed(1), t.instead.name, t.instead.points.toFixed(1)),
    footer: m.savedFooter(t.leagueName, t.week),
  }
}

function drawCard(t: SavedTip, es: boolean): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 630
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const g = ctx.createLinearGradient(0, 0, 1200, 630)
  g.addColorStop(0, '#0b1020')
  g.addColorStop(1, '#1d1340')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 1200, 630)
  const { headline, detail, footer } = savedLines(t, es)
  ctx.fillStyle = '#3ecf8e'
  ctx.font = 'bold 72px system-ui, sans-serif'
  ctx.fillText(headline, 80, 240, 1040)
  ctx.fillStyle = '#ffffff'
  ctx.font = '600 44px system-ui, sans-serif'
  ctx.fillText(detail, 80, 330, 1040)
  ctx.fillStyle = '#a7b0c8'
  ctx.font = '32px system-ui, sans-serif'
  ctx.fillText(footer, 80, 540, 1040)
  return canvas
}

export function AfSavedShare({ tip, es }: { tip: SavedTip; es: boolean }) {
  const [busy, setBusy] = useState(false)

  const share = async () => {
    setBusy(true)
    try {
      const canvas = drawCard(tip, es)
      if (!canvas) return
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) return
      const file = new File([blob], 'allfantasy-saved-me.png', { type: 'image/png' })
      const text = savedLines(tip, es).headline
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
      if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], text })
        sendProductAnalyticsBeacon('product.triage.saved_shared', { via: 'share_sheet' })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = file.name
        a.click()
        URL.revokeObjectURL(url)
        sendProductAnalyticsBeacon('product.triage.saved_shared', { via: 'download' })
      }
    } catch {
      /* the share sheet was dismissed — nothing to do */
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" className="af3a-receipt-share" onClick={share} disabled={busy}>
      {savedCopy(es).savedShare}
    </button>
  )
}

export default AfSavedShare
