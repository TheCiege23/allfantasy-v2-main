'use client'

import { useState } from 'react'

type Props = {
  variant?: 'strip' | 'compact' | 'footer'
  className?: string
}

/**
 * Premium sponsor strip — uses `/branding/kingbuffalo-presented-by.png` when the asset is present.
 */
export function KingBuffaloPresentedBy({ variant = 'strip', className = '' }: Props) {
  const [logoOk, setLogoOk] = useState(true)
  const isFooter = variant === 'footer'
  const isCompact = variant === 'compact'

  return (
    <div
      className={`flex items-center justify-center gap-3 border border-white/10 bg-[#070d18]/90 ${isFooter ? 'rounded-b-xl py-2' : isCompact ? 'rounded-lg py-1.5' : 'rounded-xl py-2.5'} px-3 ${className}`}
      data-testid="kingbuffalo-presented-by"
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/45">Presented by</span>
      {logoOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/branding/kingbuffalo-presented-by.png"
          alt="KingBuffalo"
          className="h-7 max-w-[200px] object-contain object-center sm:h-8"
          onError={() => setLogoOk(false)}
        />
      ) : (
        <span className="text-sm font-bold tracking-tight text-cyan-100/95">KingBuffalo</span>
      )}
    </div>
  )
}

