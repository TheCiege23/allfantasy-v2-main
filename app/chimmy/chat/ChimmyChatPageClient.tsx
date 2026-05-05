'use client'

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { useMemo } from 'react'
import ChimmyChatShell from '@/components/chimmy/ChimmyChatShell'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { usePlayerComparisonUI } from '@/components/player-comparison-ui'
import { buildAiPlayerCompareToolUrl } from '@/lib/chimmy-actions/aiPlayerComparisonBridge'

export function ChimmyChatPageClient(props: {
  prompt?: string | null
  leagueId?: string | null
  sport?: string | null
  teamId?: string | null
  week?: string | null
  strategyMode?: string | null
}) {
  const sport = useMemo(() => normalizeToSupportedSport(props.sport), [props.sport])
  const { openComparison } = usePlayerComparisonUI()

  return (
    <main className="mode-surface flex h-[calc(100dvh-8.5rem)] min-h-0 flex-col px-3 py-4 sm:px-6 sm:py-6 lg:h-[calc(100dvh-3.5rem)]">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col">
        <Link
          href="/chimmy"
          className="mb-3 inline-flex shrink-0 touch-manipulation items-center gap-2 py-1 text-sm text-white/65 hover:text-white/90 sm:mb-4"
          data-testid="chimmy-chat-back-link"
        >
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
          Back to Chimmy
        </Link>
        <div className="flex min-h-0 flex-1 flex-col">
        <ChimmyChatShell
          initialPrompt={props.prompt ?? ''}
          leagueId={props.leagueId ?? null}
          teamId={props.teamId ?? null}
          sport={sport}
          week={props.week ? Number(props.week) : null}
          strategyMode={props.strategyMode ?? null}
          startSitDecisionHref={buildAiPlayerCompareToolUrl({
            sport,
            leagueId: props.leagueId ?? null,
            teamId: props.teamId ?? null,
            week: props.week ?? null,
            strategyMode: props.strategyMode ?? null,
          })}
          onOpenCompare={() =>
            openComparison({
              playerA: '',
              playerB: '',
              sport,
              leagueId: props.leagueId ?? null,
              teamId: props.teamId ?? null,
              weekOrPeriod: props.week ?? null,
              source: 'chimmy',
            })
          }
          toolContext={{
            toolName: 'Chimmy',
            summary: 'Direct chat route',
            sport,
          }}
          className="min-h-0 flex-1 !h-full !min-h-0 max-h-full"
        />
        </div>
      </div>
    </main>
  )
}
