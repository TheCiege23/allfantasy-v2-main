'use client'

import { COMMS_OPEN_EVENT, type CommsOpenDetail } from './comms/commsEvents'

/** Open the existing Decision OS-backed Chimmy flow in the row's league. Never auto-send. */
export function LineupIntelligenceActions({ leagueId, leagueName, bestBall = false }: { leagueId: string; leagueName: string; bestBall?: boolean }) {
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
      prefill: bestBall
        ? `Review my ${leagueName} Best Ball roster using this league's scoring and my latest data. The provider selects my scoring starters automatically; focus on injuries, roster depth, potential free agents and missing data.`
        : `Run a start/sit check for my ${leagueName} lineup using this league's scoring and my latest data. Compare eligible bench replacements under this league's scoring, check injuries and byes, exclude players whose games have started, and identify any missing data or platform locks I must verify.`,
    }
    window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail }))
  }
  return <button type="button" className="af-btn af-mt-intelligence" onClick={ask} aria-label={`Ask Chimmy to check ${leagueName}'s ${bestBall ? 'Best Ball roster' : 'lineup'}`}>✦ Ask Chimmy · {bestBall ? 'roster check' : 'lineup check'}</button>
}
