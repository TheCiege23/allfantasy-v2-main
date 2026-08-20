'use client'

import { useCallback, useEffect, useState } from 'react'
import { Hourglass, MessageCircle, X } from 'lucide-react'
import { FIRST_RUN_COPY } from '@/lib/league/first-run-i18n'
import { LEAGUE_ENGAGEMENT_COPY } from '@/lib/league/league-engagement-copy'
import { emitLeagueEngagementEvent } from '@/lib/league/league-engagement-analytics'
import { isLeaguePredraftLifecycle } from '@/lib/league/league-predraft-lifecycle'

const storageKey = (leagueId: string) => `af-league-wait-commissioner-dismissed:${leagueId}`

export function LeagueWaitingForCommissionerCard({
  leagueId,
  lifecycleState,
  draftDateIso,
  managersJoined,
  managersCapacity,
  onOpenLeagueChat,
}: {
  leagueId: string
  lifecycleState: string | null | undefined
  draftDateIso: string | null
  managersJoined: number
  managersCapacity: number
  onOpenLeagueChat: () => void
}) {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem(storageKey(leagueId)) === '1') {
        setDismissed(true)
      }
    } catch {
      /* ignore */
    }
  }, [leagueId])

  const dismiss = useCallback(() => {
    setDismissed(true)
    try {
      window.localStorage.setItem(storageKey(leagueId), '1')
    } catch {
      /* ignore */
    }
  }, [leagueId])

  if (!isLeaguePredraftLifecycle(lifecycleState)) return null

  if (dismissed) return null

  const draftLine = draftDateIso
    ? `Draft is scheduled for ${new Date(draftDateIso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}.`
    : FIRST_RUN_COPY.memberWaitDraftPending

  const cap = typeof managersCapacity === 'number' && managersCapacity > 0 ? managersCapacity : null
  const joinedLine =
    cap != null ? LEAGUE_ENGAGEMENT_COPY.memberJoinedLine(managersJoined, cap) : null

  const openChat = () => {
    emitLeagueEngagementEvent({ kind: 'member_wait_chat', leagueId, surface: 'member' })
    onOpenLeagueChat()
  }

  return (
    <div className="border-b border-white/[0.07] bg-[#070f1c]/95 px-4 py-3">
      <div className="mx-auto flex max-w-6xl items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-500/10 text-sky-200">
          <Hourglass className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white/90">{FIRST_RUN_COPY.memberWaitTitle}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-white/55">{draftLine}</p>
          {joinedLine ? <p className="mt-1 text-[11px] text-white/45">{joinedLine}</p> : null}
          <p className="mt-1.5 text-[11px] leading-relaxed text-white/40">{LEAGUE_ENGAGEMENT_COPY.memberWhatNext}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openChat}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/85 hover:bg-white/[0.07]"
            >
              <MessageCircle className="h-3.5 w-3.5" aria-hidden />
              {FIRST_RUN_COPY.memberChatCta}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 text-white/45 hover:bg-white/[0.06] hover:text-white/80"
          aria-label={FIRST_RUN_COPY.memberDismissAria}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}
