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

export function leagueValueForPlayer(args: {
  name: string
  identity?: TradePlayerIdentity
  bySleeperId?: ReadonlyMap<string, LeagueNamedValue>
  byNameLower?: ReadonlyMap<string, LeagueNamedValue>
}): LeagueNamedValue | null {
  const id = args.identity?.sleeperId?.trim()
  // An ID-bearing lookup must never fall through to somebody else's name entry.
  const entry = id && args.bySleeperId
    ? args.bySleeperId.get(id)
    : args.byNameLower?.get(args.name.trim().toLowerCase())
  if (!entry || !valuePositionsAgree(args.identity?.position, entry.position)) return null
  if (id && entry.sleeperId && entry.sleeperId !== id) return null
  return entry
}
