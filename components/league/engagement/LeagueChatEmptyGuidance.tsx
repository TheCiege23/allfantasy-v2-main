'use client'

import Link from 'next/link'
import { MessageSquareText } from 'lucide-react'
import { LEAGUE_ENGAGEMENT_COPY } from '@/lib/league/league-engagement-copy'
import { emitLeagueEngagementEvent } from '@/lib/league/league-engagement-analytics'

type LeagueChatEmptyGuidanceProps = {
  leagueId: string
  leagueName: string
  isCommissioner: boolean
}

export function LeagueChatEmptyGuidance({ leagueId, leagueName, isCommissioner }: LeagueChatEmptyGuidanceProps) {
  const hub = `/league/${encodeURIComponent(leagueId)}`
  const bullets = isCommissioner
    ? LEAGUE_ENGAGEMENT_COPY.chatEmptyCommissionerBullets
    : LEAGUE_ENGAGEMENT_COPY.chatEmptyMemberBullets

  const fire = (kind: Parameters<typeof emitLeagueEngagementEvent>[0]['kind']) => {
    emitLeagueEngagementEvent({ kind, leagueId, surface: 'chat' })
  }

  return (
    <div className="flex min-h-[140px] flex-col items-stretch justify-center gap-3 rounded-xl border border-white/[0.08] bg-[#050c18]/90 px-3 py-4">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sky-400/25 bg-sky-500/10 text-sky-200">
          <MessageSquareText className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 text-left">
          <p className="text-[13px] font-semibold text-white/90">{LEAGUE_ENGAGEMENT_COPY.chatEmptyTitle}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-white/50">{LEAGUE_ENGAGEMENT_COPY.chatEmptySubtitle}</p>
          <p className="mt-1 text-[10px] uppercase tracking-wide text-white/35">{leagueName}</p>
        </div>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-white/55">
        {bullets.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`${hub}?view=settings`}
          onClick={() => fire('chat_empty_cta_settings')}
          className="inline-flex items-center rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/15"
        >
          {LEAGUE_ENGAGEMENT_COPY.chatCtaLeagueHub}
        </Link>
        {isCommissioner ? (
          <>
            <Link
              href={`${hub}?view=settings`}
              onClick={() => fire('chat_empty_cta_invite')}
              className="inline-flex items-center rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-semibold text-white/85 hover:bg-white/[0.07]"
            >
              {LEAGUE_ENGAGEMENT_COPY.chatCtaInviteSettings}
            </Link>
            <Link
              href={`${hub}?view=draft`}
              onClick={() => fire('chat_empty_cta_draft')}
              className="inline-flex items-center rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-semibold text-white/85 hover:bg-white/[0.07]"
            >
              {LEAGUE_ENGAGEMENT_COPY.chatCtaDraftTab}
            </Link>
            <Link
              href={`${hub}?view=settings`}
              onClick={() => fire('chat_empty_cta_scoring')}
              className="inline-flex items-center rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-semibold text-white/85 hover:bg-white/[0.07]"
            >
              {LEAGUE_ENGAGEMENT_COPY.predraftScoring}
            </Link>
          </>
        ) : null}
      </div>
    </div>
  )
}
