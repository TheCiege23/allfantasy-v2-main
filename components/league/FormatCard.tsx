'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { SelectionCheck } from '@/components/ui/selection-check'

type FormatCardProps = {
  title: string
  description: string
  selected?: boolean
  disabled?: boolean
  badges?: string[]
  onClick?: () => void
}

export function FormatCard({
  title,
  description,
  selected = false,
  disabled = false,
  badges = [],
  onClick,
}: FormatCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left"
      aria-pressed={selected}
    >
      <Card
        className={cn(
          'h-full transition-all duration-200',
          selected
            ? 'border-cyan-300/60 bg-cyan-300/10 shadow-[0_0_0_1px_rgba(103,232,249,0.35)]'
            : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <SelectionCheck selected={selected} className="text-white" testId="format-card-check" />
            <CardTitle className="text-white">{title}</CardTitle>
            {badges.map((badge) => (
              <Badge key={badge} variant="outline" className="border-cyan-300/20 bg-cyan-300/10 text-[var(--badge-text-cyan)]">
                {badge}
              </Badge>
            ))}
          </div>
          <CardDescription className="text-white/65">{description}</CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-white/50">
          {selected ? 'Selected format' : 'Tap to choose this format'}
        </CardContent>
      </Card>
    </button>
  )
}
