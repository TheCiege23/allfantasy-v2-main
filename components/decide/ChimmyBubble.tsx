'use client'

/** The league workspace uses the same scoped communications dock as Core. */

import { useEffect } from 'react'
import CommsDock from '@/components/core-app/comms/CommsDock'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'
import { getTokenSpendRuleMatrixEntry } from '@/lib/tokens/pricing-matrix'
import type { UserLeague, LeftChatInitialTab } from '@/app/dashboard/types'

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
  const sourceLeagues = props.leagues?.some(league => league.id === props.selectedLeague?.id)
    ? props.leagues : [...(props.leagues ?? []), ...(props.selectedLeague ? [props.selectedLeague] : [])]
  const leagues = sourceLeagues.map(league => ({
    id: league.id, name: league.name, platform: league.platform ?? 'allfantasy',
    platformLeagueId: league.sleeperLeagueId ?? null, isCommissioner: league.isCommissioner,
    teamCount: league.teamCount ?? undefined,
  }))
  useEffect(() => {
    const forward = (event: Event) => {
      const prompt = (event as CustomEvent<{ prompt?: string }>).detail?.prompt?.trim()
      if (prompt) window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail: { tab: 'chimmy', leagueId: props.activeLeagueId ?? undefined, prefill: prompt } }))
    }
    window.addEventListener('af-chimmy-prefill', forward)
    window.addEventListener('af-chimmy-shortcut', forward)
    return () => { window.removeEventListener('af-chimmy-prefill', forward); window.removeEventListener('af-chimmy-shortcut', forward) }
  }, [props.activeLeagueId])
  useEffect(() => {
    if (!props.zombieChimmyPrefill) return
    window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail: { tab: 'chimmy', leagueId: props.activeLeagueId ?? undefined, prefill: props.zombieChimmyPrefill } }))
  }, [props.activeLeagueId, props.zombieChimmyPrefill])
  return <CommsDock leagues={leagues} pageLeagueId={props.activeLeagueId ?? props.selectedLeague?.id ?? null}
    chimmyTokenCost={getTokenSpendRuleMatrixEntry('ai_chimmy_chat_message')?.tokenCost ?? null} />
}

export default ChimmyBubble
