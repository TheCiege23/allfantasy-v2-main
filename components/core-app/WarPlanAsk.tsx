'use client'

import '@/components/core-app/af-war-plan.css'
import { COMMS_OPEN_EVENT, type CommsOpenDetail } from './comms/commsEvents'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { warRoomPlanMessages } from '@/lib/core-app/messages/warRoomPlan'
import { warRoomBriefMessages } from '@/lib/core-app/messages/warRoomBrief'
import { warPlanPrompt, type WarPlanInput } from '@/lib/core-app/warRoomPlanPrompt'

/**
 * "Plan with Chimmy" — War Room phase 4. Opens Chimmy, scoped to this league, with the war plan brief
 * in the composer (lib/core-app/warRoomPlanPrompt.ts).
 *
 * 🛑 IT NEVER SENDS. The brief lands unsent; the user reads it, may edit it, and presses send — the
 * contract every Chimmy prefill on /core keeps (commsEvents.ts).
 *
 * ⚠ BUILT ON CLICK, NOT ON RENDER. The brief depends on the language the viewer has switched to, which
 * is client state, and building it only when asked keeps sixty Front cards from each composing a
 * prompt nobody opened.
 */
export function WarPlanAsk({ leagueId, input, className }: { leagueId: string; input: WarPlanInput; className?: string }) {
  const { language } = useOptionalLanguage()
  const m = useMessages(warRoomPlanMessages)
  const b = useMessages(warRoomBriefMessages)
  const open = () => {
    const detail: CommsOpenDetail = { tab: 'chimmy', leagueId, prefill: warPlanPrompt(input, m, b, language) }
    window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail }))
  }
  return (
    <button type="button" className={className ?? 'af-war-plan-ask'} onClick={open} aria-label={m.buttonLabel(input.leagueName)}>
      {m.button}
    </button>
  )
}

export default WarPlanAsk
