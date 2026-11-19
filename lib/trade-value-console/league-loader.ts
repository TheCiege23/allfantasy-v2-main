import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { clientLeagueSettings } from '@/lib/league/clientLeagueSettings'

export type LoadedTradeLeague = {
  id: string
  /** The platform's own league id — what the Sleeper endpoints and the IDP board key on. */
  platformLeagueId: string | null
  /** The host platform (`sleeper`, `espn`…), so a grade can say where its league type came from. */
  platform?: string | null
  name: string | null
  sport: LeagueSport
  leagueSize: number | null
  isDynasty: boolean
  leagueType: string | null
  scoring: string | null
  settings: Record<string, unknown> | null
  waiverBudget: number | null
  taxiSlots: number | null
  leagueVariant: string | null
  bestBallMode: boolean | null
  starters: unknown
  /** The league's current season and host status — how a pick whose draft was already held is told apart. */
  season?: number | null
  status?: string | null
}

/** The `League.waiverBudget` column default — what an import leaves when the platform supplies no budget. */
export const WAIVER_BUDGET_COLUMN_DEFAULT = 100

/**
 * Platforms whose import never supplies a waiver budget: no Fantrax mapper sets `faab_budget`, and Yahoo's sets it
 * to null. On these, a stored 100 is the column default, not a fact about the league.
 */
const IMPORT_CARRIES_NO_WAIVER_BUDGET: ReadonlySet<string> = new Set(['fantrax', 'yahoo'])

/** True for a platform whose import records no waiver budget, so the commissioner must state it in AllFantasy. */
export function importCarriesNoWaiverBudget(platform: string | null | undefined): boolean {
  return IMPORT_CARRIES_NO_WAIVER_BUDGET.has(String(platform ?? '').trim().toLowerCase())
}

/** The `League.settings` key a commissioner's own budget save stamps, so a deliberate 100 is trusted. */
export const WAIVER_BUDGET_SET_KEY = 'waiverBudgetSetAt'

/**
 * The league's waiver budget, or null when the stored number is not known to be the league's.
 *
 * 🛑 THE COLUMN DEFAULTS TO 100, AND THE TRADE GRADER READ THAT AS THE LEAGUE'S BUDGET (2026-11-18). A Fantrax league
 * (whose import never records a budget) graded a $5,000 budget move against $100 — a confident, wrong grade — where
 * `waiverBudgetFromLeague` was meant to withhold it as "not graded". So on a platform whose import carries no
 * budget, a stored 100 counts as unknown unless a commissioner saved it (`WAIVER_BUDGET_SET_KEY`). Any other
 * value was put there on purpose, and every other platform's import writes the budget the platform reports — 100
 * is a common real budget there, so it stands.
 */
export function waiverBudgetOnFile(row: { platform: string | null; waiverBudget: number | null; settings: unknown }): number | null {
  const b = row.waiverBudget
  if (typeof b !== 'number' || !Number.isFinite(b) || b <= 0) return null
  if (b !== WAIVER_BUDGET_COLUMN_DEFAULT) return b
  if (!importCarriesNoWaiverBudget(row.platform)) return b
  const settings = row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings) ? (row.settings as Record<string, unknown>) : null
  return settings?.[WAIVER_BUDGET_SET_KEY] ? b : null
}

export async function loadLeagueForTrade(args: {
  leagueId: string
  userId: string
  /** When true, skips `assertLeagueMember` (caller already verified membership, e.g. `assertLeagueMemberWithCode`). */
  membershipPreverified?: boolean
}): Promise<LoadedTradeLeague | null> {
  if (!args.membershipPreverified) {
    const access = await assertLeagueMember(args.leagueId, args.userId)
    if (!access.ok) return null
  }

  const row = await prisma.league.findFirst({
    where: { id: args.leagueId },
    select: {
      id: true,
      platformLeagueId: true,
      platform: true,
      name: true,
      sport: true,
      leagueSize: true,
      isDynasty: true,
      leagueType: true,
      scoring: true,
      settings: true,
      waiverBudget: true,
      taxiSlots: true,
      leagueVariant: true,
      bestBallMode: true,
      starters: true,
      season: true,
      status: true,
    },
  })
  if (!row) return null
  // 🛑 Stripped HERE, once: this row's `settings` is carried whole into the league snapshot that
  // trade-value/analyze, start-sit and trending return to the browser.
  // Nothing reads the retired manager-label keys (lib/league/clientLeagueSettings.ts).
  const settings =
    row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings)
      ? clientLeagueSettings(row.settings as Record<string, unknown>)
      : null
  return {
    id: row.id,
    platformLeagueId: row.platformLeagueId,
    platform: row.platform,
    name: row.name,
    sport: row.sport,
    leagueSize: row.leagueSize,
    isDynasty: row.isDynasty,
    leagueType: row.leagueType,
    scoring: row.scoring,
    settings,
    // Read off the raw row: the stamp a commissioner's save leaves lives in `settings`, which is stripped above.
    waiverBudget: waiverBudgetOnFile({ platform: row.platform, waiverBudget: row.waiverBudget, settings: row.settings }),
    taxiSlots: row.taxiSlots,
    leagueVariant: row.leagueVariant,
    bestBallMode: row.bestBallMode,
    starters: row.starters,
    season: row.season,
    status: row.status,
  }
}
