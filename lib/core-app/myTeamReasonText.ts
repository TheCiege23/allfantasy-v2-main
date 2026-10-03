import { matchupReasonText } from './matchupReasonText'

/**
 * Spanish for the reasons My Team's matchup card prints from the server (2026-10-03).
 *
 * The card's loader (`myTeam.ts`) writes its `nextMatchup.reason` in English, and the server render
 * does not know the reader's language — so, like the Matchup screen (`matchupReasonText`), the card
 * translates at render, in the client, where a language switch takes effect at once.
 *
 * Only the two reasons this card owns are here. Everything else it can print — the forecast's
 * refusals and `unpricedReason` (`leagueProjectionGap`) — comes from modules the Matchup screen
 * shares, and falls through to `matchupReasonText`, so one sentence has one Spanish wherever it
 * shows. An unknown string falls back to the English original, never to a blank.
 *
 * `__tests__/my-team-card-spanish.test.tsx` reads `myTeam.ts` for the card's reason literals, so a
 * new English reason without a line here fails the suite instead of shipping. PURE, client-safe.
 */
export function myTeamCardReasonText(reason: string | null | undefined, language: string): string {
  if (!reason) return ''
  if (language !== 'es') return reason
  if (reason === 'no schedule on file for this league yet') return 'aún no hay calendario registrado para esta liga'
  const week = reason.match(/^no week (\d+) matchup recorded for your team yet$/)
  if (week) return `aún no hay enfrentamiento de la semana ${week[1]} registrado para tu equipo`
  return matchupReasonText(reason, language)
}
