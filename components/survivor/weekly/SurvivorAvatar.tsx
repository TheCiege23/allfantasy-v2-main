import type { CSSProperties } from 'react'
import './survivor-weekly.css'

export type SurvivorAvatarStatus = 'active' | 'immune' | 'out'

/** "Open Team 12" reads as O12, the way the seat list numbers it. */
export function survivorInitials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  const last = words[words.length - 1]
  if (/^\d+$/.test(last)) return `${words[0][0]}${last}`.toUpperCase()
  return (words[0][0] + last[0]).toUpperCase()
}

export function survivorAvatarStatus(input: { immune?: boolean | null; out?: boolean | null }): SurvivorAvatarStatus {
  if (input.out) return 'out'
  if (input.immune) return 'immune'
  return 'active'
}

const STATUS_LABEL: Record<SurvivorAvatarStatus, string | null> = {
  active: null,
  immune: 'Immune this week',
  out: 'Torch out',
}

/**
 * A Survivor manager's avatar with the weekly status treatment:
 * immune = gold ring, soft glow and the necklace badge; out = greyscale, dim ring, snuffed-torch badge.
 */
export function SurvivorAvatar({
  name,
  status = 'active',
  size = 40,
  ringColor,
  background,
  gapColor,
  imageUrl,
  className,
  testId,
}: {
  name: string
  status?: SurvivorAvatarStatus
  size?: number
  ringColor?: string
  background?: string
  gapColor?: string
  imageUrl?: string | null
  className?: string
  testId?: string
}) {
  const style: CSSProperties & Record<string, string | number> = {
    width: size,
    height: size,
    fontSize: Math.max(10, Math.round(size * 0.32)),
  }
  if (ringColor && status === 'active') style['--swl-ring'] = ringColor
  if (gapColor) style['--swl-gap'] = gapColor
  if (background) style.background = background
  const label = STATUS_LABEL[status]
  return <span className={`swl-av${className ? ` ${className}` : ''}`} data-status={status} style={style} data-testid={testId}>
    <span className="swl-av-face" aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {imageUrl ? <img src={imageUrl} alt="" /> : survivorInitials(name)}
    </span>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {status === 'immune' && <img className="swl-av-badge" src="/survivor/weekly/immunity-necklace-icon.svg" alt="" />}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {status === 'out' && <img className="swl-av-badge" src="/survivor/weekly/torch-out-icon.svg" alt="" />}
    {label && <span className="swl-sr">{label}</span>}
  </span>
}

/** "Out · Wk N" chip for standings and tribe lists. */
export function SurvivorOutChip({ week }: { week: number | null | undefined }) {
  return <span className="swl-out-chip" data-testid="survivor-out-chip">{week ? `Out · Wk ${week}` : 'Out'}</span>
}

/** Lit torch = still in the game. Snuffed = voted out. */
export function SurvivorTorchIcon({ out, size = 22 }: { out: boolean; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="swl-torch" style={{ width: size, height: size }} src={out ? '/survivor/weekly/torch-out-icon.svg' : '/survivor/weekly/torch-lit-icon.svg'} alt={out ? 'Torch out' : 'Torch lit'} />
}
