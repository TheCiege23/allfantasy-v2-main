'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { trackChimmyAIEvent } from '@/lib/chimmy-chat/analytics-events-client'

export function BracketChimmyEntryLink({ href, format, className, testId, children }: {
  href: string
  format: 'tournament' | 'world_cup' | 'playoff'
  className?: string
  testId?: string
  children: ReactNode
}) {
  return <Link href={href} className={className} data-testid={testId} onClick={() => {
    void trackChimmyAIEvent({ event_name: 'bracket_entry_cta_click', surface: 'chimmy_chat',
      action: 'bracket_entry_cta_click', timestamp: new Date().toISOString(),
      metadata: { format } })
  }}>{children}</Link>
}
