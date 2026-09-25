'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Bot, MessageCircle, Users } from 'lucide-react'
import ThreadPanel from '@/components/core-app/comms/ThreadPanel'
import { DM_PRIVACY, HUDDLE_PRIVACY } from '@/components/core-app/comms/privacyCopy'
import '@/components/core-app/af-comms.css'

/**
 * AF Chat: Chimmy · Direct · Huddle.
 *
 * ⚠ NOTHING IN THE APP MOUNTS THIS — only its test does (checked 2026-09-25 across `@/`,
 * relative, dynamic and `vi.mock` imports). It used to render DMs and Huddles through
 * `LeagueMessageRow`, a test stub that drew no message text, behind tabs marked "soon" and
 * disabled, fed by hard-coded thread ids (`af-dm-main`) that do not exist. Its test had been
 * red on main for all seven cases.
 *
 * It now hands Direct and Huddle to `ThreadPanel`, the drawer's real DM/Huddle conversation,
 * so if anything does mount it, it works. Whether to keep it at all is the owner's call.
 */

export type AfSubTab = 'chimmy' | 'direct' | 'af_huddle'

const AF_SUB_TABS: Array<{ id: AfSubTab; label: string; title: string; Icon: typeof MessageCircle }> = [
  { id: 'chimmy', label: 'Chimmy', title: 'Chimmy', Icon: Bot },
  { id: 'direct', label: 'Direct', title: 'Direct messages', Icon: MessageCircle },
  { id: 'af_huddle', label: 'Huddle', title: 'AF Huddle', Icon: Users },
]

type AFChatDMPanelProps = {
  userId: string
}

export default function AFChatDMPanel({ userId }: AFChatDMPanelProps) {
  const [afTab, setAfTab] = useState<AfSubTab>('chimmy')

  return (
    <div className="flex h-full min-h-0 flex-col" data-af-chat-user-id={userId}>
      <p className="flex-shrink-0 px-3 pt-2.5 text-[10px] font-semibold uppercase tracking-widest text-white/30">AF Chat</p>
      <div className="flex flex-shrink-0 justify-center gap-0 border-b border-white/[0.07] px-0.5">
        {AF_SUB_TABS.map((tab) => {
          const isActive = afTab === tab.id
          const Icon = tab.Icon
          return (
            <button
              key={tab.id}
              type="button"
              title={tab.title}
              aria-pressed={isActive}
              onClick={() => setAfTab(tab.id)}
              className={`relative flex flex-1 items-center justify-center gap-1 py-2 transition-colors ${
                isActive ? 'border-b-2 border-cyan-500 bg-white/[0.04] text-cyan-300' : 'text-white/40 hover:text-white/70'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="sr-only">{tab.label}</span>
            </button>
          )
        })}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {afTab === 'chimmy' ? (
          <div className="p-3 text-[12px] text-white/60">
            <Link href="/chimmy/chat" className="font-semibold text-cyan-300 underline">
              Open Chimmy
            </Link>{' '}
            — your private read on trades, waivers and lineups.
          </div>
        ) : (
          <div className="af-cm af-cm-embed" data-fill="true">
            <ThreadPanel
              key={afTab}
              kind={afTab === 'direct' ? 'dm' : 'group'}
              privacy={afTab === 'direct' ? DM_PRIVACY : HUDDLE_PRIVACY}
            />
          </div>
        )}
      </div>
    </div>
  )
}
