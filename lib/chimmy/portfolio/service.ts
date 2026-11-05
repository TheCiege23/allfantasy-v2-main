import 'server-only'
import { withTimeout } from '@/lib/async-utils'
import { listMemberLeagues, type NamedLeague } from '@/lib/chimmy/tools/leagueByName'
import { scanWithinBudget, withDistinctLeagueNames } from '@/lib/chimmy/tools/boundedScan'
import { loadPortfolioTeam, portfolioVersion, unavailableTeam } from './data'
import { orderPortfolioTeams } from './metrics'
import { portfolioLeagues, portfolioRequest, selectPortfolioScope } from './scope'
import { readPortfolioState, type PortfolioEvidence, type PortfolioHorizon, type PortfolioState, type PortfolioTeam } from './types'

export interface PortfolioDeps {
  list: (userId: string) => Promise<NamedLeague[]>
  version: (ids: string[]) => Promise<string>
  read: (league: NamedLeague, userId: string, horizon: PortfolioHorizon) => Promise<PortfolioTeam>
  now: () => number
  budgetMs: number
  itemTimeoutMs: number
}
const defaults: PortfolioDeps = { list: userId => listMemberLeagues(userId), version: portfolioVersion, read: loadPortfolioTeam, now: Date.now, budgetMs: 8000, itemTimeoutMs: 3500 }
const TTL_MS = 15_000
const MAX_CACHE = 160
const cache = new Map<string, { expires: number; value: Promise<PortfolioTeam> }>()

export function clearPortfolioCache(): void { cache.clear() }

async function readCached(key: string, work: () => Promise<PortfolioTeam>, deps: PortfolioDeps, refresh: boolean): Promise<PortfolioTeam> {
  const held = cache.get(key)
  if (!refresh && held && held.expires > deps.now()) return held.value
  const value = work()
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!)
  cache.set(key, { expires: deps.now() + TTL_MS, value })
  value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key) })
  return value
}

export type PortfolioTurn =
  | { kind: 'action'; leagueId: string; question: string; state: PortfolioState }
  | { kind: 'report'; evidence: PortfolioEvidence }

export async function preparePortfolioTurn(args: {
  userId: string; question: string; selectedLeagueId?: string | null; previous?: unknown; refresh?: boolean; scopeLeagueIds?: string[]
}, deps: PortfolioDeps = defaults): Promise<PortfolioTurn | null> {
  if (!args.userId) return null
  const previous = readPortfolioState(args.previous)
  let request = portfolioRequest(args.question, previous)
  if (!request && previous && /\b(?:trade|waivers?|lineup|pickup|pick up)\b/i.test(args.question) && /\b(?:find|who|check|set|recommend|best)\b/i.test(args.question)) request = portfolioRequest(args.question + ' for that team', previous)
  const maybeNamed = /\b(?:compare|balanced|complete|strongest|weakest)\b/i.test(args.question)
  if (!request && !maybeNamed) return null
  const loaded = await withTimeout(deps.list(args.userId), 1800).catch(() => null)
  const members = loaded?.ok ? loaded.value : []
  if (!request) {
    const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const q = ' ' + normalize(args.question) + ' '
    if (!members.some(l => normalize(l.name).length > 2 && q.includes(' ' + normalize(l.name) + ' '))) return null
    request = portfolioRequest('Compare my teams: ' + args.question, previous)!
  }
  const current = portfolioLeagues(members, args.question)
  const selected = selectPortfolioScope({ leagues: current, question: args.question, request, previous, selectedLeagueId: args.selectedLeagueId })
  if (args.scopeLeagueIds) selected.leagues = selected.leagues.filter(l => args.scopeLeagueIds!.includes(l.id))
  selected.leagues = withDistinctLeagueNames(selected.leagues)
  const make = (teams: PortfolioTeam[], extra: string[] = []): PortfolioEvidence => {
    const ordered = orderPortfolioTeams(teams, request!.intent === 'attention' || request!.intent === 'weakness')
    const usable = ordered.filter(t => t.percentile != null && !t.stale && (t.status === 'ready' || t.status === 'partial'))
    const structureOnly = ordered.filter(t => !t.stale && t.metrics.some(m => m.key === 'depth' && m.value != null))
    const answered = request!.intent === 'injuries' ? ordered.filter(t => t.metrics.some(m => m.key === 'injuries' && m.value != null)) :
      request!.intent === 'attention' || request!.intent === 'weakness' ? ordered.filter(t => t.metrics.some(m => m.value != null)) : [...new Set([...usable, ...structureOnly])]
    const checked = new Set([...(request!.next ? selected.prior?.checkedLeagueIds ?? [] : []), ...teams.map(t => t.leagueId)])
    const remaining = selected.leagues.filter(l => !checked.has(l.id)).length
    const caveats = [...extra]
    if (remaining) caveats.push(remaining + ' additional teams remain unchecked. Compare the next teams before making an account-wide conclusion.')
    if (teams.some(t => t.status !== 'ready' || t.gaps.length)) caveats.push('Coverage and missing inputs are shown per team. Rankings apply only to the readable teams on this pass.')
    if (new Set(teams.map(t => t.sport)).size > 1) caveats.push('Sports are compared separately; there is no winner across different sports.')
    const ids = ordered.filter(t => answered.includes(t)).map(t => t.leagueId)
    const focusLeagueId = selected.focusLeagueId ?? ordered.find(t => answered.includes(t))?.leagueId ?? ordered[0]?.leagueId ?? null
    return { version: 1, intent: request!.intent, horizon: request!.horizon,
      status: !answered.length ? 'blocked' : answered.length < selected.leagues.length || caveats.length ? 'partial' : 'ready',
      scopeLabel: selected.focusLeagueId ? selected.leagues[0]?.name ?? 'Selected team' : selected.leagues.length + ' own teams',
      compared: answered.length, total: selected.leagues.length, remaining, generatedAt: new Date(deps.now()).toISOString(), teams: ordered,
      state: { version: 1, horizon: request!.horizon, orderedLeagueIds: ids, focusLeagueId, checkedLeagueIds: [...checked].slice(0, 400), scopeLeagueIds: selected.leagues.map(l => l.id) },
      methodology: [
        'Strength is normalized within each league: (league size − rank) / (league size − 1). Raw player values and points are never compared between leagues.',
        'Construction order uses 50% strength percentile, 30% weakest-position percentile and 20% eligible-backup coverage only when all three are available and the roster is fresh. Otherwise no complete construction score is assigned.',
        'Weekly strength uses the same league-scored projections and lineup fill as Trade Center. Season and dynasty strength use the shared roster-value ranking. Season value is a roster-construction proxy, not a rest-of-season point forecast.',
        'Injury reports and possible lineup gains are separate risk/action signals. No report does not establish health. Dynasty construction excludes draft picks and contract costs.',
      ], caveats,
      followUps: [
        request!.horizon === 'dynasty' ? 'Compare my teams for the rest of this season' : 'Compare my teams for dynasty outlook',
        'Which of my teams needs attention first?',
        ...(remaining ? ['Compare my remaining teams'] : ['Why is that team ahead?']),
      ] }
  }
  if (!loaded?.ok || !current.length || selected.ambiguous || !selected.leagues.length) return { kind: 'report', evidence: make([], [
    selected.ambiguous ? 'Choose a named league: that reference could not be resolved to one of your current own teams.' :
      'No readable league list was returned for this scope. Connect or refresh a league; this is not a finding that your rosters are empty.',
  ]) }
  if (request.action && selected.focusLeagueId) {
    const l = selected.leagues.find(l => l.id === selected.focusLeagueId)!
    return { kind: 'action', leagueId: l.id, question: /\b(?:trade|waivers?|pickup|pick up|lineup)\b/i.test(args.question) ? args.question + ' in ' + l.name : request.action === 'lineup' ? 'Check my lineup in ' + l.name :
      request.action === 'waiver' ? 'Who is the best pickup in ' + l.name + '?' : 'Find me a trade in ' + l.name,
      state: { version: 1, horizon: request.horizon, orderedLeagueIds: selected.prior?.orderedLeagueIds ?? [l.id], focusLeagueId: l.id } }
  }
  const checked = new Set(request.next ? selected.prior?.checkedLeagueIds?.filter(id => current.some(l => l.id === id)) ?? [] : [])
  const batch = selected.leagues.filter(l => !checked.has(l.id)).slice(0, 40)
  // Failure to read a version disables caching; never serve a stale row after an unverifiable edit.
  const versionRead = await withTimeout(deps.version(batch.map(l => l.id)), 1000).catch(() => null)
  const version = versionRead?.ok ? versionRead.value : null
  const scan = await scanWithinBudget(batch, { concurrency: 4, budgetMs: deps.budgetMs, perItemTimeoutMs: deps.itemTimeoutMs },
    l => version == null ? deps.read(l, args.userId, request!.horizon) : readCached(JSON.stringify([args.userId, l.id, request!.horizon, version]),
      () => deps.read(l, args.userId, request!.horizon), deps, Boolean(args.refresh)))
  const done = new Map(scan.done.map(r => [r.item.id, r.result]))
  const teams = batch.map(l => done.get(l.id) ?? unavailableTeam(l, 'The comparison could not finish within the read budget. Refresh analysis to retry.'))
  const report = make(teams)
  if (request.intent === 'injuries') {
    const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const names = [...new Set(teams.flatMap(t => t.rosterNames ?? []))]
    const q = ' ' + normalize(args.question) + ' '
    const matches = names.filter(n => q.includes(' ' + normalize(n) + ' '))
    const inherited = previous?.focusPlayer && names.includes(previous.focusPlayer) ? previous.focusPlayer : null
    report.focusPlayer = matches.length === 1 ? matches[0] : /\bthis injury\b/i.test(args.question) ? inherited : null
    report.state.focusPlayer = report.focusPlayer
    if (report.focusPlayer) {
      report.compared = teams.filter(t => t.rosterNames?.length).length
      report.status = report.compared ? 'partial' : 'blocked'
      report.caveats.push('Roster exposure is a count of verified holdings, not a statement that an injury will have the same impact in every league.')
    }
    if (/\bthis injury\b/i.test(args.question) && !report.focusPlayer) {
      report.status = 'blocked'
      report.caveats.push('Name the player whose injury you mean so I can count only the own rosters holding that player. This clarification is not charged.')
    }
  }
  if (request.intent === 'championship') {
    const { addPortfolioOutlook } = await import('./outlook')
    await addPortfolioOutlook(report, args.userId, selected.leagues)
  }
  return { kind: 'report', evidence: report }
}
