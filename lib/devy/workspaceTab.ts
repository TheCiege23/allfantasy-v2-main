/**
 * Devy in the league workspace (2026-11-07).
 *
 * The Devy league home — the pipeline (stash, pro roster and taxi counts), promotions, the devy draft center and the
 * commissioner's devy tools (components/devy/DevyHome) — was built, but its only entry point was
 * `components/app/tabs/OverviewTab`, which nothing imports. LeagueShell's other Devy surfaces (the Devy hero and the
 * Roster / Taxi / Devy / Picks / History link row) render only when `!nativeWorkspace`, so in an AllFantasy-hosted
 * Devy league none of it showed: members got the Dynasty group (Dynasty hub, Taxi, Picks) and nothing Devy.
 *
 * Detection is synchronous and reads the league's own columns, because LeagueShell builds its tab list from them.
 * C2C (campus-to-canton) is deliberately NOT included — it has its own home and its own work in flight.
 */
export const DEVY_TAB = { id: 'devy', label: 'Devy pipeline' } as const

const DEVY_VARIANTS = new Set(['devy', 'devy_dynasty'])
const DEVY_TYPES = new Set(['devy'])

export function isDevyWorkspaceLeague(league: { leagueVariant?: string | null; leagueType?: string | null } | null | undefined): boolean {
  if (!league) return false
  const variant = String(league.leagueVariant ?? '').trim().toLowerCase()
  const type = String(league.leagueType ?? '').trim().toLowerCase()
  return DEVY_VARIANTS.has(variant) || DEVY_TYPES.has(type)
}

/** `?tab=` / `?view=` aliases, merged into LeagueShell's deep-link map. */
export const DEVY_TAB_ALIASES: Record<string, string> = {
  devy: 'devy',
  devy_pipeline: 'devy',
  pipeline: 'devy',
  devy_home: 'devy',
}
