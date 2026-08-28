import 'server-only'

import { prisma } from '@/lib/prisma'
import { getSeasonStatsBoard, scoreStatLine } from '@/lib/sports-data/sleeperMarketService'
import { resolveProviderScoringStatKey } from '@/lib/scoring-defaults/ScoringKeyAliasResolver'
import { gradePicks, type GradablePick } from './gradeDraftPicks'
import type { DraftReportPayload, DraftReportSeason } from './draftReportService'

/**
 * Grade a draft we imported, from rows we already hold.
 *
 * The Sleeper grader fetches everything live from Sleeper and is keyed on a Sleeper
 * league id, so an imported ESPN or Fantrax draft has no way into it. This reads
 * `DraftFact` instead and hands the result to the SAME `gradePicks`, so the letters
 * are comparable across platforms rather than merely similar.
 *
 * ⚠ THE SCORING PROBLEM, AND WHY A PARTIAL TRANSLATION IS THE DANGEROUS CASE.
 * ESPN captures its rules as `espn_stat_<id>` with no names attached — its
 * `scoringItems` carry only `{statId, points}` — and `ScoringKeyAliasResolver` holds
 * exactly ONE verified id (`53` = receptions) under a stated contract not to guess
 * the rest. Feeding that single resolved weight to `scoreStatLine` is worse than
 * feeding it nothing: it would match one key, report `league-scored`, and score every
 * player on RECEPTIONS ALONE while looking authoritative. `sleeperMarketService`
 * records the same shape of failure happening before, where bare-form keys matched
 * nothing and defenders came out ~14x understated.
 *
 * So the rule here is all or nothing. Unless enough core keys resolve to make a real
 * league-scored total, the scoring map is dropped entirely and `scoreStatLine` falls
 * to the feed's own `pts_{format}` aggregate — a real points total, just not this
 * league's exact rules. The payload then carries `scoringBasis: 'format-approx'` and
 * a note, so every surface showing the grade can say what it was computed from.
 */

/** The keys a total has to include before it is worth calling league-scored. */
const CORE_SCORING_KEYS = [
  'pass_yd',
  'pass_td',
  'rush_yd',
  'rush_td',
  'rec_yd',
  'rec_td',
  'rec',
] as const

/**
 * Below this many resolved core keys, the translation is a fragment rather than a
 * scoring system. Four is deliberate: passing and rushing and receiving yardage plus
 * any touchdown rule is the least that produces a defensible total, and anything
 * thinner ranks players by whichever category happened to survive translation.
 */
const MIN_CORE_KEYS = 4

type ResolvedScoring = {
  settings: Record<string, number>
  format: 'ppr' | 'half_ppr' | 'std'
  basis: 'league-scored' | 'format-approx'
  note: string | null
}

/** Provider-namespaced rule keys translated to the stat keys the board uses. */
export function resolveImportedScoring(
  rules: Record<string, unknown> | null | undefined,
  platform: string,
): ResolvedScoring {
  const translated: Record<string, number> = {}
  for (const [rawKey, rawValue] of Object.entries(rules ?? {})) {
    if (typeof rawValue !== 'number') continue
    const key = rawKey.includes('_stat_')
      ? resolveProviderScoringStatKey(rawKey)
      : rawKey.toLowerCase()
    if (!key) continue
    translated[key] = rawValue
  }

  /*
   * Format from the reception weight, which is the one rule that defines it and is
   * verifiable on every platform — including ESPN, whose only known stat id is
   * exactly this one. Derived rather than read from `scoringPresetId`, because that
   * field disagrees in production: both ESPN leagues carry `fb_half_ppr` while their
   * reception rule is 1.0, which is full PPR.
   */
  const reception = translated.rec ?? 0
  const format: 'ppr' | 'half_ppr' | 'std' =
    reception >= 1 ? 'ppr' : reception >= 0.5 ? 'half_ppr' : 'std'

  const covered = CORE_SCORING_KEYS.filter((k) => typeof translated[k] === 'number').length
  if (covered >= MIN_CORE_KEYS) {
    return { settings: translated, format, basis: 'league-scored', note: null }
  }

  return {
    /* Deliberately empty. See the header: a fragment scores worse than nothing. */
    settings: {},
    format,
    basis: 'format-approx',
    note: `Graded on standard ${format === 'half_ppr' ? 'half-PPR' : format === 'std' ? 'standard' : 'PPR'} scoring rather than this league's exact rules — ${platform} records its scoring as numeric stat ids with no names attached, and only ${covered} of them can be translated without guessing.`,
  }
}

/** ESPN/provider draft player ids -> Sleeper player ids, via the identity map. */
async function resolveSleeperIds(
  platform: string,
  providerPlayerIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (providerPlayerIds.length === 0) return out
  /* A Sleeper league's DraftFact rows already hold Sleeper ids. */
  if (platform === 'sleeper') {
    for (const id of providerPlayerIds) out.set(id, id)
    return out
  }
  if (platform !== 'espn') return out

  const rows = await prisma.playerIdentityMap
    .findMany({
      where: { espnId: { in: providerPlayerIds }, sleeperId: { not: null } },
      select: { espnId: true, sleeperId: true },
    })
    .catch(() => [])
  for (const row of rows) {
    if (row.espnId && row.sleeperId) out.set(row.espnId, row.sleeperId)
  }
  return out
}

/** Provider player id -> a displayable name, for the steal/bust lines. */
async function resolveNames(providerPlayerIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (providerPlayerIds.length === 0) return out
  const rows = await prisma.playerProviderIdentity
    .findMany({
      where: { providerPlayerId: { in: providerPlayerIds } },
      select: { providerPlayerId: true, displayName: true },
    })
    .catch(() => [])
  for (const row of rows) {
    if (row.displayName && !out.has(row.providerPlayerId)) {
      out.set(row.providerPlayerId, row.displayName)
    }
  }
  return out
}

/**
 * Build a draft report for an imported league, or null when there is nothing to grade.
 *
 * Returns the same payload shape as the Sleeper path so every consumer is unchanged.
 */
export async function buildImportedDraftReport(
  leagueId: string,
): Promise<DraftReportPayload | null> {
  const league = await prisma.league
    .findUnique({
      where: { id: leagueId },
      select: { id: true, platform: true, settings: true, leagueType: true },
    })
    .catch(() => null)
  if (!league) return null

  const platform = String(league.platform ?? '').toLowerCase()
  const missing: string[] = []

  const facts = await prisma.draftFact
    .findMany({
      where: { leagueId },
      orderBy: [{ season: 'desc' }, { round: 'asc' }, { pickNumber: 'asc' }],
      select: { season: true, round: true, pickNumber: true, playerId: true, managerId: true },
    })
    .catch(() => [])
  if (facts.length === 0) return null

  const settings = (league.settings ?? {}) as Record<string, unknown>
  const scoringSettings = (settings.scoringSettings ?? {}) as Record<string, unknown>
  const scoring = resolveImportedScoring(
    (scoringSettings.rules ?? null) as Record<string, unknown> | null,
    platform,
  )

  const teams = await prisma.leagueTeam
    .findMany({
      where: { leagueId },
      select: { externalId: true, teamName: true, ownerName: true, avatarUrl: true },
    })
    .catch(() => [])
  const teamByKey = new Map(teams.map((t) => [t.externalId ?? '', t]))

  const dynastyLike = String(league.leagueType ?? '').toLowerCase().includes('dynasty')
  /* `DraftFact.season` is nullable, and a pick with no season cannot be graded against
     any season's stats — it is dropped rather than bucketed into a guess. */
  const seasons = [...new Set(facts.map((f) => f.season).filter((v): v is number => v != null))].sort(
    (a, b) => b - a,
  )
  const currentYear = new Date().getUTCFullYear()

  const seasonsOut: DraftReportSeason[] = []
  for (const season of seasons) {
    const rows = facts.filter((f) => f.season === season)
    const complete = season < currentYear
    const board = await getSeasonStatsBoard(String(season), complete)
    if (!board) {
      missing.push(`${season}: season stats`)
      continue
    }

    const providerIds = [...new Set(rows.map((r) => r.playerId).filter(Boolean))]
    const [sleeperIds, names] = await Promise.all([
      resolveSleeperIds(platform, providerIds),
      resolveNames(providerIds),
    ])
    const unresolved = providerIds.filter((id) => !sleeperIds.has(id)).length
    if (unresolved > 0) {
      missing.push(`${season}: ${unresolved} of ${providerIds.length} players not yet linked`)
    }

    const pointsFor = (providerPlayerId: string): number | null => {
      const sleeperId = sleeperIds.get(providerPlayerId)
      if (!sleeperId) return null
      const row = board.players[sleeperId]
      if (!row) return null
      return Math.round(scoreStatLine(row.stats, scoring.settings, scoring.format).points * 10) / 10
    }

    const gradable: GradablePick[] = rows.map((r) => {
      const teamKey = r.managerId ?? ''
      const team = teamByKey.get(teamKey)
      const points = pointsFor(r.playerId)
      return {
        pickNo: r.pickNumber,
        round: r.round,
        playerId: sleeperIds.get(r.playerId) ?? null,
        playerName: names.get(r.playerId) ?? 'Player',
        position: null,
        byOwnerId: teamKey || null,
        byName: team?.ownerName?.trim() || 'Manager',
        teamName: team?.teamName?.trim() || null,
        avatar: team?.avatarUrl ?? null,
        initialPoints: points,
        /* Redraft grades the draft year alone; the two are equal by construction and
           the UI already declines to show a trend when they are. A dynasty league
           wants points since the draft, which needs every season from this one
           onward — added when more than one imported season exists to sum. */
        currentPoints: points,
      }
    })

    const graded = gradePicks(gradable)
    seasonsOut.push({
      season: String(season),
      draftId: `${leagueId}:${season}`,
      rounds: graded.rounds,
      totalPicks: rows.length,
      gradedPicks: graded.gradedPicks.filter((g) => g.initialValueOver != null).length,
      /* An unfinished season is partial by definition — the points are still arriving. */
      partial: !complete,
      managers: graded.managers,
      steals: graded.steals,
      busts: graded.busts,
    })
  }

  if (seasonsOut.length === 0) return null

  return {
    version: 1,
    fetchedAt: new Date().toISOString(),
    staleAsOf: null,
    /* Not a Sleeper league. The field is named for the path that came first; the AF
       league id is what identifies this report. */
    sleeperLeagueId: leagueId,
    dynastyLike,
    scoringBasis: scoring.basis,
    scoringNote: scoring.note,
    gradeScale: {
      description:
        'Value over round: each pick’s scored points minus the MEDIAN produced by that round’s picks. Grade = average value-over per pick. Recompute any letter from the numbers shown.',
      thresholds: [
        { letter: 'A', minAvgPerPick: 25 },
        { letter: 'B', minAvgPerPick: 10 },
        { letter: 'C', minAvgPerPick: -10 },
        { letter: 'D', minAvgPerPick: -25 },
        { letter: 'F', minAvgPerPick: null },
      ],
    },
    seasons: seasonsOut,
    missing,
  }
}
