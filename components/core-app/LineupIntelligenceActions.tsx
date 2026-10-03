'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { COMMS_OPEN_EVENT, type CommsOpenDetail } from './comms/commsEvents'

/** Open the existing Decision OS-backed Chimmy flow in the row's league. Never auto-send. */
export function LineupIntelligenceActions({ leagueId, leagueName, bestBall = false }: { leagueId: string; leagueName: string; bestBall?: boolean }) {
  /*
   * ⚠ THE PREFILL IS IN THE READER'S LANGUAGE TOO. It lands in their own composer as the question
   * they send, so an English prefill under a Spanish screen made a Spanish speaker ask in English.
   */
  const es = useOptionalLanguage().language === 'es'
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
        ? es
          ? `Revisa mi plantilla Best Ball de ${leagueName} con la puntuación de esta liga y mis datos más recientes. La plataforma elige automáticamente mis titulares; céntrate en lesiones, profundidad de la plantilla, posibles agentes libres y datos que falten.`
          : `Review my ${leagueName} Best Ball roster using this league's scoring and my latest data. The provider selects my scoring starters automatically; focus on injuries, roster depth, potential free agents and missing data.`
        : es
          ? `Revisa titulares y suplentes de mi alineación de ${leagueName} con la puntuación de esta liga y mis datos más recientes. Compara los reemplazos elegibles del banquillo con la puntuación de esta liga, revisa lesiones y semanas de descanso, excluye a los jugadores cuyos partidos ya empezaron e indica qué datos faltan o qué cierres de la plataforma debo confirmar.`
          : `Run a start/sit check for my ${leagueName} lineup using this league's scoring and my latest data. Compare eligible bench replacements under this league's scoring, check injuries and byes, exclude players whose games have started, and identify any missing data or platform locks I must verify.`,
    }
    window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail }))
  }
  /* The words sit in their own span so a narrow board can show only the ✦ (the aria-label carries the full name). */
  const label = es
    ? `Pedir a Chimmy que revise ${bestBall ? 'la plantilla Best Ball' : 'la alineación'} de ${leagueName}`
    : `Ask Chimmy to check ${leagueName}'s ${bestBall ? 'Best Ball roster' : 'lineup'}`
  const words = es
    ? ` Preguntar a Chimmy · ${bestBall ? 'revisar plantilla' : 'revisar alineación'}`
    : ` Ask Chimmy · ${bestBall ? 'roster check' : 'lineup check'}`
  return <button type="button" className="af-btn af-mt-intelligence" onClick={ask} aria-label={label}>✦<span className="af-mt-intelligence-label">{words}</span></button>
}
