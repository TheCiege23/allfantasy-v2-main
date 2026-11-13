import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description: string
}

/**
 * Calm, affirmative by default — an empty state in this product is
 * frequently good news and must read that way (Design Constitution §17).
 * The caller decides the tone through `title`/`description`; this
 * component only supplies the consistent shape.
 */
export function EmptyState({ icon: Icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      {Icon && (
        <div className="flex items-center justify-center rounded-full p-2" style={{ background: 'var(--panel2)', color: 'var(--muted)' }}>
          <Icon size={20} aria-hidden />
        </div>
      )}
      <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
        {title}
      </p>
      <p className="max-w-xs text-xs" style={{ color: 'var(--muted2)' }}>
        {description}
      </p>
    </div>
  )
}
