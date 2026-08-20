'use client'

import { useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  computeLeagueReadiness,
  readCanonicalPaidFreeLabel,
  readHeroVisibilityLabel,
  stripCreatedQueryParam,
} from '@/lib/league/first-run-readiness'
import type { LeagueFirstRunNiceEvidence } from '@/lib/league/first-run-types'
import { formatConceptLabel } from '@/app/league/[leagueId]/components/league-settings-modal-utils'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'
import { PostCreateCommissionerHero } from './PostCreateCommissionerHero'
import {
  CommissionerSettingsCard,
  DraftSetupCard,
  FirstRunQuickLinksCard,
  InviteManagersCard,
  LeagueChatCard,
  LeagueReadinessChecklist,
} from './FirstRunOnboardingCards'

export function LeaguePostCreateFirstRunPanel({
  leagueId,
  leagueName,
  sport,
  leagueType,
  leagueVariant,
  isDynasty,
  bestBallMode,
  guillotineMode,
  settings,
  isCommissioner,
  isOwner,
  userTeamId,
  inviteToken,
  draftDateIso,
  embedMode = false,
  firstRunNiceEvidence = null,
  onOpenInviteSettings,
  onOpenDraftTab,
  onOpenDraftSettings,
  onOpenLeagueChat,
  onOpenLeagueSettings,
}: {
  leagueId: string
  leagueName: string
  sport: string | null | undefined
  leagueType: string | null | undefined
  leagueVariant: string | null | undefined
  isDynasty: boolean | null | undefined
  bestBallMode: boolean | null | undefined
  guillotineMode: boolean | null | undefined
  settings: unknown
  isCommissioner: boolean
  isOwner: boolean
  userTeamId: string | null
  inviteToken: string
  draftDateIso: string | null
  embedMode?: boolean
  firstRunNiceEvidence?: LeagueFirstRunNiceEvidence | null
  onOpenInviteSettings: () => void
  onOpenDraftTab: () => void
  onOpenDraftSettings: () => void
  onOpenLeagueChat: () => void
  onOpenLeagueSettings: () => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const show = isCommissioner && !embedMode && searchParams?.get('created') === '1'

  const readiness = useMemo(() => {
    const s =
      settings && typeof settings === 'object' && !Array.isArray(settings)
        ? (settings as Record<string, unknown>)
        : {}
    return computeLeagueReadiness({
      isCommissioner,
      isOwner,
      userTeamId,
      inviteTokenPresent: Boolean(inviteToken.trim()),
      draftScheduled: Boolean(draftDateIso),
      settings: s,
      ...(firstRunNiceEvidence?.welcomeMessagePostedEvidence !== undefined
        ? { welcomeMessagePostedEvidence: firstRunNiceEvidence.welcomeMessagePostedEvidence }
        : {}),
      ...(firstRunNiceEvidence?.scoringReviewedEvidence !== undefined
        ? { scoringReviewedEvidence: firstRunNiceEvidence.scoringReviewedEvidence }
        : {}),
    })
  }, [
    isCommissioner,
    isOwner,
    userTeamId,
    inviteToken,
    draftDateIso,
    settings,
    firstRunNiceEvidence?.welcomeMessagePostedEvidence,
    firstRunNiceEvidence?.scoringReviewedEvidence,
  ])

  const sportLabel = normalizeToSupportedSport(String(sport ?? '')) ?? DEFAULT_SPORT
  const formatLabel = formatConceptLabel({
    leagueType,
    leagueVariant,
    isDynasty: Boolean(isDynasty),
    bestBallMode: Boolean(bestBallMode),
    guillotineMode: Boolean(guillotineMode),
    fallbackFormat: leagueType ?? undefined,
  })
  const visibilityLabel = readHeroVisibilityLabel(settings)
  const paidFreeLabel = readCanonicalPaidFreeLabel(settings)

  const dismiss = () => {
    const base = pathname && pathname.startsWith('/league/') ? pathname : `/league/${leagueId}`
    const tail = stripCreatedQueryParam(searchParams?.toString() ?? '')
    router.replace(tail ? `${base}${tail}` : base, { scroll: false })
  }

  if (!show) return null

  return (
    <div className="shrink-0">
      <PostCreateCommissionerHero
        leagueName={leagueName}
        sportLabel={sportLabel}
        formatLabel={formatLabel}
        visibilityLabel={visibilityLabel}
        paidFreeLabel={paidFreeLabel}
        readinessBadge={readiness.badgeLabel}
        onDismiss={dismiss}
      />
      <div className="border-b border-white/[0.06] bg-[#050a14]/95 px-4 py-3">
        <div className="mx-auto grid max-w-6xl gap-2 sm:grid-cols-2">
          <InviteManagersCard inviteToken={inviteToken} onOpenInviteSettings={onOpenInviteSettings} />
          <DraftSetupCard
            draftDateIso={draftDateIso}
            onOpenDraftTab={onOpenDraftTab}
            onOpenDraftSettings={onOpenDraftSettings}
          />
          <LeagueChatCard onOpenLeagueChat={onOpenLeagueChat} />
          <CommissionerSettingsCard onOpenSettings={onOpenLeagueSettings} />
          <FirstRunQuickLinksCard leagueId={leagueId} />
          <LeagueReadinessChecklist items={readiness.checklist} />
        </div>
      </div>
    </div>
  )
}
