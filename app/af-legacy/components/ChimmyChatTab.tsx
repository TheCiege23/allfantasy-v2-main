'use client'

import { ChimmyChatShell } from '@/components/chimmy'
import { toast } from 'sonner'

export default function ChimmyChatTab({
  promptParam,
  leagueName,
  leagueId,
  sleeperUsername,
  insightType,
  teamId,
  sport,
  season,
  week,
}: {
  promptParam: string | null
  leagueName: string | null
  leagueId?: string | null
  sleeperUsername?: string | null
  insightType?: 'matchup' | 'playoff' | 'dynasty' | 'trade' | 'waiver' | 'draft'
  teamId?: string | null
  sport?: string | null
  season?: number | null
  week?: number | null
}) {
  const initialPrompt = (() => {
    if (!promptParam) return ''
    try {
      return decodeURIComponent(promptParam).slice(0, 500)
    } catch {
      return String(promptParam).slice(0, 500)
    }
  })()

  return (
    <ChimmyChatShell
      initialPrompt={initialPrompt}
      clearUrlPromptAfterUse={true}
      leagueName={leagueName}
      leagueId={leagueId ?? null}
      sleeperUsername={sleeperUsername ?? null}
      insightType={insightType}
      teamId={teamId ?? null}
      sport={sport ?? null}
      season={season ?? null}
      week={week ?? null}
      onOpenCompare={() => toast.info('Provider comparison available from AI Hub.')}
    />
  )
}
