import type { FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'
import { getTeamInfo, normalizePlayerName } from '@/lib/team-abbrev'
import { deriveFantasyEligibility, normalizeProviderPosition, REFERENCE_NFL_BUCKETS, type LeaguePositionRules } from '@/lib/sports-data-gateway/canonical/canonicalPosition'

/**
 * Fantrax NFL player id -> our `PlayerIdentityMap` row.
 *
 * 🛑 NFL WAS THE ONE FANTRAX SPORT WITH NO WRITER. `fantraxId` is filled for CFB
 * (`lib/devy/ingestFantraxPlayerIdentities.ts`) and MLB/NBA/NHL (`ingestProFantraxIdentities.ts`),
 * and every Fantrax roster reader resolves through it — so an NFL Fantrax roster resolved nobody.
 *
 * Same rule as the pro planner (`proFantraxIdentityPlan.ts`), keyed on the row id because NFL rows
 * are Sleeper-keyed rather than Rolling-Insights-keyed:
 *
 *   1. BY ID FIRST. A row already carrying this Fantrax id IS the answer; nothing is written.
 *   2. BY NAME SECOND, and never by name alone: exact normalized name + a recognised CURRENT NFL
 *      team + a compatible position group. Two candidates is ambiguous and skipped; an id is never
 *      written over an existing link or onto a second row.
 *
 * ⚠ `getPlayerIds?sport=NFL` IS NOT CAPTURED (contracts/fantrax/GAPS.md F-12). Its shape is assumed
 * to match the captured MLB/CFB/NBA/NHL maps (`{ fantraxId, name: "Last, First", team, position }`)
 * and its team spelling is unknown, so a team label we cannot place refuses the match rather than
 * guessing — a miss costs a link, a wrong guess puts a stranger on a roster.
 *
 * Pure: the registry read and the guarded write live in `linkNflFantraxIdentities.ts`.
 */

export type NflIdentityRow = {
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

function groups(position: string | null | undefined): Set<string> {
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
function teamCode(label: string | null | undefined): string | null {
  return getTeamInfo(String(label ?? '').trim())?.canonical ?? null
}

/** Fantrax writes "Last, First"; our registry writes "First Last". Same normalizer as the registry. */
export function fantraxNflNameKey(name: string): string {
  const parts = String(name ?? '').split(',')
  return normalizePlayerName(parts.length === 2 ? `${parts[1]!.trim()} ${parts[0]!.trim()}` : String(name ?? ''))
}

function isTeamUnit(ref: FantraxPlayerRef): boolean {
  return TEAM_UNITS.has(String(ref.position ?? '').trim().toUpperCase()) || !String(ref.name ?? '').includes(',')
}

export function planNflFantraxIdentityLinks(refs: FantraxPlayerRef[], identities: NflIdentityRow[]) {
  const linkedIds = new Set(identities.map((r) => r.fantraxId?.trim()).filter((id): id is string => Boolean(id)))
  const byName = new Map<string, NflIdentityRow[]>()
  for (const row of identities) {
    const key = normalizePlayerName(row.canonicalName ?? '')
    if (key) byName.set(key, [...(byName.get(key) ?? []), row])
  }

  const proposed: Array<{ id: string; fantraxId: string }> = []
  let resolvedById = 0, unmatched = 0, ambiguous = 0, conflicts = 0, teamEntries = 0
  for (const ref of refs) {
    const fantraxId = String(ref.fantraxId ?? '').trim()
    if (!fantraxId) { unmatched++; continue }
    if (linkedIds.has(fantraxId)) { resolvedById++; continue }
    if (isTeamUnit(ref)) { teamEntries++; continue }
    const team = teamCode(ref.team)
    const roles = groups(ref.position)
    if (!team || roles.size === 0) { unmatched++; continue }
    const candidates = (byName.get(fantraxNflNameKey(ref.name)) ?? []).filter(
      (row) => teamCode(row.currentTeam) === team && [...groups(row.position)].some((g) => roles.has(g)),
    )
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
