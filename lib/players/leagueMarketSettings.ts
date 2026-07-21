import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import type { FantasyCalcSettings } from '@/lib/fantasycalc'

/**
 * Resolves the real scoring/roster settings of a league into the shape the trade
 * market needs, so a player's value is expressed for THAT league rather than as a
 * universal number. A superflex league values quarterbacks far above a 1-QB league;
 * showing one figure for both would be wrong in at least one of them.
 *
 * ── The two id spaces ────────────────────────────────────────────────────────
 * This repo has two incompatible league id spaces, and picking the wrong guard
 * fails closed and silently — the caller gets "no access" for a league they own,
 * and the code looks correct in review:
 *
 *   modern / internal — `League.id`, a uuid. Guarded by `resolveLeagueAccess`.
 *                       66 rows in production.
 *   legacy / Sleeper  — `LegacyLeague.sleeperLeagueId`, an 18-digit numeric string.
 *                       Ownership runs LegacyLeague.userId → LegacyUser.id →
 *                       AppUser.legacyUserId. 859 rows in production.
 *
 * Because a uuid can never equal a numeric Sleeper id, the space is detectable from
 * the value itself. Most imported leagues live in the legacy space, so a resolver
 * that only understood the modern one would miss the large majority of real leagues.
 *
 * There is a `resolveLegacyLeagueAccess` helper on an unmerged branch; it is NOT on
 * main, so the legacy ownership check is written out explicitly here rather than
 * imported from a module that does not exist yet.
 */

export interface LeagueMarketContext {
  leagueId: string
  leagueName: string
  settings: FantasyCalcSettings
  /** Human-readable explanation of how the settings were derived, shown in the UI. */
  derivedFrom: string
  /** Any league attribute we had to assume rather than read. */
  dataGaps: string[]
}

/** A Sleeper league id is all digits; an internal League.id is a uuid. */
function looksLikeSleeperLeagueId(id: string): boolean {
  return /^\d{6,}$/.test(id)
}

export async function resolveLeagueMarketSettings(args: {
  leagueId: string
  userId: string
}): Promise<LeagueMarketContext | null> {
  const { leagueId, userId } = args
  if (!leagueId) return null

  return looksLikeSleeperLeagueId(leagueId)
    ? resolveFromLegacyLeague(leagueId, userId)
    : resolveFromModernLeague(leagueId, userId)
}

/**
 * Legacy / Sleeper space. Ownership is proven by walking from the authenticated
 * AppUser to its linked LegacyUser, then requiring the league to belong to it —
 * never by trusting a username or league id supplied by the caller.
 */
async function resolveFromLegacyLeague(
  sleeperLeagueId: string,
  userId: string,
): Promise<LeagueMarketContext | null> {
  const appUser = await prisma.appUser.findUnique({
    where: { id: userId },
    select: { legacyUserId: true },
  })
  if (!appUser?.legacyUserId) return null

  const league = await prisma.legacyLeague.findFirst({
    where: { sleeperLeagueId, userId: appUser.legacyUserId },
    select: {
      sleeperLeagueId: true,
      name: true,
      scoringType: true,
      teamCount: true,
      leagueType: true,
      isSF: true,
    },
  })
  if (!league) return null

  const dataGaps: string[] = []

  const ppr = parsePpr(league.scoringType)
  if (ppr === null) {
    dataGaps.push(
      `Scoring format for ${league.name} is not recorded — values assume full PPR.`,
    )
  }

  const teamCount = league.teamCount
  if (!teamCount) {
    dataGaps.push(`Team count for ${league.name} is not recorded — values assume 12 teams.`)
  }

  const isDynasty = parseIsDynasty(league.leagueType)

  const settings: FantasyCalcSettings = {
    isDynasty,
    numQbs: league.isSF ? 2 : 1,
    numTeams: clampTeams(teamCount ?? 12),
    ppr: ppr ?? 1,
  }

  return {
    leagueId: league.sleeperLeagueId,
    leagueName: league.name,
    settings,
    derivedFrom: describeSettings(settings),
    dataGaps,
  }
}

/**
 * Modern / internal space. `resolveLeagueAccess` returns null rather than throwing
 * for a non-member, which is the behaviour wanted here — an inaccessible league
 * should degrade to generic market values, not error the whole page.
 */
async function resolveFromModernLeague(
  leagueId: string,
  userId: string,
): Promise<LeagueMarketContext | null> {
  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access?.isMember) return null

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    // Note the field names differ from LegacyLeague: `scoring` not `scoringType`,
    // `leagueSize` not `teamCount`. `isDynasty` is a real column here, so unlike
    // the legacy path it does not have to be inferred from a free-text type.
    select: {
      id: true,
      name: true,
      scoring: true,
      leagueSize: true,
      isDynasty: true,
      starters: true,
      settings: true,
      legacyLeagueId: true,
    },
  })
  if (!league) return null

  const dataGaps: string[] = []
  const leagueName = league.name ?? 'This league'

  // Superflex is not a column in the modern space. It can be read from the starter
  // slots, from the settings blob, or from a bridged legacy row — try all three
  // before assuming 1-QB, because assuming wrong materially misprices quarterbacks.
  let isSF = detectSuperflex(league.starters) || detectSuperflex(league.settings)

  if (!isSF && league.legacyLeagueId) {
    const legacy = await prisma.legacyLeague.findUnique({
      where: { id: league.legacyLeagueId },
      select: { isSF: true },
    })
    if (legacy?.isSF) isSF = true
  }

  const ppr = parsePpr(league.scoring)
  if (ppr === null) {
    dataGaps.push(`Scoring format for ${leagueName} is not recorded — values assume full PPR.`)
  }

  if (!league.leagueSize) {
    dataGaps.push(`Team count for ${leagueName} is not recorded — values assume 12 teams.`)
  }

  const settings: FantasyCalcSettings = {
    isDynasty: league.isDynasty,
    numQbs: isSF ? 2 : 1,
    numTeams: clampTeams(league.leagueSize ?? 12),
    ppr: ppr ?? 1,
  }

  return {
    leagueId: league.id,
    leagueName,
    settings,
    derivedFrom: describeSettings(settings),
    dataGaps,
  }
}

/**
 * Superflex detection over untyped JSON. Accepts either an array of roster slots
 * (Sleeper stores `["QB","RB",...,"SUPER_FLEX"]`) or a settings object carrying an
 * explicit flag. Returns false for anything unrecognised rather than throwing —
 * a malformed settings blob should not take the page down.
 */
function detectSuperflex(raw: unknown): boolean {
  if (!raw) return false

  if (Array.isArray(raw)) {
    return raw.some(
      (slot) => typeof slot === 'string' && /super[_\s-]?flex|^sflex$|^sf$/i.test(slot),
    )
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    if (obj.superflex === true || obj.isSF === true || obj.isSuperflex === true) return true
    if (Array.isArray(obj.roster_positions)) return detectSuperflex(obj.roster_positions)
    if (Array.isArray(obj.starters)) return detectSuperflex(obj.starters)
  }

  return false
}

/**
 * Sleeper and the importers record scoring as free text, so match on substrings
 * rather than an exact enum. Returns null when the format is genuinely unknown so
 * the caller can disclose the assumption instead of silently defaulting.
 */
export function parsePpr(scoringType: string | null | undefined): 0 | 0.5 | 1 | null {
  if (!scoringType) return null
  const s = scoringType.toLowerCase()
  if (s.includes('half')) return 0.5
  if (s.includes('ppr')) return s.includes('non') || s.includes('no-') ? 0 : 1
  if (s.includes('standard') || s === 'std') return 0
  return null
}

export function parseIsDynasty(leagueType: string | null | undefined): boolean {
  if (!leagueType) return false
  const t = leagueType.toLowerCase()
  return t.includes('dynasty') || t.includes('keeper')
}

function clampTeams(n: number): number {
  return Math.min(32, Math.max(4, Math.round(n)))
}

function describeSettings(settings: FantasyCalcSettings): string {
  const scoring = settings.ppr === 1 ? 'full PPR' : settings.ppr === 0.5 ? 'half PPR' : 'standard'
  const qb = settings.numQbs === 2 ? 'superflex' : '1-QB'
  const format = settings.isDynasty ? 'dynasty' : 'redraft'
  return `${settings.numTeams}-team ${qb} ${format}, ${scoring}`
}
