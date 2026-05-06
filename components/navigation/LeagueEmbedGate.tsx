'use client'

import type { ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  isDraftFullscreenFromSearchParams,
  isEmbedModeFromSearchParams,
} from '@/lib/navigation/embedMode'

type LeagueEmbedGateProps = {
  children: ReactNode
  /** Wrapped league routes when not in embed / draft-fullscreen mode. */
  fallback: ReactNode
}

/**
 * `/league/*` layout shell: when `?embed=1` (dashboard iframe) or draft fullscreen helper params are present,
 * skip ProductShellLayout so ResponsiveNav / global header does not nest inside the dashboard center panel.
 */
export function LeagueEmbedGate({ children, fallback }: LeagueEmbedGateProps) {
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()

  if (!pathname.startsWith('/league/')) {
    return <>{fallback}</>
  }

  const embed = isEmbedModeFromSearchParams(searchParams)
  const draftFs = isDraftFullscreenFromSearchParams(searchParams)

  if (!embed && !draftFs) {
    return <>{fallback}</>
  }

  return (
    <div className="flex min-h-0 min-h-screen flex-1 flex-col bg-[#040915]" data-af-league-embed-chrome-off="1">
      {children}
    </div>
  )
}
