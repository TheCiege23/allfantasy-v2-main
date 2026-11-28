'use client'

import { useState } from 'react'

function personMark(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '—'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return `${words[0]![0]}${words[1]![0]}`.toUpperCase()
}

/** The club's short code for the crest corner, or null for no club (free agent, unknown). */
export function clubAbbr(team: string | null | undefined): string | null {
  const t = String(team ?? '').trim().toUpperCase()
  if (!t || t === 'FA' || t === 'F/A' || t === 'FREE AGENT' || t === 'N/A' || t === '-' || t === '—') return null
  return t.slice(0, 3)
}

export function PlayerFace({
  imageUrl,
  name,
  teamLogoUrl,
  team,
  size = 'md',
}: {
  imageUrl?: string | null
  name: string
  teamLogoUrl?: string | null
  /** The club's abbreviation: drawn in the crest corner when there is no crest, or it fails to load. */
  team?: string | null
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
      ) : clubAbbr(team) ? (
        <span className="af-bd-club af-crest-abbr" aria-hidden>{clubAbbr(team)}</span>
      ) : null}
    </span>
  )
}
