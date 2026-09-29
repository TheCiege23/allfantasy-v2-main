'use client'

import { ArrowLeftRight } from 'lucide-react'

export function TradedPickBadge() {
  return (
    <span
      className="absolute right-0.5 top-0.5 inline-flex items-center gap-0.5 rounded bg-amber-500/90 px-1 py-0.5 text-[11px] font-bold uppercase text-black"
      title="Traded pick"
    >
      <ArrowLeftRight className="h-2.5 w-2.5" aria-hidden />
      TRD
    </span>
  )
}
