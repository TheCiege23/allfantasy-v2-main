import { readPortfolioState, type PortfolioHorizon, type PortfolioIntent, type PortfolioState } from './types'

type PortfolioRequest = {
  intent: PortfolioIntent
  horizon: PortfolioHorizon
  across: boolean
  reference: number | 'last' | 'focus' | null
  action: 'trade' | 'waiver' | 'lineup' | null
  next: boolean
  inheritScope: boolean
}

/** Shared intent vocabulary, independent of provider and answer style. */
export function portfolioRequest(question: string, previous?: PortfolioState | null): PortfolioRequest | null {
  const q = question.toLowerCase().replace(/[’]/g, "'")
  const across = /\b(?:across|all|every|my|of my)\s+(?:of\s+)?(?:my\s+)?(?:leagues|teams|rosters)\b|\bwhich\s+(?:of\s+my\s+)?(?:leagues?|teams?|rosters?)\b|\bhow\s+many\s+(?:of\s+my\s+)?(?:teams|leagues)\b|\bmy\s+(?:strongest|weakest|best|most complete)\s+(?:team|roster)\b/.test(q)
  const comparison = /\b(?:compare|rank|complete|completeness|balanced|balance|strongest|weakest|best|better|depth|rate|review)\b/.test(q)
  const reference = /\b(?:second|2nd)\b/.test(q) ? 1 : /\b(?:third|3rd)\b/.test(q) ? 2 :
    /\b(?:last|worst|weakest)\s+(?:one|team|roster)\b/.test(q) ? 'last' :
    /\b(?:first|1st|best|strongest)\s+(?:one|team|roster)\b/.test(q) ? 0 :
    /\b(?:that|this|same)\s+(?:one|team|roster|league)\b|\bwhy\s+(?:that|it|so)\b/.test(q) ? 'focus' : null
  const follow = previous != null && (reference != null || /^(?:(?:why|explain)\??$|what about (?:dynasty|this week|the rest of|season)|compare (?:those|the same|my remaining|my next) teams)/.test(q))
  const attention = /\b(?:attention|prioriti[sz]e|urgent|fix first)\b/.test(q)
  const injuries = /\b(?:injur(?:y|ies|ed)|hurt|affect(?:s|ed)?|exposed)\b/.test(q)
  const championship = /\b(?:championship|title|playoff)\b/.test(q)
  if (!(across && (comparison || attention || injuries || championship)) && !(comparison && /\bmy\s+(?:team|roster)\b/.test(q)) && !follow) return null
  const horizon: PortfolioHorizon = /\b(?:dynasty|long.term|future|next season)\b/.test(q) ? 'dynasty' :
    /\b(?:this week|tonight|today|weekly)\b/.test(q) ? 'week' : /\b(?:rest of|this season|ros)\b/.test(q) ? 'season' : previous?.horizon ?? 'season'
  const action = follow && (/\b(?:find|suggest|recommend|improve|upgrade|fix|set|optimi[sz]e|check|grade|evaluate|should)\b/.test(q) || /\bwho\b.*\b(?:pickup|pick up|waiver)\b/.test(q))
    ? /\b(?:waiver|pickup|pick up|add|free agent)\b/.test(q) ? 'waiver' : /\blineup\b/.test(q) ? 'lineup' : 'trade' : null
  const intent: PortfolioIntent = injuries ? 'injuries' : championship ? 'championship' : attention ? 'attention' :
    /\b(?:weak|weakest|weakness|weaknesses|thin|weak spot)\b/.test(q) ? 'weakness' : /\b(?:why|explain)\b/.test(q) ? 'explain' : 'compare'
  return { intent, horizon, across, reference, action, inheritScope: follow && !across && reference == null,
    next: /\b(?:next|remaining)\b/.test(q) && /\b(?:teams|rosters|leagues)\b/.test(q) }
}

type League = { id: string; name: string; sport: string; season: number; platform?: string | null; platformLeagueId?: string | null; status?: string | null; lifecycleState?: string | null }
const normalized = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Active seasons are per league. A newer NFL import must not erase an unrelated active league. */
export function portfolioLeagues<T extends League>(leagues: readonly T[], question: string): T[] {
  const years = [...question.matchAll(/\b(20\d{2})\b/g)].map(m => Number(m[1]))
  if (years.length) return leagues.filter(l => years.includes(l.season))
  const active = leagues.filter(l => ![l.status, l.lifecycleState].some(s => /^(?:archived|complete|completed|finished|closed)$/i.test(s ?? '')))
  const held = new Map<string, T>()
  for (const l of active) {
    // Only provider identity proves duplication; never collapse two different leagues by name.
    const key = l.platformLeagueId ? `${l.platform}|${l.sport}|${l.platformLeagueId}` : l.id
    if (!held.has(key) || held.get(key)!.season < l.season) held.set(key, l)
  }
  return [...held.values()]
}

export function selectPortfolioScope<T extends League>(args: {
  leagues: readonly T[]; question: string; request: PortfolioRequest; previous?: unknown; selectedLeagueId?: string | null
}): { leagues: T[]; focusLeagueId: string | null; prior: PortfolioState | null; ambiguous: boolean } {
  const all = [...args.leagues]
  const members = new Set(all.map(l => l.id))
  const state = readPortfolioState(args.previous)
  // Client state is a reference hint only, re-authorized on EVERY request, including cache hits.
  const prior = state ? { ...state, orderedLeagueIds: state.orderedLeagueIds.filter(id => members.has(id)),
    scopeLeagueIds: state.scopeLeagueIds?.filter(id => members.has(id)),
    focusLeagueId: state.focusLeagueId && members.has(state.focusLeagueId) ? state.focusLeagueId : null } : null
  const q = ` ${normalized(args.question)} `
  const named = all.filter(l => normalized(l.name).length > 2 && q.includes(` ${normalized(l.name)} `))
  let focusLeagueId: string | null = null
  if (named.length === 1) focusLeagueId = named[0]!.id
  else if (args.request.reference != null && prior) {
    const ref = args.request.reference
    focusLeagueId = ref === 'focus' ? state?.focusLeagueId ?? state?.orderedLeagueIds[0] ?? null :
      ref === 'last' ? state?.orderedLeagueIds.at(-1) ?? null : state?.orderedLeagueIds[ref] ?? null
    if (focusLeagueId && !members.has(focusLeagueId)) focusLeagueId = null
  } else if (!args.request.across && !args.request.inheritScope && args.selectedLeagueId && members.has(args.selectedLeagueId)) focusLeagueId = args.selectedLeagueId
  const ambiguous = args.request.reference != null && !focusLeagueId || named.length > 1 && (args.request.action != null || new Set(named.map(l => normalized(l.name))).size === 1) || !args.request.across && !focusLeagueId && named.length === 0 && !prior && all.length > 1
  const inherited = args.request.inheritScope && prior ? new Set(prior.scopeLeagueIds ?? prior.orderedLeagueIds) : null
  const pool = named.length > 1 ? named : focusLeagueId ? all.filter(l => l.id === focusLeagueId) : inherited ? all.filter(l => inherited.has(l.id)) : all
  return { leagues: pool, focusLeagueId, prior, ambiguous }
}
