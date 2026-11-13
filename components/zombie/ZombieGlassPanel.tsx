'use client'

import clsx from 'clsx'
import { type ReactNode } from 'react'

type ZombieGlassPanelVariant = 'default' | 'danger' | 'reward' | 'tactical'

const variantClass: Record<ZombieGlassPanelVariant, string> = {
  default: 'border-white/[0.09]',
  danger: 'border-red-500/25 shadow-[0_0_24px_rgba(239,68,68,0.08)]',
  reward: 'border-amber-500/25 shadow-[0_0_20px_rgba(245,158,11,0.08)]',
  tactical: 'border-cyan-500/20 shadow-[0_0_18px_rgba(34,211,238,0.06)]',
}

export function ZombieGlassPanel({
  eyebrow,
  title,
  icon,
  children,
  className,
  variant = 'default',
  shine = false,
  'data-testid': dataTestId,
}: {
  eyebrow?: string
  title: string
  icon?: ReactNode
  children: ReactNode
  className?: string
  variant?: ZombieGlassPanelVariant
  shine?: boolean
  'data-testid'?: string
}) {
  return (
    <section
      data-testid={dataTestId}
      className={clsx(
        'zombie-glass rounded-3xl p-5 text-[var(--zombie-text-full)]',
        shine && 'zombie-panel-shine relative',
        variantClass[variant],
        className,
      )}
    >
      <div className="relative z-[1] flex items-start justify-between gap-3">
        <div>
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--zombie-text-dim)]">{eyebrow}</p>
          ) : null}
          <h2 className="mt-1 text-lg font-bold tracking-tight text-white">{title}</h2>
        </div>
        {icon ? <div className="shrink-0 text-white/70">{icon}</div> : null}
      </div>
      <div className="relative z-[1] mt-4">{children}</div>
    </section>
  )
}
