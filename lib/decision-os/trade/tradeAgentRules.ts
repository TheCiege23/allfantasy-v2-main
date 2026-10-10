/**
 * The nightly trade agent's rules (design build step 9) — PURE, so every one is testable without a
 * database. The runner is `./tradeAgent.ts`; the store is `./tradeAgentStore.ts`.
 *
 * Guap's decisions (2026-09-27):
 *   - **A deal qualifies when it is near-even AND both rosters gain.** The design said "B or better for
 *     both sides", which the one grade cannot produce: the partner's letter is the exact mirror, so one
 *     side's B is the other's D. The only letter both sides can accept is C (within 10% on league
 *     value). What makes a C worth suggesting is that each manager's OWN roster fit — the need-weighted
 *     values `rosterFit` prices beside the letter — comes out ahead. Fair on paper, useful to both.
 *   - **All NFL leagues, suggest only.** Nothing here proposes a trade.
 *   - **In-app list only**, at most three per manager per league per night, shown only to that manager.
 */

import { marketLetterOf, type TradeGradeView } from './tradeGrade'

export const AGENT_MAX_PER_MANAGER = 3

/** The letter a deal must read for BOTH sides. See the header: the mirror allows nothing higher. */
export const AGENT_LETTER = 'C'

/** League types the agent suggests in (decision: redraft, dynasty and keeper NFL leagues). */
export const AGENT_LEAGUE_TYPES: ReadonlySet<string> = new Set(['redraft', 'dynasty', 'keeper'])

/** The UTC hours the nightly run works in. The hourly cron returns at once outside them. */
export const AGENT_WINDOW_UTC_HOURS: ReadonlySet<number> = new Set([3, 4, 5, 6, 7, 8, 9, 10])

export type AgentAsset = { playerId: string; name: string; position: string }

export type AgentSuggestion = {
  partnerRosterId: string
  partnerName: string | null
  give: AgentAsset[]
  get: AgentAsset[]
  dealKey: string
  letter: string
  partnerLetter: string
  percentDiff: number
  giveValue: number
  getValue: number
  viewerFitPct: number
  partnerFitPct: number
  basis: string
}

/** Why a league gets no suggestions, or null when it is one the agent works in. */
export function agentLeagueRefusal(args: { sport: string | null | undefined; leagueType: string; concept?: string | null }): string | null {
  if (String(args.sport ?? '').trim().toUpperCase() !== 'NFL') return 'the agent covers NFL leagues only'
  const concept = String(args.concept ?? '').toLowerCase()
  if (concept === 'guillotine' || concept === 'survivor') return 'this league does not allow trades'
  if (!AGENT_LEAGUE_TYPES.has(String(args.leagueType).toLowerCase())) return `the agent does not suggest trades in ${args.leagueType} leagues yet`
  return null
}

/** The same deal, however its sides were listed: sorted ids per side. */
export function dealKeyOf(give: readonly AgentAsset[], get: readonly AgentAsset[]): string {
  const ids = (side: readonly AgentAsset[]) => side.map((a) => a.playerId).sort().join(',')
  return `g:${ids(give)}|r:${ids(get)}`
}

/**
 * Whether a deal qualifies, from the viewer's grade (viewer gives `give`, need priced for the viewer's
 * roster) and the partner's grade of the same deal from the other side (need priced for the partner's).
 */
export function qualifyDeal(
  viewer: TradeGradeView,
  partner: TradeGradeView,
): { ok: true; viewerFitPct: number; partnerFitPct: number } | { ok: false; why: string } {
  if (!viewer.graded) return { ok: false, why: `not graded: ${viewer.reason}` }
  if (!partner.graded) return { ok: false, why: `not graded for the partner: ${partner.reason}` }
  /*
   * "Fair on paper" is the LEAGUE-VALUE letter. Since 2026-10-10 both grades here carry a your-team
   * headline (each is graded with its own roster's need), and a your-team letter already counts the fit
   * this rule checks separately — reading it would ask for a deal that is even AFTER the fit gain, i.e.
   * one where nobody gains.
   */
  const viewerMarket = marketLetterOf(viewer)
  const partnerMarket = marketLetterOf(partner)
  if (viewerMarket !== AGENT_LETTER || partnerMarket !== AGENT_LETTER) {
    return { ok: false, why: `reads ${viewerMarket}/${partnerMarket}, not ${AGENT_LETTER}/${AGENT_LETTER}` }
  }
  const mine = viewer.rosterFit
  const theirs = partner.rosterFit
  if (!mine) return { ok: false, why: 'roster fit could not be priced for the viewer' }
  if (!theirs) return { ok: false, why: 'roster fit could not be priced for the partner' }
  if (!(mine.percentDiff > 0)) return { ok: false, why: 'the viewer’s roster does not gain' }
  if (!(theirs.percentDiff > 0)) return { ok: false, why: 'the partner’s roster does not gain' }
  return { ok: true, viewerFitPct: mine.percentDiff, partnerFitPct: theirs.percentDiff }
}

/**
 * The best suggestions first: the deal whose WORSE-off side gains most (a deal that helps one side a
 * lot and the other barely is a hard sell), then the closer value gap. One of each deal.
 */
export function rankSuggestions(list: readonly AgentSuggestion[], max: number = AGENT_MAX_PER_MANAGER): AgentSuggestion[] {
  const seen = new Set<string>()
  return [...list]
    .sort(
      (a, b) =>
        Math.min(b.viewerFitPct, b.partnerFitPct) - Math.min(a.viewerFitPct, a.partnerFitPct) ||
        Math.abs(a.percentDiff) - Math.abs(b.percentDiff),
    )
    .filter((s) => (seen.has(s.dealKey) ? false : (seen.add(s.dealKey), true)))
    .slice(0, max)
}

/** The night a run belongs to (UTC date). */
export function runDateOf(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function inAgentWindow(now: Date): boolean {
  return AGENT_WINDOW_UTC_HOURS.has(now.getUTCHours())
}
