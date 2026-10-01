'use client'

import { useState } from 'react'

function personMark(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '—'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return `${words[0]![0]}${words[1]![0]}`.toUpperCase()
}

export function PlayerFace({
  imageUrl,
  name,
  teamLogoUrl,
  size = 'md',
}: {
  imageUrl?: string | null
  name: string
  teamLogoUrl?: string | null
  size?: 'md' | 'sm'
}) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null)
  const px = size === 'md' ? 34 : 26
  const faceCls = size === 'md' ? 'af-bd-face' : 'af-bd-face af-bd-face--sm'

  return (
    <span className="af-bd-facewrap">
      {imageUrl && imageUrl !== failedImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={faceCls} src={imageUrl} alt="" width={px} height={px} loading="lazy" onError={() => setFailedImageUrl(imageUrl)} />
      ) : (
        <span className={`${faceCls} af-bd-face--none`} aria-hidden>
          {personMark(name)}
        </span>
      )}
      {teamLogoUrl && teamLogoUrl !== failedLogoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="af-bd-club" src={teamLogoUrl} alt="" width={15} height={15} loading="lazy" onError={() => setFailedLogoUrl(teamLogoUrl)} />
      ) : null}
    </span>
  )
}
