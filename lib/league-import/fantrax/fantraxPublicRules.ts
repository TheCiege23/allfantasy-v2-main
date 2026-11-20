import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import type { TiebreakerKey } from '@/lib/standings/tiebreakerOrder'

export interface FantraxPublicRules {
  reseed?: boolean
  divisionWinners?: 'top_seeds'
  keeperType?: 'dynasty' | 'keeper' | 'redraft'
  standingsTies?: string[]
  matchupTies?: string[]
  playoffTies?: string[]
  standingsOrder?: TiebreakerKey[]
}

type Node = DefaultTreeAdapterTypes.Node
const tieColumns = new Map<string, 'standingsTies' | 'matchupTies' | 'playoffTies'>([
  ['Standings Tie Breakers', 'standingsTies'], ['Matchup Tie Breakers', 'matchupTies'], ['Playoff Tie Breakers', 'playoffTies'],
])
const nativeKeys = new Map<string, TiebreakerKey>([
  ['Most fantasy points for entire season', 'points_for'], ['Head-to-head record vs. all teams tied with', 'head_to_head'],
  ['Most wins in entire season', 'wins'], ['Least fantasy points against for entire season', 'points_against'], ['Randomly selected', 'coin_flip'],
])
const children = (n: Node): Node[] => 'childNodes' in n ? n.childNodes : []
function label(n: Node): string {
  return ('value' in n ? n.value : children(n).map(label).join(' ')).replace(/\s+/g, ' ').trim()
}

export function parseFantraxPublicRules(html: string): FantraxPublicRules | null {
  const result: FantraxPublicRules = {}
  let rulesPage = false
  function visit(n: Node, table?: { key?: 'standingsTies' | 'matchupTies' | 'playoffTies' }) {
    if (n.nodeName === 'script' || n.nodeName === 'style') return
    if (n.nodeName === 'title') rulesPage = /^League Rules Summary\s*-/i.test(label(n))
    if (n.nodeName === 'li') {
      const rule = label(n)
      const reseed = /^Reseed each playoff round\s*:\s*(Yes|No)$/i.exec(rule)
      if (reseed) result.reseed = reseed[1].toLowerCase() === 'yes'
      if (/^Playoff Seeding\s*:+\s*Division winners get top seeds$/i.test(rule)) result.divisionWinners = 'top_seeds'
      const keeper = /^Keeper league Type\s*:\s*(Dynasty|Keeper|Redraft)$/i.exec(rule)
      if (keeper) result.keeperType = keeper[1].toLowerCase() as FantraxPublicRules['keeperType']
    }
    if (n.nodeName === 'table') table = {}
    if (table && n.nodeName === 'th') table.key = tieColumns.get(label(n))
    if (table?.key && n.nodeName === 'td') {
      const row = /^\d+\.\s+(.{1,140})$/.exec(label(n))
      if (row) (result[table.key] ??= []).push(row[1])
    }
    for (const child of children(n)) visit(child, table)
  }
  visit(parse(html))
  if (!rulesPage || !Object.keys(result).length) return null
  const keys = result.standingsTies?.map(t => nativeKeys.get(t))
  if (keys?.length && keys.every((key): key is TiebreakerKey => key !== undefined)) result.standingsOrder = keys
  return result
}

export function fantraxCategoryTieWinner(rules: string[] | undefined, outcomes: Array<{name: string; winnerTeamId: string | null}> | undefined): string | null {
  for (const rule of rules ?? []) {
    const name = /^Ahead in specific scoring category\s*-\s*(.+)$/i.exec(rule)?.[1]
    if (!name) return null
    const matches = outcomes?.filter(row => row.name.toLowerCase() === name.toLowerCase())
    if (matches?.length !== 1) return null
    if (matches[0].winnerTeamId) return matches[0].winnerTeamId
  }
  return null
}

export async function fetchFantraxPublicRules(leagueId: string): Promise<FantraxPublicRules | null> {
  if (!/^[a-z0-9]{16}$/i.test(leagueId)) return null
  try {
    const url = new URL('https://www.fantrax.com/newui/fantasy/leagueRulesSummary.go')
    url.searchParams.set('leagueId', leagueId)
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(7000), redirect: 'error' })
    if (!response.ok || Number(response.headers.get('content-length')) > 1048576) return null
    const html = await response.text()
    return html.length <= 1048576 ? parseFantraxPublicRules(html) : null
  } catch {
    return null
  }
}
