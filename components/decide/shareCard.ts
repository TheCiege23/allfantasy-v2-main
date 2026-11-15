'use client'

import { getMyReferralLink } from '@/lib/referral/myReferralLink'
import { withShareLink } from '@/lib/referral/referralShareLink'

/**
 * shareCard — fetch a generated card PNG (auth-gated route) and hand it to the
 * native share sheet; falls back to a plain download. The IMAGE is what gets
 * shared — card URLs never leave the signed-in session.
 */
export async function shareCardImage(
  url: string,
  filename: string,
  title: string,
  /** A card drawn from a POSTed body (the Trade Center's proposal card) passes its request here. */
  init?: RequestInit,
): Promise<'shared' | 'downloaded' | 'failed'> {
  try {
    // The referral link is read alongside the card, not after it — no extra wait before share().
    const linkPromise = getMyReferralLink()
    const res = await fetch(url, { credentials: 'same-origin', ...init })
    if (!res.ok) return 'failed'
    const blob = await res.blob()
    const file = new File([blob], filename, { type: 'image/png' })
    const nav = navigator as Navigator & {
      canShare?: (data: { files: File[] }) => boolean
      share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void>
    }
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      /*
       * The sharer's referral link rides along as the share's text (2026-11-15,
       * lib/referral/referralShareLink.ts): the card is the hook, the link is the way in — and the
       * signup it brings is credited to them. Signed out or unreadable: the image goes alone, as before.
       */
      const link = await linkPromise
      try {
        await nav.share({ files: [file], title, ...(link ? { text: withShareLink(title, link) } : {}) })
        return 'shared'
      } catch {
        // user cancelled the sheet — fall through to download? No: cancel = done.
        return 'shared'
      }
    }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(a.href)
    return 'downloaded'
  } catch {
    return 'failed'
  }
}
