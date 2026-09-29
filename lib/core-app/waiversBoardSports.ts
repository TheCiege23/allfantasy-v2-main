import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { extractScoringSettings } from '@/lib/projections/leagueScoring'
import {
  allRosterIds,
  leagueIdColumn,
  leagueIdOf,
  loadIdentityForKeys,
  loadSeasonRatePool,
  loadSeasonRateRows,
  newestSeasonRateSeason,
  priceSeasonRate,
  resolveRosterIdsToKeys,
  SEASON_RATE_ID_FLOOR,
  starterIdsOf,
  type LeagueIdColumn,
  type SeasonRateRow,
} from '@/lib/waivers/seasonRatePool'
import {
  noSeasonProjectionsReason,
  normalizeWaiverSport,
  waiverBasisSentence,
  waiverSportLabel,
  waiverSportPlan,
} from '@/lib/waivers/waiverSportBasis'
import { ruledOutByFact } from './injuryStatus'
import { leagueArtUrl } from './leagueArt'
import { leagueDisplayName } from './leagueHome'
import { myRosterCandidates } from './myRoster'
import { countRealLeagues, keepBestPerRealLeague } from './realLeague'
import { isStartableInSport } from './sportSlotEligibility'
import { startingSlots } from './slotEligibility'
import { faabRemainingOf, formatOf, runsAtLabel } from './waiverRowMeta'
import type { ClaimedTeam, WaiverBoardRow, WaiverPlayer, WaiverSportSection } from './waiversBoard'

/**
 * The cross-league Waivers board for every sport but the NFL — one section per sport.
 *
 * Same rule as the NFL rows beside it (the best available player on each wire, against the weakest
 * bench player we can price, ranked by net gain) on each sport's own producer — see
 * `lib/waivers/waiverSportBasis.ts` for what that producer is and why the category sports are on
 * AllFantasy's default scoring. Reads Postgres only; nothing here calls a provider.
 *
 * ⚠ EACH SPORT RANKS ON ITS OWN. A per-game NBA gain and a weekly NFL gain are different
 * quantities, so they are never sorted into one list and never share a denominator.
 *
 * ⚠ NO MARKET PERCENTAGES. `getRosteredMarket` counts Sleeper ids across NFL leagues; there is no
 * equivalent for these sports, so `ownPct`/`startPct` are null — the renderer's em dash — rather
 * than a rate computed over someone else's leagues.
 *
 * ⚠ CLOCK-FREE, like the NFL half: this is served from the screen-summary cache.
 */

/** Projected players considered per sport. The wire below this is noise, as on the NFL board. */
const POOL = 900
/** Rows per section. */
const ROW_CAP = 10

/** Stable section order, so a board cannot reshuffle between loads. */
const SPORT_ORDER = ['NCAAF', 'NBA', 'NCAAB', 'NHL', 'MLB', 'SOCCER']
const orderOf = (s: string) => {
  const i = SPORT_ORDER.indexOf(s)
  return i === -1 ? SPORT_ORDER.length : i
}

const noWithheld = () => ({ noRoster: 0, idSpace: 0, noScoring: 0, noCandidate: 0 })

type RosterRow = { leagueId: string; platformUserId: string; playerData: unknown; faabRemaining: number | null }

export async function buildWaiverSportSections(
  claimed: readonly ClaimedTeam[],
  userId: string,
): Promise<WaiverSportSection[]> {
  const bySport = new Map<string, ClaimedTeam[]>()
  for (const c of claimed) {
    if (!c.league) continue
    const sport = normalizeWaiverSport(c.league.sport)
    if (sport === 'NFL') continue
    bySport.set(sport, [...(bySport.get(sport) ?? []), c])
  }
  if (bySport.size === 0) return []

  const sports = [...bySport.keys()].sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b))
  const sections = await Promise.all(sports.map((s) => buildSection(s, bySport.get(s)!, userId)))
  return sections
}

function considered(teams: readonly ClaimedTeam[]): number {
  return countRealLeagues(
    teams.map((c) => ({ platform: c.league?.platform ?? null, platformLeagueId: c.league?.platformLeagueId ?? null, leagueId: c.leagueId })),
  )
}

async function buildSection(sport: string, teams: ClaimedTeam[], userId: string): Promise<WaiverSportSection> {
  const plan = waiverSportPlan(sport)
  const base = {
    sport,
    basis: null,
    basisLabel: null,
    season: null,
    rows: [] as WaiverBoardRow[],
    considered: considered(teams),
    withheld: noWithheld(),
  }
  if (plan.kind !== 'per_game') {
    return { ...base, state: 'no_producer', reason: plan.kind === 'none' ? plan.reason : null }
  }
  const basis = plan.basis

  const season = await newestSeasonRateSeason(prisma, sport)
  if (season == null) {
    return { ...base, state: 'no_projections', reason: noSeasonProjectionsReason(sport), basis, basisLabel: waiverBasisSentence(basis, sport) }
  }

  const leagueIds = [...new Set(teams.map((c) => c.leagueId))]
  const [rosters, waiverSettings, pool] = await Promise.all([
    prisma.roster
      .findMany({
        where: { leagueId: { in: leagueIds } },
        select: { leagueId: true, platformUserId: true, playerData: true, faabRemaining: true },
      })
      .catch(() => [] as RosterRow[]),
    prisma.leagueWaiverSettings
      .findMany({
        where: { leagueId: { in: leagueIds } },
        select: { leagueId: true, waiverType: true, processingDayOfWeek: true, processingTimeUtc: true },
      })
      .catch(() => []),
    loadSeasonRatePool(prisma, sport, season, POOL),
  ])
  const rostersByLeague = new Map<string, RosterRow[]>()
  for (const r of rosters as RosterRow[]) rostersByLeague.set(r.leagueId, [...(rostersByLeague.get(r.leagueId) ?? []), r])
  const waiverByLeague = new Map(waiverSettings.map((w) => [w.leagueId, w]))

  /* The caller's roster in each league, found the same way the NFL rows find it. */
  const myRosterOf = new Map<string, RosterRow>()
  for (const c of teams) {
    const list = rostersByLeague.get(c.leagueId) ?? []
    const found = myRosterCandidates(c, userId)
      .map((k) => list.find((r) => r.platformUserId === k))
      .find((r) => r != null)
    if (found) myRosterOf.set(c.leagueId, found)
  }

  /* Roster ids -> projection keys: one read per identity column, every league of that column at once. */
  const idsByColumn = new Map<LeagueIdColumn, Set<string>>()
  for (const c of teams) {
    const column = leagueIdColumn(c.league?.platform)
    const mine = myRosterOf.get(c.leagueId)
    if (!column || !mine) continue
    const set = idsByColumn.get(column) ?? new Set<string>()
    for (const id of allRosterIds(mine.playerData)) set.add(id)
    idsByColumn.set(column, set)
  }
  const keysByColumn = new Map<LeagueIdColumn, Map<string, string>>()
  await Promise.all(
    [...idsByColumn].map(async ([column, ids]) => {
      keysByColumn.set(column, await resolveRosterIdsToKeys(prisma, sport, column, [...ids]))
    }),
  )

  const allMyKeys = new Set<string>()
  for (const m of keysByColumn.values()) for (const k of m.values()) allMyKeys.add(k)
  const [identity, myRows] = await Promise.all([
    loadIdentityForKeys(prisma, sport, pool.map((r) => r.key)),
    loadSeasonRateRows(prisma, sport, season, [...allMyKeys]),
  ])

  /*
   * A pickup who cannot play is not a gain — the NFL rows' rule (see the IR note there), on the
   * sport's own injury feed. An unreadable feed excludes nobody; a sport with no feed excludes
   * nobody, which `resolveInjuryFacts` reports as coverage rather than as "healthy".
   */
  const ruledOut = new Set<string>()
  {
    const lookups = pool.map((r) => ({ key: r.key, name: r.name, position: r.position, team: identity.get(r.key)?.team ?? null }))
    const injuries =
      lookups.length > 0
        ? await resolveInjuryFacts({ sport, players: lookups.map(({ name, position, team }) => ({ name, position, team })) }).catch(() => null)
        : null
    if (injuries) {
      for (const l of lookups) if (ruledOutByFact(injuries.byPlayer.get(normalizeMatchName(l.name)))) ruledOut.add(l.key)
    }
  }

  const toPlayer = (row: SeasonRateRow, projected: number): WaiverPlayer => ({
    playerId: row.key,
    name: row.name,
    position: row.position,
    team: identity.get(row.key)?.team ?? null,
    imageUrl: null,
    projected,
    ownPct: null,
    startPct: null,
  })

  const label = waiverSportLabel(sport)
  const basisPhrase =
    basis === 'season_per_game_league' ? "under this league's own scoring" : "on AllFantasy's default scoring"

  const withheld = noWithheld()
  const rows: WaiverBoardRow[] = []

  for (const c of teams) {
    const l = c.league!
    const myRoster = myRosterOf.get(c.leagueId)
    if (!myRoster) {
      withheld.noRoster++
      continue
    }

    const scoring = extractScoringSettings(l.settings)
    if (basis === 'season_per_game_league' && !scoring) {
      withheld.noScoring++
      continue
    }

    const column = leagueIdColumn(l.platform)
    const mineIds = allRosterIds(myRoster.playerData)
    const keyOf = column ? keysByColumn.get(column) : undefined
    const resolvable = keyOf ? mineIds.filter((id) => keyOf.has(id)).length : 0
    if (!column || !keyOf || mineIds.length === 0 || resolvable / mineIds.length < SEASON_RATE_ID_FLOOR) {
      withheld.idSpace++
      continue
    }

    /* Everybody held by anybody in this league is off the wire — in the LEAGUE's id space. */
    const taken = new Set<string>()
    for (const r of rostersByLeague.get(c.leagueId) ?? []) for (const id of allRosterIds(r.playerData)) taken.add(id)
    const myKeys = new Set(mineIds.map((id) => keyOf.get(id)).filter((k): k is string => k != null))

    const slots = startingSlots(l.settings)
    let best: { row: SeasonRateRow; pts: number } | null = null
    for (const row of pool) {
      if (myKeys.has(row.key)) continue
      // A player with no id in this league's space cannot be looked for on its rosters: not provably free.
      const leagueId = leagueIdOf(identity.get(row.key), column)
      if (!leagueId || taken.has(leagueId)) continue
      if (!isStartableInSport(sport, slots, row.position)) continue
      if (ruledOut.has(row.key)) continue
      const pts = priceSeasonRate(row, basis, scoring)
      if (pts == null) continue
      if (!best || pts > best.pts) best = { row, pts }
    }
    if (!best) {
      withheld.noCandidate++
      continue
    }

    /* Weakest droppable: the lowest priced NON-starter — the NFL rows' rule, for the same reasons. */
    const starters = starterIdsOf(myRoster.playerData)
    let drop: { row: SeasonRateRow; pts: number } | null = null
    for (const id of mineIds) {
      if (starters.has(id)) continue
      const key = keyOf.get(id)
      const row = key ? myRows.get(key) : undefined
      if (!row) continue
      const pts = priceSeasonRate(row, basis, scoring)
      if (pts == null) continue
      if (!drop || pts < drop.pts) drop = { row, pts }
    }

    const add = toPlayer(best.row, best.pts)
    const dropPlayer = drop ? toPlayer(drop.row, drop.pts) : null
    const netGain = dropPlayer ? add.projected - dropPlayer.projected : add.projected

    const bits: string[] = [
      `${add.name}${add.position ? ` (${add.position})` : ''} projects ${add.projected.toFixed(1)} per game ${basisPhrase}, from AllFantasy's ${label} season projection`,
    ]
    bits.push(
      dropPlayer
        ? `against ${dropPlayer.projected.toFixed(1)} for ${dropPlayer.name}, the weakest bench player we can price — a net ${netGain >= 0 ? '+' : ''}${netGain.toFixed(1)} per game`
        : 'and no bench player here could be priced, so this is a gross figure, not a swap',
    )

    const w = waiverByLeague.get(c.leagueId)
    rows.push({
      leagueId: c.leagueId,
      leagueName: leagueDisplayName(l.name),
      platform: String(l.platform ?? 'manual').toLowerCase(),
      platformLeagueId: l.platformLeagueId ?? null,
      logoUrl: leagueArtUrl({ logoUrl: l.logoUrl, avatarUrl: l.avatarUrl, platform: l.platform }),
      format: formatOf(l.leagueType, l.scoring),
      netGain,
      add,
      drop: dropPlayer,
      faabRemaining: faabRemainingOf(w, myRoster),
      runsAt: runsAtLabel(w),
      href: `/core/waivers?league=${encodeURIComponent(c.leagueId)}`,
      reasoning: `${bits.join(', ')}.`,
      sport,
    })
  }

  const deduped = keepBestPerRealLeague(
    rows,
    (r) => ({ platform: r.platform, platformLeagueId: r.platformLeagueId, leagueId: r.leagueId }),
    (a, b) => a.netGain > b.netGain || (a.netGain === b.netGain && a.leagueId < b.leagueId),
  )
  deduped.sort((a, b) => b.netGain - a.netGain)

  return {
    ...base,
    state: 'ok',
    reason: null,
    basis,
    basisLabel: waiverBasisSentence(basis, sport),
    season,
    rows: deduped.slice(0, ROW_CAP),
    withheld,
  }
}
