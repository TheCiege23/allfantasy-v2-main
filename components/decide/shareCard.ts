'use client'

/**
 * shareCard — fetch a generated card PNG (auth-gated route) and hand it to the
 * native share sheet; falls back to a plain download. The IMAGE is what gets
 * shared — card URLs never leave the signed-in session.
 */
export async function shareCardImage(
  url: string,
  filename: string,
  title: string,
): Promise<'shared' | 'downloaded' | 'failed'> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' })
    if (!res.ok) return 'failed'
    const blob = await res.blob()
    const file = new File([blob], filename, { type: 'image/png' })
    const nav = navigator as Navigator & {
      canShare?: (data: { files: File[] }) => boolean
      share?: (data: { files: File[]; title?: string }) => Promise<void>
    }
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      try {
        await nav.share({ files: [file], title })
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
