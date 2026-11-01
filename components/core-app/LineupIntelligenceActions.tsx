'use client'

import { useMessages } from '@/components/i18n/useMessages'
import { lineupIntelligenceActionsMessages } from '@/lib/core-app/messages/lineupIntelligenceActions'
import { COMMS_OPEN_EVENT, type CommsOpenDetail } from './comms/commsEvents'

/** Open the existing Decision OS-backed Chimmy flow in the row's league. Never auto-send. */
export function LineupIntelligenceActions({ leagueId, leagueName, bestBall = false }: { leagueId: string; leagueName: string; bestBall?: boolean }) {
  /*
   * ⚠ THE PREFILL IS IN THE READER'S LANGUAGE TOO. It lands in their own composer as the question
   * they send, so an English prefill under a Spanish screen made a Spanish speaker ask in English.
   */
  const m = useMessages(lineupIntelligenceActionsMessages)
  const ask = () => {
    const detail: CommsOpenDetail = {
      tab: 'chimmy', leagueId,
      /*
       * 🛑 THIS TEXT GOES IN THE USER'S OWN MOUTH, so it must not name internal systems. It
       * pre-fills the Chimmy composer and the person sends it as their question — "using
       * Decision OS" made them ask about a module name they have never heard of. Asking for
       * the league's scoring and data says the same thing to the assistant and reads like
       * something a manager would actually type.
       */
      prefill: bestBall ? m.prefillBestBall(leagueName) : m.prefillLineup(leagueName),
    }
    window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail }))
  }
  /* The words sit in their own span so a narrow board can show only the ✦ (the aria-label carries the full name). */
  const label = m.label(leagueName, bestBall)
  const words = m.words(bestBall)
  return <button type="button" className="af-btn af-mt-intelligence" onClick={ask} aria-label={label}>✦<span className="af-mt-intelligence-label">{words}</span></button>
}
