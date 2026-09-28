import { normalizeIdpPosition } from '@/lib/idp-kicker-values'
import type { LeagueNamedValue } from './leagueTradeValues'

export type TradePlayerIdentity = { sleeperId?: string | null; position?: string | null }

/** Position aliases may agree; an offensive row never agrees with a defender. */
export function valuePositionsAgree(left?: string | null, right?: string | null): boolean {
  const group = (value?: string | null) => {
    const p = String(value ?? '').trim().toUpperCase()
    if (!p || p === 'UNKNOWN' || p === '—') return null
    if (['K', 'PK', 'KICKER', 'PLACE KICKER', 'K/P'].includes(p)) return 'K'
    if (['DEF', 'DST', 'D/ST'].includes(p)) return 'DEF'
    return normalizeIdpPosition(p) ?? p
  }
  const a = group(left), b = group(right)
  return !a || !b || a === b
}

/** Both labels are defensive (IDP) positions, whichever sub-position each names. */
function bothDefenders(left?: string | null, right?: string | null): boolean {
  const idp = (v?: string | null) => normalizeIdpPosition(String(v ?? '').trim()) != null
  return idp(left) && idp(right)
}

export function leagueValueForPlayer(args: {
  name: string
  identity?: TradePlayerIdentity
  bySleeperId?: ReadonlyMap<string, LeagueNamedValue>
  byNameLower?: ReadonlyMap<string, LeagueNamedValue>
}): LeagueNamedValue | null {
  const id = args.identity?.sleeperId?.trim()
  // An ID-bearing lookup must never fall through to somebody else's name entry.
  const byId = Boolean(id && args.bySleeperId)
  const entry = byId
    ? args.bySleeperId!.get(id!)
    : args.byNameLower?.get(args.name.trim().toLowerCase())
  if (!entry) return null
  if (id && entry.sleeperId && entry.sleeperId !== id) return null
  /*
   * 🛑 AN EXACT SLEEPER ID IS THE PLAYER; A DEFENSIVE SUB-LABEL IS NOT EVIDENCE AGAINST IT
   * (2026-09-28). The position check exists so one player cannot borrow another's value through a
   * shared NAME. But the league's defensive board labels players from `SportsPlayer` while callers
   * pass the `sports_players` (Sleeper) label, and the two disagree for edge rushers: Brian Burns,
   * Trey Hendrickson, Jared Verse are LB in one and DE/DL in the other. The value was found by his
   * exact id and then thrown away over LB vs DL, and the trade was withheld — 54 of 57 "defender"
   * gaps in the price coverage audit. By id, a defender matches a defender; a defender still never
   * matches an offensive player or a kicker, and a NAME match still needs the labels to agree.
   */
  if (!valuePositionsAgree(args.identity?.position, entry.position)
    && !(byId && bothDefenders(args.identity?.position, entry.position))) return null
  return entry
}
