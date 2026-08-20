'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { LEAGUE_ENGAGEMENT_COPY } from '@/lib/league/league-engagement-copy'
import { emitLeagueEngagementEvent } from '@/lib/league/league-engagement-analytics'
import type { PredraftEngagementPromptId } from '@/lib/league/predraft-engagement-prompts'

const storageDismiss = (leagueId: string) => `af-league-predraft-engagement-dismissed:${leagueId}`

type LeaguePredraftEngagementStripProps = {
  leagueId: string
  prompts: PredraftEngagementPromptId[]
  managersJoined: number
  managersCapacity: number
  createdHandoffActive: boolean
  onInvite: () => void
  onDraftSettings: () => void
  onOpenChat: () => void
  onLeagueSettings: () => void
}

function labelFor(id: PredraftEngagementPromptId): string {
  switch (id) {
    case 'invite':
      return LEAGUE_ENGAGEMENT_COPY.predraftInvite
    case 'schedule_draft':
      return LEAGUE_ENGAGEMENT_COPY.predraftScheduleDraft
    case 'open_chat':
      return LEAGUE_ENGAGEMENT_COPY.predraftOpenChat
    case 'welcome':
      return LEAGUE_ENGAGEMENT_COPY.predraftWelcome
    case 'listing':
      return LEAGUE_ENGAGEMENT_COPY.predraftListing
    case 'payment':
      return LEAGUE_ENGAGEMENT_COPY.predraftPayment
    case 'scoring':
      return LEAGUE_ENGAGEMENT_COPY.predraftScoring
    case 'logo':
      return LEAGUE_ENGAGEMENT_COPY.predraftLogo
    default:
      return 'Open settings'
  }
}

export function LeaguePredraftEngagementStrip({
  leagueId,
  prompts,
  managersJoined,
  managersCapacity,
  createdHandoffActive,
  onInvite,
  onDraftSettings,
  onOpenChat,
  onLeagueSettings,
}: LeaguePredraftEngagementStripProps) {
  const [dismissed, setDismissed] = useState(false)
  const shownRef = useRef(false)

  useEffect(() => {
    shownRef.current = false
  }, [leagueId])

  const visible = useMemo(
    () => !dismissed && !createdHandoffActive && prompts.length > 0,
    [dismissed, createdHandoffActive, prompts.length],
  )

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem(storageDismiss(leagueId)) === '1') {
        setDismissed(true)
      }
    } catch {
      /* ignore */
    }
  }, [leagueId])

  useEffect(() => {
    if (!visible || shownRef.current) return
    shownRef.current = true
    emitLeagueEngagementEvent({ kind: 'predraft_strip_shown', leagueId, surface: 'commissioner', meta: { prompts } })
  }, [visible, leagueId, prompts])

  if (!visible) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(storageDismiss(leagueId), '1')
    } catch {
      /* ignore */
    }
    emitLeagueEngagementEvent({ kind: 'predraft_strip_dismissed', leagueId, surface: 'commissioner' })
  }

  const handlePrompt = (id: PredraftEngagementPromptId) => {
    const kindMap: Record<PredraftEngagementPromptId, Parameters<typeof emitLeagueEngagementEvent>[0]['kind']> = {
      invite: 'predraft_cta_invite',
      schedule_draft: 'predraft_cta_draft',
      open_chat: 'predraft_cta_chat',
      welcome: 'predraft_cta_chat',
      listing: 'predraft_cta_listing',
      payment: 'predraft_cta_payment',
      scoring: 'predraft_cta_settings',
      logo: 'predraft_cta_settings',
    }
    emitLeagueEngagementEvent({ kind: kindMap[id], leagueId, surface: 'commissioner', meta: { id } })
    if (id === 'invite') onInvite()
    else if (id === 'schedule_draft') onDraftSettings()
    else if (id === 'open_chat' || id === 'welcome') onOpenChat()
    else if (id === 'scoring' || id === 'listing' || id === 'payment' || id === 'logo') onLeagueSettings()
  }

  return (
    <div className="shrink-0 border-b border-white/[0.06] bg-[#070f1a]/95 px-4 py-2.5">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-200/80" aria-hidden />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
              {LEAGUE_ENGAGEMENT_COPY.predraftStripTitle}
            </p>
            <p className="mt-0.5 text-[12px] text-white/70">
              {LEAGUE_ENGAGEMENT_COPY.predraftManagers(managersJoined, managersCapacity)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {prompts.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => handlePrompt(id)}
              className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-white/85 hover:border-cyan-400/30 hover:bg-white/[0.08]"
            >
              {labelFor(id)}
            </button>
          ))}
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-white/40 hover:bg-white/[0.06] hover:text-white/75"
            aria-label={LEAGUE_ENGAGEMENT_COPY.predraftStripDismiss}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  )
}
