'use client'

import { useEffect, useMemo, useState } from 'react'
import { CommsDrawer, type CommsTab } from '@/components/core-app/comms/CommsDrawer'
import type { ChimmyBubbleProps } from './ChimmyBubble'

export function LeagueCommunicationsDrawer({ open, onClose, ...props }: ChimmyBubbleProps & { open: boolean; onClose: () => void }) {
  const [tokenCost, setTokenCost] = useState<number | null>(null)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setTokenCost(null)
    void fetch('/api/tokens/spend/preview?ruleCode=ai_chimmy_chat_message', { signal: controller.signal, cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!controller.signal.aborted) setTokenCost(typeof data?.preview?.tokenCost === 'number' ? data.preview.tokenCost : null)
      })
      .catch(() => { if (!controller.signal.aborted) setTokenCost(null) })
    return () => controller.abort()
  }, [open, props.userId])

  const leagues = useMemo(() => {
    const available = [...(props.leagues ?? [])]
    if (props.selectedLeague && !available.some(l => l.id === props.selectedLeague!.id)) available.push(props.selectedLeague)
    return available.map(l => ({
      id: l.id, name: l.name, platform: l.platform,
      platformLeagueId: l.sleeperLeagueId ?? null,
      teamCount: l.teamCount,
      isCommissioner: Boolean(l.isCommissioner || props.commissionerLeagues?.some(c => c.id === l.id)),
    }))
  }, [props.leagues, props.selectedLeague, props.commissionerLeagues])
  const initialTab: CommsTab = props.initialOpenChat === 'af_huddle' ? 'huddle' : props.initialOpenChat ?? 'chimmy'
  return <CommsDrawer key={props.userId} userId={props.userId} open={open} onClose={onClose}
    leagues={leagues} pageLeagueId={props.activeLeagueId ?? props.selectedLeague?.id ?? null}
    chimmyTokenCost={tokenCost} initialTab={initialTab} initialDraft={props.zombieChimmyPrefill} />
}
