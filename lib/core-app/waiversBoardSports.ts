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
import { canFillSlotForSport, isStartableInSport } from './sportSlotEligibility'
import { pickLineupSwap, rosterCapacity, swapReasoning, type SwapCandidate, type SwapRosterPlayer } from './waiverSwap'
import { startingSlots } from './slotEligibility'
import { faabRemainingOf, formatOf, runsAtLabel } from './waiverRowMeta'
import type { ClaimedTeam, WaiverBoardRow, WaiverPlayer, WaiverSportSection } from './waiversBoard'

/**
 * The cross-league Waivers board for every sport but the NFL — one section per sport.
 *
 * Same rule as the NFL rows beside it (the free agent who adds the most to your starting lineup,
 * ranked by that gain — `waiverSwap.ts`) on each sport's own producer — see
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

const noWithheld = () => ({ noRoster: 0, idSpace: 0, noScoring: 0, noCandidate: 0, noUpgrade: 0 })

/** IR and taxi on a stored roster blob — rostered, but neither seated nor offered as a drop. */
function stashedIdsOf(playerData: unknown): Set<string> {
  const out = new Set<string>()
  if (!playerData || typeof playerData !== 'object') return out
  const d = playerData as Record<string, unknown>
  for (const key of ['reserve', 'taxi']) {
    const raw = d[key]
    if (!Array.isArray(raw)) continue
    for (const x of raw) {
      const v = x == null ? '' : String(x).trim()
      if (v && v !== '0') out.add(v)
    }
  }
  return out
}

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
    if (!slots || slots.length === 0) {
      withheld.noScoring++
      continue
    }
    const fits = (slot: string, position: string | null) => canFillSlotForSport(sport, slot, position)

    /* The wire, priced per game; never a player the injury feed rules out. */
    const wire: SwapCandidate[] = []
    const rowByKey = new Map<string, SeasonRateRow>()
    const pointsByKey = new Map<string, number>()
    for (const row of pool) {
      if (myKeys.has(row.key)) continue
      // A player with no id in this league's space cannot be looked for on its rosters: not provably free.
      const leagueId = leagueIdOf(identity.get(row.key), column)
      if (!leagueId || taken.has(leagueId)) continue
      if (!isStartableInSport(sport, slots, row.position)) continue
      if (ruledOut.has(row.key)) continue
      const pts = priceSeasonRate(row, basis, scoring)
      if (pts == null) continue
      wire.push({ id: row.key, position: row.position, points: pts })
      rowByKey.set(row.key, row)
      pointsByKey.set(row.key, pts)
    }
    if (wire.length === 0) {
      withheld.noCandidate++
      continue
    }

    /*
     * Your lineup side, keyed by projection key. IR and taxi sit out of it. No dynasty value chart
     * exists for these sports, so the drop is by projection — the rule a redraft league gets.
     */
    const starterIds = starterIdsOf(myRoster.playerData)
    const stashed = stashedIdsOf(myRoster.playerData)
    const starterKeys = new Set<string>()
    const roster: SwapRosterPlayer[] = []
    const seen = new Set<string>()
    for (const id of mineIds) {
      if (stashed.has(id)) continue
      const key = keyOf.get(id)
      if (!key || seen.has(key)) continue
      seen.add(key)
      if (starterIds.has(id)) starterKeys.add(key)
      const row = myRows.get(key)
      const pts = row && !ruledOut.has(key) ? priceSeasonRate(row, basis, scoring) : null
      if (row) rowByKey.set(key, row)
      if (pts != null) pointsByKey.set(key, pts)
      roster.push({ id: key, position: row?.position ?? null, points: pts })
    }

    const swap = pickLineupSwap({
      roster,
      starterIds: starterKeys,
      candidates: wire,
      slots,
      fits,
      dynasty: false,
      held: mineIds.filter((id) => !stashed.has(id)).length,
      capacity: rosterCapacity(l.settings),
    })
    if (!swap) {
      withheld.noUpgrade++
      continue
    }

    const playerFor = (key: string | null) =>
      key != null && rowByKey.has(key) && pointsByKey.has(key) ? toPlayer(rowByKey.get(key)!, pointsByKey.get(key)!) : null
    const add = playerFor(swap.addId)!
    const dropPlayer = playerFor(swap.dropId)
    const over = playerFor(swap.displacesId)
    const netGain = swap.gain

    const reasoning = swapReasoning({
      addLead: `${add.name}${add.position ? ` (${add.position})` : ''} projects ${add.projected.toFixed(1)} per game ${basisPhrase}, from AllFantasy's ${label} season projection`,
      over,
      drop: dropPlayer,
      dropBasis: swap.dropBasis,
      openRosterSpot: swap.openRosterSpot,
      gain: netGain,
      unit: ' per game',
    })

    const w = waiverByLeague.get(c.leagueId)
    rows.push({
      leagueId: c.leagueId,
      leagueName: leagueDisplayName(l.name),
      platform: String(l.platform ?? 'manual').toLowerCase(),
      platformLeagueId: l.platformLeagueId ?? null,
      logoUrl: leagueArtUrl({ logoUrl: l.logoUrl, avatarUrl: l.avatarUrl, platform: l.platform }),
      format: formatOf(l.leagueType, l.scoring),
      netGain,
      startsOver: over ? { playerId: over.playerId, name: over.name, projected: over.projected } : null,
      dropBasis: swap.dropBasis,
      openRosterSpot: swap.openRosterSpot,
      add,
      drop: dropPlayer,
      faabRemaining: faabRemainingOf(w, myRoster),
      runsAt: runsAtLabel(w, l.platform),
      href: `/core/waivers?league=${encodeURIComponent(c.leagueId)}`,
      reasoning,
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
