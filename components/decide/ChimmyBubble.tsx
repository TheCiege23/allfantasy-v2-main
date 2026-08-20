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
import { Bot, X } from 'lucide-react'
import type { UserLeague, LeftChatInitialTab } from '@/app/dashboard/types'
import { LeftChatPanel } from '@/app/dashboard/components/LeftChatPanel'

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
    <div className="pointer-events-none fixed bottom-5 right-5 z-[70] hidden md:block" data-testid="chimmy-bubble">
      {open ? (
        <div
          className="pointer-events-auto flex h-[min(72vh,680px)] w-[420px] flex-col overflow-hidden rounded-2xl border border-[#262c6a] bg-[#0b0e2a] shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
          role="dialog"
          aria-label="Chimmy Intelligence chat"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-[#1c2153] bg-[#12163e] px-4 py-2.5">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-white"
              style={{ background: 'linear-gradient(135deg,#ff3d81,#ff8a3d)' }}
            >
              <Bot size={15} aria-hidden />
            </span>
            <span className="text-[13px] font-extrabold uppercase italic tracking-wide text-white">
              Chimmy Intelligence
            </span>
            <span className="ml-1 truncate text-[11px] font-semibold text-[#7b83c4]">
              {props.selectedLeague?.name ?? ''}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-[#aab1e0] hover:bg-white/10 hover:text-white"
              aria-label="Minimize chat"
            >
              <X size={15} aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <LeftChatPanel
              selectedLeague={props.selectedLeague}
              activeLeagueId={props.activeLeagueId}
              userId={props.userId}
              userDisplayName={props.userDisplayName}
              userImage={props.userImage}
              rootId="league-chimmy-bubble"
              leagues={props.leagues}
              discordConnected={props.discordConnected}
              commissionerLeagues={props.commissionerLeagues}
              zombieChimmyPrefill={props.zombieChimmyPrefill}
              initialOpenChat={props.initialOpenChat ?? 'chimmy'}
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pointer-events-auto group flex items-center gap-2 rounded-full py-2.5 pl-3 pr-5 text-white shadow-[0_14px_44px_rgba(255,61,129,0.35)] transition-transform hover:scale-[1.04]"
          style={{ background: 'linear-gradient(135deg,#ff3d81,#ff8a3d)' }}
          aria-label="Open Chimmy Intelligence chat"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
            <Bot size={17} aria-hidden />
          </span>
          <span className="text-[13px] font-extrabold uppercase italic tracking-wide">Chimmy</span>
        </button>
      )}
    </div>
  )
}

export default ChimmyBubble
