'use client'

import { COMMS_OPEN_EVENT, type CommsOpenDetail } from './comms/commsEvents'

/** Open the existing Decision OS-backed Chimmy flow in the row's league. Never auto-send. */
export function LineupIntelligenceActions({ leagueId, leagueName, bestBall = false }: { leagueId: string; leagueName: string; bestBall?: boolean }) {
  const ask = () => {
    const detail: CommsOpenDetail = {
      tab: 'chimmy', leagueId,
      prefill: bestBall
        ? `Review my ${leagueName} Best Ball roster using Decision OS. The provider selects my scoring lineup automatically; focus on injuries, roster depth, waiver opportunities and missing data, rather than manual start/sit swaps.`
        : `Run a start/sit check for my ${leagueName} lineup using Decision OS. Compare eligible bench replacements under this league's scoring, check injuries and byes, exclude players whose games have started, and identify any missing data or platform locks I must verify.`,
    }
    window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail }))
  }
  return <button type="button" className="af-btn af-mt-intelligence" onClick={ask} aria-label={`Ask Chimmy to check ${leagueName}'s ${bestBall ? 'Best Ball roster' : 'lineup'}`}>✦ Ask Chimmy · {bestBall ? 'roster check' : 'lineup check'}</button>
}
