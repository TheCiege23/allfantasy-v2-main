import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type EmptyStateAction = {
  label: string
  href?: string
  onClick?: () => void
  variant?: 'primary' | 'ghost'
}

type EmptyStateProps = {
  icon?: LucideIcon
  title: string
  description?: string
  actions?: EmptyStateAction[]
  className?: string
}

export function EmptyState({ icon: Icon, title, description, actions, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-3 py-6 text-center',
        className
      )}
    >
      {Icon ? <Icon className="h-8 w-8 text-[#565d80]" aria-hidden /> : null}
      <div>
        <p className="text-[14px] font-medium text-[#989fc2]">{title}</p>
        {description ? (
          <p className="mt-1 text-[12px] text-[#6b7295]">{description}</p>
        ) : null}
      </div>
      {actions && actions.length > 0 ? (
        <div className="flex w-full flex-col gap-1.5">
          {actions.map((action) => {
            const base = cn(
              'rounded-xl px-3 py-2 text-xs font-semibold transition',
              action.variant === 'primary'
                ? 'bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30'
                : 'border border-white/[0.08] text-[#7d84a8] hover:border-white/20 hover:text-[#b0b7d6]'
            )
            if (action.href) {
              return (
                <Link key={action.label} href={action.href} className={base}>
                  {action.label}
                </Link>
              )
            }
            return (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                className={base}
              >
                {action.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
