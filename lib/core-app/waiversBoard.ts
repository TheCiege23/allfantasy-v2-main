import 'server-only'

import { prisma } from '@/lib/prisma'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { getRosteredMarket, MIN_LEAGUES_FOR_MARKET } from './rosteredMarket'
import { latestProjectionWeek } from './playerProjections'
import { leagueArtUrl } from './leagueArt'
import { leagueDisplayName } from './leagueHome'
import { myRosterCandidates } from './myRoster'
import { countRealLeagues, keepBestPerRealLeague } from './realLeague'
import { sleeperReadablePlayerData } from './rosterIdSpace'
import { ruledOutByFact } from './injuryStatus'
import { sleeperIdWhere } from '@/lib/player-identity/externalIdNamespace'
import { isStartableIn, startingSlots } from './slotEligibility'
import { resolveInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import type { WaiverValueBasis } from '@/lib/waivers/waiverSportBasis'
import { faabRemainingOf, formatOf, runsAtLabel } from './waiverRowMeta'
import { buildWaiverSportSections } from './waiversBoardSports'

/**
 * Waivers, across every league — "the single best add on each wire, ranked by
 * how much it actually gains you".
 *
 * 2026-09-07 handoff (`AF Core Waivers.dc.html`).
 *
 * ── The ranking rule ────────────────────────────────────────────────────────
 *
 * NET GAIN: the league-scored projection of the best available player, minus
 * the league-scored projection of the weakest player you would drop for him.
 * That is the only cross-league comparable quantity on this screen — a FAAB bid
 * is not comparable between leagues, and neither is a raw projection, because
 * the same player is worth different points under different scoring.
 *
 * ── Every number here is computed, and none of it is generated ──────────────
 *
 * ⚠ NO AI CALL. `runWaiverIntelligenceAnalysis` exists and produces a much
 * richer answer, but it costs tokens per league and this board runs on every
 * page load across the whole portfolio. AI spend on this account is ratcheted to
 * zero, so the per-row prose is assembled from the numbers already on the row.
 * A sentence that can only say what the row shows cannot be wrong about it.
 *
 * ── The three things that make a league unpriceable, all stated ─────────────
 *
 * ⚠ 1. THE PROJECTION FEED IS KEYED ON SLEEPER IDS, AND SO ARE ONLY SLEEPER
 * ROSTERS. An ESPN roster stores ESPN player ids; matching those against
 * `fantasyProjection.playerId` finds nothing, so EVERY player in the league
 * would look like a free agent and the "best available" would be the best
 * player in football. That is not a small error, it is the maximally wrong
 * answer, and it is why `idSpaceOk` gates the whole computation on the caller's
 * own roster resolving into the projection id space.
 *
 * ⚠ 2. A LEAGUE WITH NO `scoring_settings` CANNOT BE SCORED. `projectedPoints`
 * on the row is a GENERIC PPR figure — a projection for a league nobody is in.
 * Ranking a superflex TE-premium league against a standard one on that number
 * compares two things that are not the same thing. A league whose settings were
 * never ingested is withheld with that reason rather than ranked on the generic.
 *
 * ⚠ 3. AND THE MARKET PERCENTAGES HAVE A DENOMINATOR GATE. `ownPct` / `startPct`
 * come from `getRosteredMarket`, which refuses to be meaningful below
 * `MIN_LEAGUES_FOR_MARKET` leagues — so they are carried as null rather than as
 * a number drawn from four rosters.
 */

export type WaiverPlayer = {
  /**
   * On an NFL row (`WaiversBoardData.rows`) a SLEEPER id — see `idSpaceOk`. On a season-rate row
   * (`WaiversBoardData.sports[].rows`, which carries `sport`) the projection key
   * (`AFProjectionSnapshot.playerId`) — never a Sleeper id, and never rendered as one.
   */
  playerId: string
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  /** Projected under THIS league's scoring, not the generic preset. */
  projected: number
  /** Share of counted leagues rostering him, 0–1. Null below the market gate. */
  ownPct: number | null
  /** Share of the leagues rostering him that start him, 0–1. Null likewise. */
  startPct: number | null
}

export type WaiverBoardRow = {
  leagueId: string
  leagueName: string
  platform: string
  /**
   * The provider's own league id, carried so two AF rows for ONE real league can
   * be told apart from two genuinely different leagues.
   *
   * ⚠ NOT AN IDENTITY ON ITS OWN — provider ids are unique only within a
   * provider, and a manual league has none at all. `realLeagueKey` pairs it with
   * `platform` and falls back to `leagueId`; do not compare it bare.
   */
  platformLeagueId: string | null
  logoUrl: string | null
  /** "Dynasty · Superflex", from the league's own ingested settings. Null when absent. */
  format: string | null
  /** Best available minus weakest droppable, in this league's points. */
  netGain: number
  add: WaiverPlayer
  drop: WaiverPlayer | null
  /** FAAB left, when the league runs FAAB and a budget was read. */
  faabRemaining: number | null
  /** "Wednesday 09:00 UTC", when the league publishes a processing time. */
  runsAt: string | null
  href: string
  /** One derived sentence. Assembled from the fields above; never generated. */
  reasoning: string
  /**
   * Set only on a season-rate section row, where `netGain` and both `projected` figures are PER
   * GAME from a season rate. Absent on an NFL row, whose figures are the projection week's.
   */
  sport?: string
}

/**
 * One sport's section of the board, for every sport but the NFL.
 *
 * 🛑 A SPORT WITHOUT A PRODUCER IS A SECTION WITH A REASON, NEVER A MISSING ONE. The board used to
 * filter to the NFL and say nothing else: a manager whose leagues are all basketball saw "None of
 * your leagues could be priced this week — the reasons are below" and no reasons below.
 *
 * ⚠ NOT RANKED AGAINST THE NFL ROWS. A per-game basketball gain and a weekly football gain are not
 * the same quantity (an NBA team plays two to four games a week), so each sport ranks on its own.
 */
export type WaiverSportSection = {
  sport: string
  /** `no_producer`: nothing projects this sport. `no_projections`: the producer has written nothing. */
  state: 'ok' | 'no_producer' | 'no_projections'
  /** One line, when `state` is not ok. */
  reason: string | null
  basis: WaiverValueBasis | null
  /** One sentence naming the basis every number in the section was priced on. */
  basisLabel: string | null
  /** The projection season the numbers come from. */
  season: number | null
  rows: WaiverBoardRow[]
  /** Real leagues of this sport considered. */
  considered: number
  withheld: WaiversBoardData['withheld']
}

export type WaiversBoardData = {
  rows: WaiverBoardRow[]
  /** Claimed teams considered. */
  considered: number
  /** Leagues excluded, and why — never silently dropped. */
  withheld: {
    noRoster: number
    idSpace: number
    noScoring: number
    noCandidate: number
  }
  /** Leagues the market percentages were computed over, for the honesty gate. */
  marketLeagues: number
  /** The projection week every figure on the board is drawn from. */
  at: { season: string; week: number } | null
  /**
   * One kickoff per fixture of the projection week (ISO), so the renderer can say how much of it
   * has already been played. Null when the schedule is unread.
   *
   * ⚠ KICKOFF TIMES, NOT A "PLAYED" COUNT — THIS MODULE MUST STAY CLOCK-FREE. The board is served
   * from the screen-summary cache (`waiversBoardSummary`), which is only sound because nothing
   * here reads `now`; a count taken at build time would freeze in the cache. The first version of
   * this field did exactly that and the summary's own guard test caught it. The renderer counts.
   *
   * 🛑 THE FEED HOLDS ONE WEEK, AND ON A MONDAY THAT WEEK IS OVER. Production 2026-09-28: the board
   * ranked week-3 projections with 13 of 14 week-3 games played, for claims that process Tuesday for
   * week 4. There is no week-4 line to rank on instead (see projections-hold-one-week), so the
   * board says which week it is pricing and how much of it is gone rather than presenting it as
   * next week's points.
   */
  weekKickoffs: string[] | null
  /**
   * Every other sport the account holds a team in, one section each — present only when there is
   * at least one, so an NFL-only account's payload is exactly what it was.
   */
  sports?: WaiverSportSection[]
}

const EMPTY: WaiversBoardData = {
  rows: [],
  considered: 0,
  withheld: { noRoster: 0, idSpace: 0, noScoring: 0, noCandidate: 0 },
  marketLeagues: 0,
  at: null,
  weekKickoffs: null,
}

/** How many free-agent candidates to consider. The wire below this is noise. */
const CANDIDATE_POOL = 900

/** How many leagues the board renders. */
const ROW_CAP = 10

/**
 * The share of your own roster that must resolve into the projection id space
 * before this league can be priced at all.
 *
 * ⚠ NOT ZERO, AND NOT ONE. Even a Sleeper roster carries ids we cannot place —
 * a rookie the feed has not picked up, an id retired mid-season. Requiring a
 * perfect match would withhold healthy leagues; requiring one match would let an
 * ESPN league through on a single coincidental id collision and then declare the
 * best player in football a free agent there.
 */
const ID_SPACE_FLOOR = 0.5

function rosterIds(playerData: unknown): { all: string[]; starters: Set<string> } {
  const out: string[] = []
  const starters = new Set<string>()
  if (!playerData || typeof playerData !== 'object') return { all: out, starters }
  const d = playerData as Record<string, unknown>
  for (const key of ['players', 'starters', 'taxi', 'reserve']) {
    const raw = d[key]
    if (!Array.isArray(raw)) continue
    for (const x of raw) {
      const v = x == null ? '' : String(x).trim()
      /* Sleeper writes an unfilled starting slot as "0" — a hole, not a player. */
      if (!v || v === '0') continue
      out.push(v)
      if (key === 'starters') starters.add(v)
    }
  }
  return { all: [...new Set(out)], starters }
}

/** Every team this account has claimed, with the league fields both halves of the board read. */
function readClaimedTeams(userId: string) {
  return prisma.leagueTeam
    .findMany({
      where: { claimedByUserId: userId },
      select: {
        leagueId: true,
        externalId: true,
        platformUserId: true,
        league: {
          select: {
            id: true,
            name: true,
            platform: true,
            sport: true,
            settings: true,
            /* Needed to tell one REAL league from one AF row of it — see realLeague.ts. */
            platformLeagueId: true,
            leagueType: true,
            /* ⚠ `scoring`, NOT `scoringType` — the column is named `scoring` on League. */
            scoring: true,
            logoUrl: true,
            avatarUrl: true,
          },
        },
      },
    })
    .catch(() => [])
}

export type ClaimedTeam = Awaited<ReturnType<typeof readClaimedTeams>>[number]

export async function getWaiversBoard(userId: string): Promise<WaiversBoardData> {
  const claimed = await readClaimedTeams(userId)

  /*
   * The NFL rows and every other sport's section are computed apart and never ranked together —
   * see `WaiverSportSection`. A section that cannot be built costs the sections, never the NFL rows.
   */
  const [nfl, sports] = await Promise.all([
    nflWaiversBoard(claimed, userId),
    buildWaiverSportSections(claimed, userId).catch(() => [] as WaiverSportSection[]),
  ])
  return sports.length > 0 ? { ...nfl, sports } : nfl
}

/** The NFL board, exactly as it was before the other sports joined it. */
async function nflWaiversBoard(claimed: readonly ClaimedTeam[], userId: string): Promise<WaiversBoardData> {
  /*
   * ⚠ NFL ONLY, DELIBERATELY. `fantasyProjection` is an NFL feed keyed on Sleeper
   * ids; NCAAF projections live in a different table behind a different lookup
   * and the other sports have no weekly feed here at all. Pricing a basketball
   * wire against football projections is not a degraded answer, it is a wrong
   * one — so those leagues are priced in their own sections (waiversBoardSports.ts).
   */
  const mine = claimed.filter(
    (c) => c.league != null && String(c.league.sport ?? 'NFL').toUpperCase() === 'NFL',
  )
  /*
   * NFL leagues considered: none. This used to report every claimed team here, so an account whose
   * leagues were all basketball read "None of your leagues could be priced this week — the reasons
   * are below" with no reasons below. Those leagues are counted in their own sections now.
   */
  if (mine.length === 0) return { ...EMPTY, considered: 0 }

  const leagueIds = [...new Set(mine.map((c) => c.leagueId))]

  const at = await latestProjectionWeek()
  if (!at) return { ...EMPTY, considered: mine.length }

  type RosterRow = {
    leagueId: string
    platformUserId: string
    playerData: unknown
    faabRemaining: number | null
  }

  const [rosters, waiverSettings, topProjections, market] = await Promise.all([
    prisma.roster
      .findMany({
        where: { leagueId: { in: leagueIds } },
        select: { leagueId: true, platformUserId: true, playerData: true, faabRemaining: true },
      })
      .catch(() => [] as RosterRow[]),
    prisma.leagueWaiverSettings
      .findMany({
        where: { leagueId: { in: leagueIds } },
        select: {
          leagueId: true,
          waiverType: true,
          processingDayOfWeek: true,
          processingTimeUtc: true,
        },
      })
      .catch(() => []),
    /*
     * ⚠ ONE READ FOR THE WHOLE PORTFOLIO'S CANDIDATE POOL. The alternative — a
     * free-agent query per league — is the N+1 fan-out that took production
     * Postgres to an OOM. The pool is ordered by the generic figure purely to
     * bound the set; every number the board PRINTS is re-scored per league below.
     */
    prisma.fantasyProjection
      .findMany({
        where: { season: at.season, week: at.week, source: { not: 'allfantasy' } },
        orderBy: { projectedPoints: 'desc' },
        take: CANDIDATE_POOL,
        select: { playerId: true, projectedPoints: true, stats: true },
      })
      .catch(() => []),
    getRosteredMarket({ sport: 'NFL' }),
  ])

  const platformByLeague = new Map(mine.map((c) => [c.leagueId, c.league?.platform]))
  const rostersByLeague = new Map<string, RosterRow[]>()
  for (const raw of rosters) {
    /*
     * A foreign league's ids collide with real Sleeper ids — read raw, they name and drop strangers.
     * Stripped, its roster resolves nothing and the league is withheld as `idSpace`, not left to the
     * ID_SPACE_FLOOR heuristic (which a league with enough collisions passes).
     */
    const r = { ...raw, playerData: sleeperReadablePlayerData(platformByLeague.get(raw.leagueId), raw.playerData) }
    const list = rostersByLeague.get(r.leagueId)
    if (list) list.push(r)
    else rostersByLeague.set(r.leagueId, [r])
  }

  const waiverByLeague = new Map(waiverSettings.map((w) => [w.leagueId, w]))

  /* Component lines, for the per-league re-scoring. */
  type Proj = { playerId: string; generic: number; components: Record<string, unknown> | null }
  const pool: Proj[] = topProjections.map((r) => {
    const s = (r.stats ?? {}) as { stats?: unknown }
    const inner = s.stats
    return {
      playerId: r.playerId,
      generic: Number(r.projectedPoints),
      components:
        inner && typeof inner === 'object' && !Array.isArray(inner)
          ? (inner as Record<string, unknown>)
          : null,
    }
  })
  const poolById = new Map(pool.map((p) => [p.playerId, p]))

  /*
   * Every id we might name on the board: the candidate pool, plus every player
   * on the caller's own rosters (the drop side). One read, three id spaces —
   * the roster id may be ours, the provider's, or Sleeper's.
   */
  const myRosterIds = new Set<string>()
  for (const c of mine) {
    const pool2 = rostersByLeague.get(c.leagueId) ?? []
    const candidates = myRosterCandidates(c, userId)
    const roster = candidates
      .map((k) => pool2.find((r) => r.platformUserId === k))
      .find((r) => r != null)
    if (!roster) continue
    for (const id of rosterIds(roster.playerData).all) myRosterIds.add(id)
  }

  const nameIds = [...new Set([...poolById.keys(), ...myRosterIds])]
  const players =
    nameIds.length > 0
      ? await prisma.sportsPlayer
          .findMany({
            /*
             * 🛑 BY SLEEPER ID ONLY — `sleeperIdWhere`, never a bare id against `externalId`. Every
             * id here is a Sleeper id (the projection feed's and the rosters'), and Rolling
             * Insights writes its OWN numbers into `externalId`: Sleeper 9228 is Bryce Young, RI
             * 9228 is Michael Tarquin, an offensive tackle. This read matched both, keyed its map
             * by both columns, and let the last row win — so Chimmy's Tuesday digest (App Review
             * account, 2026-09-29) said "add Michael Tarquin (OT)" with Bryce Young's 12.4. Of the
             * top 900 week-4 projections, 422 had such an impostor. See externalIdNamespace.ts.
             */
            where: sleeperIdWhere(nameIds, 'NFL'),
            select: {
              sleeperId: true,
              source: true,
              name: true,
              position: true,
              team: true,
              imageUrl: true,
            },
          })
          .catch(() => [])
      : []

  type Meta = {
    name: string
    position: string | null
    team: string | null
    imageUrl: string | null
    sleeperId: string | null
  }
  /*
   * Keyed by `sleeperId` alone. Several rows can carry the same Sleeper id (Sleeper's own, plus RI
   * and TheSportsDB rows the crosswalk stamped) — one person, but Sleeper's row holds the
   * fantasy-shaped fields (`QB`, `CAR`), so it wins a tie rather than whichever row came back last.
   */
  const metaById = new Map<string, Meta>()
  const metaFromSleeper = new Set<string>()
  for (const p of players) {
    const k = p.sleeperId
    if (!k) continue
    const fromSleeper = p.source === 'sleeper'
    if (metaById.has(k) && (metaFromSleeper.has(k) || !fromSleeper)) continue
    metaById.set(k, {
      name: p.name,
      position: p.position ?? null,
      team: p.team ?? null,
      imageUrl: p.imageUrl ?? null,
      sleeperId: k,
    })
    if (fromSleeper) metaFromSleeper.add(k)
  }

  const marketOk = market.leaguesCounted >= MIN_LEAGUES_FOR_MARKET

  /*
   * 🛑 THE PROJECTION FEED DOES NOT KNOW WHO IS HURT, AND THIS BOARD TRUSTED IT. Measured on
   * production 2026-09-28: Jaxson Dart — on IR, and shown as IR on the same account's home and
   * Player Finder — was the #1 add in three leagues at 27.4 projected points, because
   * `fantasyProjection` still carried a week-3 line for him. A pickup who cannot play is not a
   * gain, and naming him first is the single most confident wrong thing this screen can say.
   *
   * So a candidate the injury feed declares ABSENT (IR, Out, PUP, NFI, suspension — `isRuledOut`,
   * the same predicate the home's "cannot play" alert reads) is never named as the add.
   * Questionable and Doubtful stay eligible: uncertainty is not absence (see injuryStatus.ts).
   * ⚠ A GAME-DAY "Out" OLDER THAN THE STALENESS WINDOW IS LAST WEEK'S NEWS and does not exclude —
   * season-scale rulings (IR and the rest) still do, because they hold for months.
   * An unreadable feed excludes nobody: a missing injury row is "no news", never "healthy", but it
   * is not "hurt" either.
   */
  const ruledOut = new Set<string>()
  {
    const lookups = new Map<string, { name: string; position: string | null; team: string | null }>()
    for (const p of pool) {
      const meta = metaById.get(p.playerId)
      if (meta) lookups.set(p.playerId, { name: meta.name, position: meta.position, team: meta.team })
    }
    const injuries =
      lookups.size > 0
        ? await resolveInjuryFacts({ sport: 'NFL', players: [...lookups.values()] }).catch(() => null)
        : null
    if (injuries) {
      for (const [playerId, lookup] of lookups) {
        if (ruledOutByFact(injuries.byPlayer.get(normalizeMatchName(lookup.name)))) ruledOut.add(playerId)
      }
    }
  }

  function toPlayer(id: string, projected: number): WaiverPlayer | null {
    const meta = metaById.get(id)
    if (!meta) return null
    const m = market.byPlayerId.get(id)
    return {
      playerId: id,
      name: meta.name,
      position: meta.position,
      team: meta.team,
      imageUrl: meta.imageUrl,
      projected,
      ownPct: marketOk && m ? m.ownPct : null,
      startPct: marketOk && m ? m.startPct : null,
    }
  }

  const withheld = { noRoster: 0, idSpace: 0, noScoring: 0, noCandidate: 0 }
  const rows: WaiverBoardRow[] = []

  for (const c of mine) {
    const l = c.league!
    const leaguePool = rostersByLeague.get(c.leagueId) ?? []
    const candidates = myRosterCandidates(c, userId)
    const myRoster = candidates
      .map((k) => leaguePool.find((r) => r.platformUserId === k))
      .find((r) => r != null)

    if (!myRoster) {
      withheld.noRoster++
      continue
    }

    const scoring = extractScoringSettings(l.settings)
    if (!scoring) {
      withheld.noScoring++
      continue
    }

    const { all: mineIds, starters } = rosterIds(myRoster.playerData)

    /* Gate 1 — is this roster even in the projection id space? See ID_SPACE_FLOOR. */
    const resolvable = mineIds.filter((id) => metaById.get(id)?.sleeperId != null).length
    if (mineIds.length === 0 || resolvable / mineIds.length < ID_SPACE_FLOOR) {
      withheld.idSpace++
      continue
    }

    /* Everybody held by anybody in this league is off the wire. */
    const takenIds = new Set<string>()
    for (const r of leaguePool) {
      for (const id of rosterIds(r.playerData).all) takenIds.add(id)
    }

    const scoreOf = (p: Proj): number | null => {
      const res = computeLeagueProjectedPoints(p.components, scoring)
      return res ? res.points : null
    }

    /*
     * Best available: highest league-scored projection nobody in the league holds — among players
     * this league could actually START. Without that check the board named an offensive tackle
     * (see isStartableIn).
     */
    const slots = startingSlots(l.settings)
    let bestId: string | null = null
    let bestPts = -Infinity
    for (const p of pool) {
      if (takenIds.has(p.playerId)) continue
      const meta = metaById.get(p.playerId)
      if (!meta) continue
      if (!isStartableIn(slots, meta.position)) continue
      if (ruledOut.has(p.playerId)) continue
      const pts = scoreOf(p)
      if (pts == null) continue
      if (pts > bestPts) {
        bestPts = pts
        bestId = p.playerId
      }
    }

    if (!bestId) {
      withheld.noCandidate++
      continue
    }

    /*
     * Weakest droppable: the lowest league-scored projection among YOUR
     * non-starters.
     *
     * ⚠ NON-STARTERS ONLY. Naming a starter as the drop turns a bench upgrade
     * into a lineup change the manager did not ask for, and on a bye week the
     * lowest projection on a roster is very often somebody's RB1.
     *
     * ⚠ AND A BENCH PLAYER WE CANNOT PRICE IS NOT THE WEAKEST. A missing
     * projection means no data, not zero points — sorting nulls to the bottom
     * would recommend dropping whoever the feed happens not to cover.
     */
    let dropId: string | null = null
    let dropPts = Infinity
    for (const id of mineIds) {
      if (starters.has(id)) continue
      const p = poolById.get(id)
      if (!p) continue
      const pts = scoreOf(p)
      if (pts == null) continue
      if (pts < dropPts) {
        dropPts = pts
        dropId = id
      }
    }

    const add = toPlayer(bestId, bestPts)
    if (!add) {
      withheld.noCandidate++
      continue
    }
    const drop = dropId ? toPlayer(dropId, dropPts) : null

    const w = waiverByLeague.get(c.leagueId)
    const runsAt = runsAtLabel(w)

    const netGain = drop ? add.projected - drop.projected : add.projected

    const bits: string[] = []
    bits.push(
      `${add.name}${add.position ? ` (${add.position})` : ''} projects ${add.projected.toFixed(1)} under this league's own scoring`,
    )
    if (drop) {
      bits.push(
        `against ${drop.projected.toFixed(1)} for ${drop.name}, the weakest bench player we can price — a net ${netGain >= 0 ? '+' : ''}${netGain.toFixed(1)}`,
      )
    } else {
      bits.push('and no bench player here could be priced, so this is a gross figure, not a swap')
    }
    // Its own sentence: tacked on with a comma it read as part of the swap ("…not a swap, rostered in 88%…").
    const ownership =
      add.ownPct != null ? ` Rostered in ${Math.round(add.ownPct * 100)}% of the leagues we can see.` : ''

    rows.push({
      leagueId: c.leagueId,
      leagueName: leagueDisplayName(l.name),
      platform: String(l.platform ?? 'manual').toLowerCase(),
      platformLeagueId: l.platformLeagueId ?? null,
      logoUrl: leagueArtUrl({
        logoUrl: l.logoUrl,
        avatarUrl: l.avatarUrl,
        platform: l.platform,
      }),
      format: formatOf(l.leagueType, l.scoring),
      netGain,
      add,
      drop,
      faabRemaining: faabRemainingOf(w, myRoster),
      runsAt,
      href: `/core/waivers?league=${encodeURIComponent(c.leagueId)}`,
      reasoning: `${bits.join(', ')}.${ownership}`,
    })
  }

  /*
   * 🛑 ONE ROW PER REAL LEAGUE. A Sleeper league imported by two of its members
   * has TWO AF `leagues` rows, and this board is keyed on claimed teams — so it
   * rendered "Parbur" twice and "Its gonna be Maye 26" three times, with
   * identical add/drop/net-gain. Measured for the reporting account: 94 claimed
   * teams across 65 real leagues, 29 duplicate rows.
   *
   * ⚠ COLLAPSED HERE, ON THE OUTPUT, RATHER THAN BY PICKING ONE AF ROW EARLIER.
   * Imported data attaches to whichever AF row the ingest cron reached first, so
   * a twin can be real but empty; a twin that produced no recommendation is
   * simply not in this list to win.
   */
  const deduped = keepBestPerRealLeague(
    rows,
    (r) => ({ platform: r.platform, platformLeagueId: r.platformLeagueId, leagueId: r.leagueId }),
    /* Total on purpose: the stronger recommendation wins, and a tie resolves on
       leagueId so the board cannot show a different copy between two loads. */
    (a, b) => a.netGain > b.netGain || (a.netGain === b.netGain && a.leagueId < b.leagueId),
  )

  deduped.sort((a, b) => b.netGain - a.netGain)

  return {
    rows: deduped.slice(0, ROW_CAP),
    /* Real leagues, not AF rows — otherwise this count inflates the same way. */
    considered: countRealLeagues(
      mine.map((c) => ({
        platform: c.league?.platform ?? null,
        platformLeagueId: c.league?.platformLeagueId ?? null,
        leagueId: c.leagueId,
      })),
    ),
    withheld,
    marketLeagues: market.leaguesCounted,
    at,
    /* A schedule read that fails costs the note, never the board. */
    weekKickoffs: await projectionWeekKickoffs(at).catch(() => null),
  }
}

/** One kickoff per distinct fixture of the projection week. See `weekKickoffs`. */
async function projectionWeekKickoffs(at: { season: string; week: number }): Promise<string[] | null> {
  const season = Number(at.season)
  if (!Number.isFinite(season)) return null
  const games = await prisma.sportsGame
    .findMany({
      where: { sport: 'NFL', season, week: at.week, seasonType: { in: ['regular', 'REG', 'reg', 'Regular', 'regular_season'] } },
      select: { homeTeam: true, awayTeam: true, startTime: true },
    })
    .catch(() => null)
  if (!games || games.length === 0) return null
  /* Each game is stored by more than one source; one fixture per club pair. */
  const kickoffByFixture = new Map<string, Date | null>()
  for (const g of games) {
    const key = [normalizeTeamAbbrev(g.homeTeam) ?? g.homeTeam, normalizeTeamAbbrev(g.awayTeam) ?? g.awayTeam].join('|')
    if (!kickoffByFixture.has(key) || (g.startTime && !kickoffByFixture.get(key))) kickoffByFixture.set(key, g.startTime)
  }
  return [...kickoffByFixture.values()].filter((t): t is Date => t != null).map((t) => t.toISOString()).sort()
}
