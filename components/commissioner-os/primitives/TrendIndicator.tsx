import { ArrowUp, ArrowDown, Minus } from 'lucide-react'

interface TrendIndicatorProps {
  direction: 'up' | 'down' | 'flat'
  label: string
  /** Whether an upward trend is the good direction for this metric — a rising risk count is bad, a rising health score is good. */
  positiveDirection?: 'up' | 'down'
}

const ICONS = { up: ArrowUp, down: ArrowDown, flat: Minus }

/** Small inline sparkline-adjacent trend accessory, lives inside a card, never a standalone chart (Design Language §6). */
export function TrendIndicator({ direction, label, positiveDirection = 'up' }: TrendIndicatorProps) {
  const Icon = ICONS[direction]
  const isPositive = direction === positiveDirection
  const isNeutral = direction === 'flat'
  const color = isNeutral ? 'var(--muted2)' : isPositive ? 'var(--severity-positive-text)' : 'var(--severity-elevated-text)'

  return (
    <span className="inline-flex items-center gap-1 text-xs" style={{ color }}>
      <Icon size={12} aria-hidden />
      <span>{label}</span>
    </span>
  )
}
