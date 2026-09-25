'use client'

/**
 * ChimmyBubble — the league page's chat, re-housed as a floating expandable
 * bubble (desktop). Slice 2A of the league redesign.
 *
 * This is a HOUSING change, not an engine change: the expanded panel renders
 * the existing `LeftChatPanel` — the same component that previously occupied
 * the whole left column — so every Chimmy Intelligence wire (league context
 * sync, PECR/Anthropic pipelines, league chat, AF Huddle, DMs, Discord CTA)
 * keeps working exactly as before. Mobile keeps its existing chat sheet.
 */

import { useState } from 'react'
import { MessageSquare } from 'lucide-react'
import type { UserLeague, LeftChatInitialTab } from '@/app/dashboard/types'
import { LeagueCommunicationsDrawer } from './LeagueCommunicationsDrawer'
import '@/components/core-app/af-comms.css'

export type ChimmyBubbleProps = {
  selectedLeague: UserLeague | null
  activeLeagueId?: string | null
  userId: string
  userDisplayName?: string
  userImage?: string | null
  leagues?: UserLeague[]
  discordConnected?: boolean
  commissionerLeagues?: { id: string; name: string; teamCount: number }[]
  zombieChimmyPrefill?: string | null
  initialOpenChat?: LeftChatInitialTab | null
}

export function ChimmyBubble(props: ChimmyBubbleProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="hidden md:block" data-testid="chimmy-bubble">
      {!open ? <button type="button" className="af-cm-launch" onClick={() => setOpen(true)} aria-label="Open communications">
        <MessageSquare size={22} aria-hidden />
      </button> : null}
      <LeagueCommunicationsDrawer {...props} open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

export default ChimmyBubble
