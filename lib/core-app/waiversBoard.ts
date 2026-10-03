import 'server-only'

import { prisma } from '@/lib/prisma'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { getRosteredMarket, MIN_LEAGUES_FOR_MARKET } from './rosteredMarket'
import { afEngineForLeague, latestProjectionWeek, lookupAfEngineProjections } from './playerProjections'
import { leagueArtUrl } from './leagueArt'
import { leagueDisplayName } from './leagueHome'
import { myRosterCandidates } from './myRoster'
import { countRealLeagues, keepBestPerRealLeague } from './realLeague'
import { sleeperReadableRosters } from './rosterIdSpace'
import { ruledOutByFact } from './injuryStatus'
import { sleeperIdWhere } from '@/lib/player-identity/externalIdNamespace'
import { isStartableIn, startingSlots } from './slotEligibility'
import { resolveInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import type { WaiverValueBasis } from '@/lib/waivers/waiverSportBasis'
import { faabRemainingOf, formatOf, rowWaiverSchedule } from './waiverRowMeta'
import type { WaiverSchedule } from './waiverRunClock'
import { loadObservedWaiverSchedules, type ObservedWaiverSchedule } from '@/lib/waivers/observedWaiverSchedule'
import { buildWaiverSportSections } from './waiversBoardSports'
import { pickLineupSwap, rosterCapacity, swapReasoning, type SwapCandidate, type SwapRosterPlayer } from './waiverSwap'
import { valueBookFor, valueBookKey, type ValueBook } from './valueBook'
import { loadLatestPlayerValueSnapshots } from '@/lib/player-values/latestPlayerValueSnapshots'

/**
 * Waivers, across every league — "the single best add on each wire, ranked by
 * how much it actually gains you".
 *
 * 2026-09-07 handoff (`AF Core Waivers.dc.html`).
 *
 * ── The ranking rule ────────────────────────────────────────────────────────
 *
 * NET GAIN: what the add does to your best starting lineup, in league-scored
 * projected points (`waiverSwap.ts`, the league screen's own rule). That is the
 * only cross-league comparable quantity on this screen — a FAAB bid is not
 * comparable between leagues, and neither is a raw projection, because the same
 * player is worth different points under different scoring.
 *
 * 🛑 IT WAS "BEST AVAILABLE MINUS WEAKEST BENCH PLAYER" UNTIL 2026-10-02, and that
 * never asked whether the add would start: in a one-QB league it named a backup
 * quarterback as the top add while the league screen said nobody on that wire
 * improved the lineup. The drop is now chosen separately — by market value on a
 * dynasty-chart league, by projection elsewhere.
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
  /**
   * AllFantasy's own engine for the same player, carried into this league's scoring
   * (`afEngineForLeague`). NFL rows only; absent when the engine has no row for him. Shown beside
   * `projected` — it never ranks the board or picks the add or the drop.
   */
  afProjected?: number
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
  /**
   * What the add does to your best starting lineup, in this league's points — the ranking key.
   * Never "best available minus weakest bench player": that ranked adds who would never start.
   * See `waiverSwap.ts`.
   */
  netGain: number
  /**
   * The starter the add would take the place of; null when he fills an empty slot. `playerId` is
   * the same id space as `add.playerId`, so the AF engine can price this side of the swap too.
   */
  startsOver?: { playerId: string; name: string; projected: number; afProjected?: number } | null
  /** Why this drop: lowest dynasty market value on the bench, or lowest projection (redraft). */
  dropBasis?: 'market_value' | 'projection' | null
  /** The roster has an empty spot, so no drop is needed — why `drop` is null when it is. */
  openRosterSpot?: boolean
  /**
   * The same swap on AllFantasy's own engine. Present only when the engine priced the add AND
   * (when there is one) the drop — half a swap is not a gain.
   */
  afNetGain?: number
  add: WaiverPlayer
  drop: WaiverPlayer | null
  /** FAAB left, when the league runs FAAB and a budget was read. */
  faabRemaining: number | null
  /** "Wednesday 09:00 UTC", when the league publishes a processing time. */
  runsAt: string | null
  /**
   * The same schedule as data, for a countdown rendered in the viewer's timezone. UTC where the
   * importer stored it; Pacific wall-clock where it was OBSERVED from a Sleeper league's own runs.
   */
  runsSchedule?: WaiverSchedule | null
  /**
   * The next-best adds on this wire after `add`, each scored against your lineup as it stands — so
   * "the second option" means what it would mean to someone making one claim. Up to three.
   */
  alternatives?: WaiverAlternative[]
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
    /** A wire was priced and nobody on it would start for you — a finding, not a failure. */
    noUpgrade: number
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
  /**
   * Free agents who would start for you in TWO OR MORE of your leagues — the one view a per-league
   * list cannot give. Real leagues, after the twin collapse; NFL only (a per-game gain and a weekly
   * one do not add up). Absent when nobody qualifies.
   */
  multiLeague?: MultiLeagueAdd[]
}

export type WaiverAlternative = {
  add: WaiverPlayer
  gain: number
  startsOver: { playerId: string; name: string; projected: number } | null
}

export type MultiLeagueAdd = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  /** Sum of the per-league lineup gains — each in that league's own points, so a rough total. */
  totalGain: number
  leagues: Array<{ leagueId: string; leagueName: string; href: string; gain: number; projected: number }>
}

const EMPTY: WaiversBoardData = {
  rows: [],
  considered: 0,
  withheld: { noRoster: 0, idSpace: 0, noScoring: 0, noCandidate: 0, noUpgrade: 0 },
  marketLeagues: 0,
  at: null,
  weekKickoffs: null,
}

/** How many free-agent candidates to consider. The wire below this is noise. */
const CANDIDATE_POOL = 900

/**
 * How many leagues the board carries. The renderer shows the top ten and lets the reader sort,
 * filter and reveal the rest — a manager in 40 leagues used to see ten and a "View all" that led
 * to a league picker, not to the other thirty adds.
 */
const ROW_CAP = 40

/** Next-best adds carried per league. */
const ALTERNATIVES = 3

/** Players in the multi-league list. */
const MULTI_LEAGUE_CAP = 8

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

function rosterIds(playerData: unknown): { all: string[]; starters: Set<string>; stashed: Set<string> } {
  const out: string[] = []
  const starters = new Set<string>()
  /* IR and taxi: rostered, so off the wire, but neither seated in a lineup nor offered as a drop. */
  const stashed = new Set<string>()
  if (!playerData || typeof playerData !== 'object') return { all: out, starters, stashed }
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
      if (key === 'taxi' || key === 'reserve') stashed.add(v)
    }
  }
  return { all: [...new Set(out)], starters, stashed }
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

/**
 * Only the other-sport sections of `getWaiversBoard` — the same claimed teams, the same builder, so
 * a section here is the section that board shows. For Chimmy's per-sport waiver check
 * (lib/chimmy-alerts/runSportWaiverCheck.ts), which has no use for the NFL half and should not pay
 * for it. Unlike the board it does not swallow a section failure: the caller reports it per user.
 */
export async function getWaiverSportSections(userId: string): Promise<WaiverSportSection[]> {
  return buildWaiverSportSections(await readClaimedTeams(userId), userId)
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

  /*
   * Sleeper leagues have no imported schedule; read the one their own claims reveal. One query for
   * every Sleeper league on the board (lib/waivers/observedWaiverSchedule.ts). A failed read costs
   * the countdowns, never the board.
   */
  const observedSchedules = await loadObservedWaiverSchedules(
    prisma,
    mine.filter((c) => String(c.league?.platform ?? '').toLowerCase() === 'sleeper').map((c) => c.leagueId),
  ).catch(() => new Map<string, ObservedWaiverSchedule>())

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
  /*
   * A foreign league's ids collide with real Sleeper ids — read raw, they name and drop strangers.
   * Stripped, its roster resolves nothing and the league is withheld as `idSpace`, not left to the
   * ID_SPACE_FLOOR heuristic (which a league with enough collisions passes). An ESPN roster is
   * translated: read raw, ESPN 12483 (Stafford) was Sleeper's Jack Bech, and Stafford himself — his
   * real id never on the roster — was offered as the best free agent in that league.
   */
  for (const r of await sleeperReadableRosters(rosters, (raw) => platformByLeague.get(raw.leagueId))) {
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

  const withheld = { noRoster: 0, idSpace: 0, noScoring: 0, noCandidate: 0, noUpgrade: 0 }
  const rows: WaiverBoardRow[] = []
  /* Every lineup-improving add per league, for the multi-league view — kept off the rows. */
  const rankedByLeague = new Map<string, Array<{ add: WaiverPlayer; gain: number }>>()

  const myRosterIn = (c: ClaimedTeam) => {
    const leaguePool = rostersByLeague.get(c.leagueId) ?? []
    return myRosterCandidates(c, userId)
      .map((k) => leaguePool.find((r) => r.platformUserId === k))
      .find((r) => r != null)
  }

  /*
   * 🛑 A DYNASTY DROP IS CHOSEN BY MARKET VALUE, SO THE VALUES ARE READ BEFORE THE LOOP — one query
   * per dynasty book in play (at most two: 1QB and superflex), for the bench players of the leagues
   * that need them. The book comes from `valueBookFor`, the one derivation every value surface uses,
   * so a keeper league that keeps a sliver of its roster drops on redraft logic like it prices on
   * the redraft chart (see `pricesOnDynastyChart`). A failed read names no dynasty drop rather than
   * falling back to the weekly projection, which is the rule this exists to replace there.
   */
  const bookByLeague = new Map<string, ValueBook>()
  const dynastyIdsByBook = new Map<string, { book: ValueBook; ids: Set<string> }>()
  for (const c of mine) {
    const book = valueBookFor(c.league!.settings, c.league!.leagueType ?? null)
    bookByLeague.set(c.leagueId, book)
    if (book.format !== 'DYNASTY') continue
    const roster = myRosterIn(c)
    if (!roster) continue
    const { all, starters, stashed } = rosterIds(roster.playerData)
    const k = `${book.format}:${book.qbFormat}`
    const entry = dynastyIdsByBook.get(k) ?? { book, ids: new Set<string>() }
    for (const id of all) if (!starters.has(id) && !stashed.has(id)) entry.ids.add(id)
    dynastyIdsByBook.set(k, entry)
  }
  const marketValue = new Map<string, number>()
  await Promise.all(
    [...dynastyIdsByBook.values()].map(({ book, ids }) =>
      loadLatestPlayerValueSnapshots({ sleeperIds: ids, source: book.source, format: book.format, qbFormat: book.qbFormat })
        .then((snaps) => {
          for (const s of snaps) {
            const v = Number(s.value)
            if (s.sleeperId && Number.isFinite(v)) marketValue.set(valueBookKey(book, s.sleeperId), v)
          }
        })
        .catch(() => undefined),
    ),
  )

  for (const c of mine) {
    const l = c.league!
    const leaguePool = rostersByLeague.get(c.leagueId) ?? []
    const myRoster = myRosterIn(c)

    if (!myRoster) {
      withheld.noRoster++
      continue
    }

    const scoring = extractScoringSettings(l.settings)
    if (!scoring) {
      withheld.noScoring++
      continue
    }

    const { all: mineIds, starters, stashed } = rosterIds(myRoster.playerData)

    /* Gate 1 — is this roster even in the projection id space? See ID_SPACE_FLOOR. */
    const resolvable = mineIds.filter((id) => metaById.get(id)?.sleeperId != null).length
    if (mineIds.length === 0 || resolvable / mineIds.length < ID_SPACE_FLOOR) {
      withheld.idSpace++
      continue
    }

    /*
     * No starting slots, no lineup to improve — counted with the scoring gate, whose note names
     * both, because both mean "this league did not publish what we need to price an add".
     */
    const slots = startingSlots(l.settings)
    if (!slots || slots.length === 0) {
      withheld.noScoring++
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
     * The wire: league-scored projections nobody in the league holds, among players this league
     * could actually START (without that check the board named an offensive tackle — see
     * isStartableIn), and never a player the injury feed rules out (see the IR note above).
     */
    const wire: SwapCandidate[] = []
    const pointsById = new Map<string, number>()
    for (const p of pool) {
      if (takenIds.has(p.playerId)) continue
      const meta = metaById.get(p.playerId)
      if (!meta) continue
      if (!isStartableIn(slots, meta.position)) continue
      if (ruledOut.has(p.playerId)) continue
      const pts = scoreOf(p)
      if (pts == null) continue
      wire.push({ id: p.playerId, position: meta.position, points: pts })
      pointsById.set(p.playerId, pts)
    }

    if (wire.length === 0) {
      withheld.noCandidate++
      continue
    }

    /*
     * Your side of the lineup. IR and taxi sit out of it entirely. A player the injury feed rules
     * out is on the roster but cannot be seated, so he carries no points this week.
     *
     * ⚠ A PLAYER WE CANNOT PRICE IS NOT THE WEAKEST. A missing projection means no data, not zero
     * points — `waiverSwap` never names him as the drop, in either rule.
     */
    const book = bookByLeague.get(c.leagueId) ?? valueBookFor(l.settings, l.leagueType ?? null)
    const dynasty = book.format === 'DYNASTY'
    const roster: SwapRosterPlayer[] = []
    for (const id of mineIds) {
      if (stashed.has(id)) continue
      const p = poolById.get(id)
      const pts = p && !ruledOut.has(id) ? scoreOf(p) : null
      if (pts != null) pointsById.set(id, pts)
      roster.push({
        id,
        position: metaById.get(id)?.position ?? null,
        points: pts,
        marketValue: dynasty ? (marketValue.get(valueBookKey(book, id)) ?? null) : null,
      })
    }

    const swap = pickLineupSwap({
      roster,
      starterIds: starters,
      candidates: wire,
      slots,
      dynasty,
      held: mineIds.filter((id) => !stashed.has(id)).length,
      capacity: rosterCapacity(l.settings),
    })
    if (!swap) {
      withheld.noUpgrade++
      continue
    }

    const add = toPlayer(swap.addId, pointsById.get(swap.addId)!)
    if (!add) {
      withheld.noCandidate++
      continue
    }
    const drop = swap.dropId != null ? toPlayer(swap.dropId, pointsById.get(swap.dropId)!) : null
    const over = swap.displacesId != null ? toPlayer(swap.displacesId, pointsById.get(swap.displacesId)!) : null

    const w = waiverByLeague.get(c.leagueId)
    const sched = rowWaiverSchedule(w, l.platform, observedSchedules.get(c.leagueId))
    const runsAt = sched?.label ?? null

    const ranked: Array<{ add: WaiverPlayer; gain: number; displacesId: string | null }> = []
    for (const r of swap.ranked) {
      const p = toPlayer(r.id, pointsById.get(r.id)!)
      if (p) ranked.push({ add: p, gain: r.gain, displacesId: r.displacesId })
    }
    rankedByLeague.set(c.leagueId, ranked)
    const alternatives: WaiverAlternative[] = ranked.slice(1, 1 + ALTERNATIVES).map((r) => {
      const o = r.displacesId != null ? toPlayer(r.displacesId, pointsById.get(r.displacesId)!) : null
      return {
        add: r.add,
        gain: r.gain,
        startsOver: o ? { playerId: o.playerId, name: o.name, projected: o.projected } : null,
      }
    })

    const netGain = swap.gain
    const reasoning = swapReasoning({
      addLead: `${add.name}${add.position ? ` (${add.position})` : ''} projects ${add.projected.toFixed(1)} under this league's own scoring`,
      over,
      drop,
      dropBasis: swap.dropBasis,
      openRosterSpot: swap.openRosterSpot,
      gain: netGain,
      unit: '',
    })
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
      startsOver: over ? { playerId: over.playerId, name: over.name, projected: over.projected } : null,
      dropBasis: swap.dropBasis,
      openRosterSpot: swap.openRosterSpot,
      add,
      drop,
      faabRemaining: faabRemainingOf(w, myRoster),
      runsAt,
      runsSchedule: sched?.schedule ?? null,
      alternatives,
      href: `/core/waivers?league=${encodeURIComponent(c.leagueId)}`,
      reasoning: `${reasoning}${ownership}`,
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
  const shown = deduped.slice(0, ROW_CAP)
  const multiLeague = multiLeagueAdds(deduped, rankedByLeague)
  /* AllFantasy's own engine beside the provider figures, for the players actually shown. A failed
     read costs the AF figures and nothing else. */
  await attachAfEngine(shown, at, (id) => poolById.get(id)?.generic ?? null).catch(() => undefined)

  return {
    rows: shown,
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
    ...(multiLeague.length > 0 ? { multiLeague } : {}),
  }
}

/**
 * Free agents who would improve your lineup in two or more of your REAL leagues.
 *
 * ⚠ OVER THE DEDUPED ROWS, NOT EVERY AF ROW. Two members' imports of one Sleeper league are two AF
 * rows with identical wires; counting both would turn "available in one league" into "two". The
 * leagues considered are exactly the ones the board kept, by the same `keepBestPerRealLeague` rule.
 */
export function multiLeagueAdds(
  keptRows: readonly WaiverBoardRow[],
  rankedByLeague: ReadonlyMap<string, ReadonlyArray<{ add: WaiverPlayer; gain: number }>>,
): MultiLeagueAdd[] {
  const byPlayer = new Map<string, MultiLeagueAdd>()
  for (const row of keptRows) {
    for (const r of rankedByLeague.get(row.leagueId) ?? []) {
      const cur =
        byPlayer.get(r.add.playerId) ??
        ({
          playerId: r.add.playerId,
          name: r.add.name,
          position: r.add.position,
          team: r.add.team,
          imageUrl: r.add.imageUrl,
          totalGain: 0,
          leagues: [],
        } satisfies MultiLeagueAdd)
      cur.leagues.push({ leagueId: row.leagueId, leagueName: row.leagueName, href: row.href, gain: r.gain, projected: r.add.projected })
      cur.totalGain = Math.round((cur.totalGain + r.gain) * 100) / 100
      byPlayer.set(r.add.playerId, cur)
    }
  }
  return [...byPlayer.values()]
    .filter((p) => p.leagues.length >= 2)
    .map((p) => ({ ...p, leagues: [...p.leagues].sort((a, b) => b.gain - a.gain) }))
    .sort((a, b) => b.leagues.length - a.leagues.length || b.totalGain - a.totalGain || (a.playerId < b.playerId ? -1 : 1))
    .slice(0, MULTI_LEAGUE_CAP)
}

/**
 * Put AllFantasy's own engine number beside each shown player, and on the swap.
 *
 * One read for every add and drop on the board. Each figure is the engine's PPR number scaled by
 * that player's provider line (`generic` PPR against the league-scored `projected`) — the same
 * carry-over every /core surface uses — so it is in this league's points like the figure beside it.
 */
export async function attachAfEngine(
  rows: WaiverBoardRow[],
  at: { season: string; week: number },
  genericOf: (playerId: string) => number | null,
): Promise<void> {
  const ids = [
    ...new Set(
      rows.flatMap((r) => [
        r.add.playerId,
        ...(r.drop ? [r.drop.playerId] : []),
        ...(r.startsOver ? [r.startsOver.playerId] : []),
      ]),
    ),
  ]
  if (ids.length === 0) return
  const engine = await lookupAfEngineProjections(ids, at)
  for (const r of rows) {
    for (const p of [r.add, r.drop, r.startsOver]) {
      if (!p) continue
      const v = afEngineForLeague(engine.get(p.playerId), genericOf(p.playerId), p.projected)
      if (v != null) p.afProjected = v
    }
    /*
     * ⚠ THE SAME SWAP AS THE PILL BESIDE IT: the add against the starter he displaces, or the whole
     * add when he fills an empty slot. This was add minus DROP, which matched the old ranking rule
     * and stopped matching the moment the pill became the lineup gain — two numbers side by side,
     * measuring different swaps. The drop is a bench player; he never scored for you.
     */
    if (r.add.afProjected != null && (!r.startsOver || r.startsOver.afProjected != null)) {
      r.afNetGain = Math.round((r.add.afProjected - (r.startsOver?.afProjected ?? 0)) * 100) / 100
    }
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
