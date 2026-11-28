import type { FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'
import { getTeamInfo, normalizePlayerName } from '@/lib/team-abbrev'
import { deriveFantasyEligibility, normalizeProviderPosition, REFERENCE_NFL_BUCKETS, type LeaguePositionRules } from '@/lib/sports-data-gateway/canonical/canonicalPosition'

/**
 * Fantrax NFL player id -> our `PlayerIdentityMap` row.
 *
 * 🛑 NFL WAS THE ONE FANTRAX SPORT WITH NO WRITER. `fantraxId` is filled for CFB
 * (`lib/player-identity/ingestNcaafFantraxIdentities.ts`) and MLB/NBA/NHL (`ingestProFantraxIdentities.ts`),
 * and every Fantrax roster reader resolves through it — so an NFL Fantrax roster resolved nobody.
 *
 * Same rule as the pro planner (`proFantraxIdentityPlan.ts`), keyed on the row id because NFL rows
 * are Sleeper-keyed rather than Rolling-Insights-keyed:
 *
 *   1. BY ID FIRST. A row already carrying this Fantrax id IS the answer; nothing is written.
 *   2. BY NAME SECOND, and never by name alone: the same normalized name, punctuation aside
 *      (`looseNflNameKey`) + a recognised CURRENT NFL team + a compatible position group. Two candidates is ambiguous and skipped; an id is never
 *      written over an existing link or onto a second row.
 *
 * ⚠ `getPlayerIds?sport=NFL` IS NOT CAPTURED (contracts/fantrax/GAPS.md F-12). Its shape is assumed
 * to match the captured MLB/CFB/NBA/NHL maps (`{ fantraxId, name: "Last, First", team, position }`)
 * and its team spelling is unknown, so a team label we cannot place refuses the match rather than
 * guessing — a miss costs a link, a wrong guess puts a stranger on a roster.
 *
 * Pure: the registry read and the guarded write live in `linkNflFantraxIdentities.ts`.
 */

type NflIdentityRow = {
  id: string
  canonicalName: string
  currentTeam: string | null
  position: string | null
  fantraxId: string | null
}

const TEAM_UNITS = new Set(['DST', 'DEF', 'D/ST', 'D', 'TEAM', 'TM'])

/*
 * Position compatibility goes through the governed canonical position service, never a private collapse map:
 * each token is normalized by `normalizeProviderPosition`, and two players are compatible when they share a
 * group — the detailed position itself, or one of the broad buckets below that the canonical service derives
 * via `deriveFantasyEligibility`. The defensive buckets are the reference NFL ones; FB also counts as RB,
 * because registries and Fantrax disagree on which of the two a fullback is.
 */
const MATCH_RULES: LeaguePositionRules = {
  buckets: {
    DL: REFERENCE_NFL_BUCKETS.buckets.DL!,
    LB: REFERENCE_NFL_BUCKETS.buckets.LB!,
    DB: REFERENCE_NFL_BUCKETS.buckets.DB!,
    RB: ['RB', 'FB'],
  },
}

/** A compatible-position group set for an NFL position label; empty when nothing in it is a known position. */
export function nflPositionGroups(position: string | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const token of String(position ?? '').toUpperCase().split(/[,/\s]+/)) {
    if (!token) continue
    const record = normalizeProviderPosition(token, 'NFL')
    if (record.isUnknown) continue
    const eligible = deriveFantasyEligibility(record.canonicalPrimaryPosition, MATCH_RULES)
    const bucket = eligible.find((g) => g !== record.canonicalPrimaryPosition && g in MATCH_RULES.buckets)
    out.add(bucket ?? record.canonicalPrimaryPosition)
  }
  return out
}

/** A canonical NFL team code, or null when the label is not a team we recognise. */
export function nflTeamCode(label: string | null | undefined): string | null {
  return getTeamInfo(String(label ?? '').trim())?.canonical ?? null
}

/** Fantrax writes "Last, First"; our registry writes "First Last". Same normalizer as the registry. */
export function fantraxNflNameKey(name: string): string {
  const parts = String(name ?? '').split(',')
  return normalizePlayerName(parts.length === 2 ? `${parts[1]!.trim()} ${parts[0]!.trim()}` : String(name ?? ''))
}

/**
 * A name key with its punctuation removed, for comparing a Fantrax name with a registry name.
 *
 * 🛑 FANTRAX DROPS THE APOSTROPHE AND THE REGISTRY KEEPS IT. Fantrax sends "Chase, JaMarr" and
 * "Brown, JiAyir"; the registry holds "Ja'Marr Chase" and "Ji'Ayir Brown", and `normalizePlayerName`
 * keeps an apostrophe. So the exact-name rule never matched them: 26 of one league's 139 unlinked
 * players on staging (2026-11-21), each with the same club and a compatible position on file.
 * The club and position rules are unchanged; only the spelling comparison is looser.
 */
export function looseNflNameKey(nameKey: string): string {
  return String(nameKey ?? '').replace(/[^a-z0-9 ]/g, '').replace(/ +/g, ' ').trim()
}

/**
 * ⚠ AN EDGE RUSHER IS A DE ON ONE FEED AND A LB ON THE OTHER. With the same name and the same
 * current club, DL against LB is one player filed two ways (Fantrax "Curry, Caden | IND | DE", registry
 * "Caden Curry / IND / LB"). No other pair of groups is treated as compatible.
 */
export function compatibleRoles(a: Set<string>, b: Set<string>): boolean {
  if ([...a].some((g) => b.has(g))) return true
  return (a.has('DL') && b.has('LB')) || (a.has('LB') && b.has('DL'))
}

/** A loose name key split into the first name and everything after it. */
export function nflNameParts(looseKey: string): { first: string; surname: string } {
  const [first, ...rest] = String(looseKey ?? '').split(' ')
  return { first: first ?? '', surname: rest.join(' ') }
}

/**
 * Two first names that are one name written short and long: one begins or ends with the other
 * ("cam" / "cameron", "matt" / "matthew", "dru" / "andru"). Three letters at least, and never equal.
 *
 * ⚠ DELIBERATELY NARROW. "Sauce" for "Ahmad" and "Quan" for "Jartavius" are the same players too, and
 * are refused: nothing in the two names says so, and a wrong link puts a stranger on a roster.
 */
export function relatedFirstNames(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 3 && short !== long && (long.startsWith(short) || long.endsWith(short))
}

function isTeamUnit(ref: FantraxPlayerRef): boolean {
  return TEAM_UNITS.has(String(ref.position ?? '').trim().toUpperCase()) || !String(ref.name ?? '').includes(',')
}

export function planNflFantraxIdentityLinks(
  refs: FantraxPlayerRef[],
  identities: NflIdentityRow[],
  /**
   * EVERY NFL registry row sharing a surname with a player the name rule could not place, for the
   * short-name rule below. Empty (the default) switches that rule off.
   *
   * 🛑 IT MUST BE THE COMPLETE SET FOR EACH SURNAME. The rule links only when exactly ONE row has that
   * surname at that club in a compatible position; over a partial set "exactly one" proves nothing.
   */
  surnameRows: NflIdentityRow[] = [],
) {
  const bySurname = new Map<string, NflIdentityRow[]>()
  for (const row of surnameRows) {
    const { surname } = nflNameParts(looseNflNameKey(normalizePlayerName(row.canonicalName ?? '')))
    if (surname) bySurname.set(surname, [...(bySurname.get(surname) ?? []), row])
  }
  const linkedIds = new Set(identities.map((r) => r.fantraxId?.trim()).filter((id): id is string => Boolean(id)))
  const byName = new Map<string, NflIdentityRow[]>()
  for (const row of identities) {
    const key = looseNflNameKey(normalizePlayerName(row.canonicalName ?? ''))
    if (key) byName.set(key, [...(byName.get(key) ?? []), row])
  }

  const proposed: Array<{ id: string; fantraxId: string }> = []
  let resolvedById = 0, unmatched = 0, ambiguous = 0, conflicts = 0, teamEntries = 0
  for (const ref of refs) {
    const fantraxId = String(ref.fantraxId ?? '').trim()
    if (!fantraxId) { unmatched++; continue }
    if (linkedIds.has(fantraxId)) { resolvedById++; continue }
    if (isTeamUnit(ref)) { teamEntries++; continue }
    const team = nflTeamCode(ref.team)
    const roles = nflPositionGroups(ref.position)
    if (!team || roles.size === 0) { unmatched++; continue }
    const fits = (row: NflIdentityRow) =>
      nflTeamCode(row.currentTeam) === team && compatibleRoles(nflPositionGroups(row.position), roles)
    const nameKey = looseNflNameKey(fantraxNflNameKey(ref.name))
    let candidates = (byName.get(nameKey) ?? []).filter(fits)
    if (candidates.length === 0) {
      /*
       * The registry files him under a short name ("Dru Phillips" for Fantrax's "Phillips, Andru":
       * 17 of one league's unlinked players on staging, 2026-11-21). Linked only when he is the ONE
       * registry row with that surname at that club in a compatible position, and the two first
       * names are one name written short and long.
       */
      const { first, surname } = nflNameParts(nameKey)
      const pool = surname ? (bySurname.get(surname) ?? []).filter(fits) : []
      const only = pool.length === 1 ? pool[0]! : null
      const onlyFirst = only ? nflNameParts(looseNflNameKey(normalizePlayerName(only.canonicalName ?? ''))).first : ''
      if (only && relatedFirstNames(first, onlyFirst)) candidates = [only]
    }
    if (candidates.length === 0) { unmatched++; continue }
    if (candidates.length > 1) { ambiguous++; continue }
    const target = candidates[0]!
    if (target.fantraxId) { conflicts++; continue }
    proposed.push({ id: target.id, fantraxId })
  }

  /* Two Fantrax ids proposing one row means one of them is wrong; neither is written. */
  const perRow = new Map<string, number>()
  for (const link of proposed) perRow.set(link.id, (perRow.get(link.id) ?? 0) + 1)
  const links = proposed.filter((link) => perRow.get(link.id) === 1)
  return {
    links,
    resolvedById,
    unmatched,
    ambiguous: ambiguous + proposed.length - links.length,
    conflicts,
    teamEntries,
    provided: refs.length,
  }
}
