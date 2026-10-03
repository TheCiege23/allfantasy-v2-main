import 'server-only'

import { prisma } from '@/lib/prisma'
import { computePickInventory } from './draftPickInventory'
export { computePickInventory } from './draftPickInventory'
import { getDraftPreparationData, unavailablePreparation, type DraftPreparationData } from './draftPreparation'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { getDraftReport, type DraftGradeLetter } from '@/lib/draft-intel/draftReportService'
import { buildImportedDraftReport } from '@/lib/draft-intel/importedDraftReport'
import { checkDynastyLotteryEligibility, isDynastyLeagueRow } from '@/lib/draft-lottery/dynastyYearGuard'
import { readDraftOrderModeAndLotteryConfig } from '@/lib/draft-lottery/lotteryConfigStorage'
import { previewLotteryOdds } from '@/lib/draft-lottery/WeightedDraftLotteryEngine'
import {
  dedupeQueueEntries,
  normalizeDraftedNameSet,
  removeDraftedPlayersFromQueue,
} from '@/lib/draft-queue-engine/queue-utils'
import { formatPickLabel, getSlotInRoundForOverall } from '@/lib/live-draft-engine/DraftOrderService'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import type { KeeperConfig, KeeperSelection } from '@/lib/live-draft-engine/keeper/types'
import type { QueueEntry, TradedPickRecord } from '@/lib/live-draft-engine/types'
import { leagueDisplayName, type SectionState } from './leagueHome'
import { leagueContextFor, type LeagueContext, type LeagueContextRow } from './leagueContext'
import { composePlayerIdentities } from './playerIdentityCompose'
import { loadDraftAfProjections, type DraftAfProjection } from './draftAfProjections'
import { parseFormerSleeperKey } from '@/lib/league-import/sleeper/historicalTeamIdentity'

/**
 * Draft HQ — "before the draft: your picks, the lottery, the board settings and
 * a prepared queue".
 *
 * Real, from DraftSession: status, draft type, rounds, team count, and the draft
 * order (slotOrder, a JSON array of { slot, rosterId, displayName }). 28 of 46
 * stored sessions carry an order.
 *
 * Your picks are worked out the way the live draft room works them out: the
 * room's own order maths (`getSlotInRoundForOverall`, 3RR included) finds whose
 * slot each pick is, and `resolvePickOwner` applies `DraftSession.tradedPicks`.
 * That column is written when a draft-pick trade is accepted
 * (`appendDraftPickTrades`), when a new season's draft consumes native future-pick
 * trades (`createNextLeagueDraft`), by a draft import (`ImportCommitFlow`) and by
 * commissioner pick edits — so "2.01, from @dre" and "3.02, traded to Kim" are
 * the board's own answer, not ours. What it cannot see is a trade made on the
 * league's provider (a Sleeper-hosted draft never writes it), and the screen
 * says so for those leagues rather than implying every pick is still yours.
 *
 * The weighted lottery is `lib/draft-lottery`: shown only for a dynasty league,
 * past its startup year (`checkDynastyLotteryEligibility`), whose draft order is
 * set to `weighted_lottery`, and computed by `previewLotteryOdds` — the engine's
 * read-only path, which never draws. Anywhere else the section says why.
 *
 * The queue is the viewer's own `DraftQueue` row for this session, the one the
 * draft room saves; keepers are `DraftSession.keeperSelections` for a draft run
 * here, or Sleeper's `is_keeper` flag on the imported picks when there is none.
 */

export type PickSlot = {
  round: number
  pickInRound: number
  overall: number
  label: string
  /** Who held this pick before a trade brought it to you; null for a pick that was always yours. */
  acquiredFrom: string | null
}

/** One of your original picks that a trade has moved to another team. */
export type TradedAwayPick = {
  round: number
  overall: number
  label: string
  to: string
}

export type PickInventory = {
  held: PickSlot[]
  tradedAway: TradedAwayPick[]
  /** What the ownership cannot see, said where it is read; null when there is nothing to add. */
  note: string | null
}

export type LotteryOdds = {
  /** How many picks the lottery draws. */
  pickCount: number
  playoffTeamCount: number
  /** How the picks after the drawn ones are ordered, in words. */
  fallbackOrder: string
  alreadyRunAt: string | null
  teams: Array<{
    rosterId: string
    name: string
    record: string
    oddsPercent: number
    isYou: boolean
  }>
}

export type PreparedQueue = {
  /** The first few, in queue order. */
  players: Array<{ rank: number; playerName: string; position: string; team: string | null }>
  total: number
}

export type KeeperList = {
  /** `draft`: declared for the draft run here. `imported`: flagged by Sleeper on your last draft. */
  source: 'draft' | 'imported'
  season: number | null
  maxKeepers: number | null
  players: Array<{ playerName: string; position: string; team: string | null; round: number }>
}

export type MadePick = {
  overall: number
  round: number
  label: string
  playerName: string
  position: string
  team: string | null
  /**
   * The headshot, vetted so it can go straight into a `src`. Null for a pick we
   * could not resolve, and for every non-Sleeper league — see
   * `ResolvedDraftPlayer.imageUrl`.
   *
   * ⚠ ON THIS LIST ONLY, NOT ON THE FULL BOARD, AND THAT IS A DELIBERATE
   * OMISSION RATHER THAN AN UNFINISHED ONE. `BoardPick` is every pick by every
   * team — a twelve-team, eighteen-round draft is 216 cells — and a face in
   * each is 216 image requests for a grid whose cells are one line tall. This
   * list is YOUR picks, a dozen rows, where a face is the fastest way to read
   * the row. If the board ever wants them it should ask for them lazily, not
   * inherit them from here.
   */
  imageUrl: string | null
  /** AllFantasy's own projection for the player — see draftAfProjections.ts. Absent when none. */
  af?: DraftAfProjection
}

/** One pick on the completed board - any team's, not just yours. */
export type BoardPick = {
  round: number
  overall: number
  label: string
  teamKey: string
  teamName: string | null
  isYou: boolean
  playerName: string
  position: string
  /** AllFantasy's own projection for the player — see draftAfProjections.ts. Absent when none. */
  af?: DraftAfProjection
}

export type CompletedDraft = {
  season: number
  /** Rounds in order, each holding that round's picks in pick order. */
  rounds: Array<{ round: number; picks: BoardPick[] }>
  /** Distinct teams that made a pick, in first-pick order. */
  teams: Array<{ teamKey: string; name: string | null; isYou: boolean; picks: number }>
  totalPicks: number
}

/** One team's grade for the completed draft. */
export type TeamDraftGrade = {
  ownerId: string
  name: string
  teamName: string | null
  picks: number
  /** Value over the round median, as drafted. */
  initialGrade: DraftGradeLetter
  /** The same recomputed on points scored since (identical in redraft). */
  currentGrade: DraftGradeLetter
  trend: 'improved' | 'declined' | 'steady'
}

export type DraftGrades = {
  season: string
  /** True when some picks could not be graded - stated on screen, never hidden. */
  partial: boolean
  gradedPicks: number
  totalPicks: number
  scale: string
  /**
   * What the grade was computed FROM, when that needs saying — either that the
   * league's own rules were unavailable and a format aggregate stood in, or that they
   * were used but some could not be translated. Carried to the screen rather than
   * dropped: a number whose basis needs a footnote has to carry it where it is read,
   * not where it was computed.
   */
  scoringNote: string | null
  teams: TeamDraftGrade[]
}

export type DraftHqData = {
  league: { id: string; name: string; platform: string; format: string | null }
  session: SectionState<{
    status: string
    draftType: string
    rounds: number
    teamCount: number
    yourSlot: number | null
  }>
  /** The picks you hold in the upcoming draft, trades applied, and the ones traded away. */
  pickSlots: SectionState<PickInventory>
  /** What you actually drafted, when the draft has run. */
  madePicks: SectionState<MadePick[]>
  /**
   * The last completed draft, every team's picks by round.
   *
   * WHY SEPARATE FROM `madePicks`, WHICH IS YOURS ALONE: a draft that has already run
   * is still the league's most-read page - who took whom, and in what order - and that
   * is a different question from "what did I get". Both read the same DraftFact rows.
   */
  board: SectionState<CompletedDraft>
  /**
   * A grade per team for that same completed draft.
   *
   * WHY THIS IS SLEEPER-ONLY TODAY, and why the reason is carried in the payload rather
   * than left to be rediscovered: the grade is value-over-round computed from REAL
   * SCORED POINTS, and that stats board is keyed on Sleeper player ids. An imported ESPN
   * or Fantrax pick carries the provider's own id, and nothing links the two -
   * `ingestEspnAthleteIdentities` deliberately refuses to link on a name, having measured
   * what that does. A fabricated letter would be worse than none: in this product a "C"
   * already means "no data".
   */
  grades: SectionState<DraftGrades>
  lottery: SectionState<LotteryOdds>
  queue: SectionState<PreparedQueue>
  preparation?: DraftPreparationData
  keepers: SectionState<KeeperList>
}

type SlotOrderRow = { slot: number; rosterId: string; displayName: string }


const PLATFORM_LABEL: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  fantrax: 'Fantrax',
  mfl: 'MyFantasyLeague',
}

/** How many queued players the screen lists; the count says how many more there are. */
const QUEUE_SHOWN = 10

const FALLBACK_ORDER_TEXT: Record<string, string> = {
  reverse_standings: 'reverse order of finish',
  reverse_max_pf: 'reverse order of max points for',
  manual: 'an order the commissioner sets',
}

/**
 * Lottery odds for the next draft, when this league runs one.
 *
 * The cheap refusals come first and read the row the render already holds: a
 * league that is not dynasty, or whose order is not set by lottery, costs no
 * query. Only a lottery league reaches the guard and the standings.
 */
async function loadLottery(
  lc: LeagueContext,
  league: LeagueContextRow,
): Promise<SectionState<LotteryOdds>> {
  const unavailable = (reason: string) => ({ available: false as const, reason })

  if (!isDynastyLeagueRow({ isDynasty: Boolean(league.isDynasty), leagueVariant: league.leagueVariant ?? null })) {
    return unavailable('a weighted draft lottery only applies to dynasty leagues, and this one is not')
  }
  const { draftOrderMode, lotteryConfig, lotteryLastRunAt } = readDraftOrderModeAndLotteryConfig(league.settings)
  if (draftOrderMode !== 'weighted_lottery') {
    return unavailable('this league’s draft order is not set by a weighted lottery')
  }
  const eligibility = await checkDynastyLotteryEligibility(lc.leagueId)
  if (!eligibility.eligible) {
    return unavailable(
      eligibility.isStartupLeague
        ? 'a weighted lottery starts in a dynasty league’s second season, and this league is in its first'
        : 'this league is not eligible for a weighted draft lottery',
    )
  }

  const [preview, myTeam, viewerRoster] = await Promise.all([
    previewLotteryOdds(lc.leagueId, lotteryConfig),
    lc.claimedTeam().catch(() => null),
    // The lottery's standings carry Roster ids; this is the viewer's, keyed the way the draft
    // routes key it. A native team's `externalId` is the same id, an import's is not.
    prisma.roster
      .findFirst({ where: { leagueId: lc.leagueId, platformUserId: lc.userId }, select: { id: true } })
      .catch(() => null),
  ])
  if (!preview) return unavailable('there are no standings on file yet to weight the lottery by')
  if (preview.eligible.length === 0) {
    return unavailable('no team qualifies for the lottery under this league’s current settings')
  }

  const mine = new Set(
    [viewerRoster?.id, myTeam?.externalId, myTeam?.id].filter((v): v is string => Boolean(v)),
  )
  return {
    available: true,
    data: {
      pickCount: lotteryConfig.lotteryPickCount,
      playoffTeamCount: preview.playoffTeamCount,
      fallbackOrder: FALLBACK_ORDER_TEXT[lotteryConfig.fallbackOrder] ?? 'the league’s fallback order',
      alreadyRunAt: lotteryLastRunAt,
      teams: preview.eligible.map((t) => ({
        rosterId: t.rosterId,
        name: t.displayName,
        record: t.ties > 0 ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`,
        oddsPercent: t.oddsPercent,
        isYou: mine.has(t.rosterId),
      })),
    },
  }
}

/**
 * The viewer's prepared queue for this draft — the `DraftQueue` row the draft
 * room saves (`PUT /api/leagues/[leagueId]/draft/queue`, and its AI reorder).
 *
 * ⚠ READ, NEVER WRITTEN BACK. `loadDraftQueueForUser` prunes drafted players by
 * UPDATING the row; a planning screen must not change draft state because someone
 * opened it, so the same pure clean-up runs here in memory only.
 */
async function loadPreparedQueue(sessionId: string, userId: string): Promise<SectionState<PreparedQueue>> {
  const unavailable = (reason: string) => ({ available: false as const, reason })

  const row = await prisma.draftQueue.findUnique({
    where: { sessionId_userId: { sessionId, userId } },
    select: { order: true },
  })
  const order = row?.order
  const raw = Array.isArray(order) ? (order as unknown as QueueEntry[]) : []
  const named = raw.filter((e) => typeof e?.playerName === 'string' && e.playerName.trim().length > 0)
  if (named.length === 0) return unavailable('you have not queued any players for this draft yet')

  const drafted = await prisma.draftPick.findMany({ where: { sessionId }, select: { playerName: true } })
  const { queue } = removeDraftedPlayersFromQueue(dedupeQueueEntries(named), normalizeDraftedNameSet(drafted))
  if (queue.length === 0) return unavailable('every player you queued has already been drafted')

  return {
    available: true,
    data: {
      total: queue.length,
      players: queue.slice(0, QUEUE_SHOWN).map((e, i) => ({
        rank: i + 1,
        playerName: e.playerName.trim(),
        position: e.position?.trim() || '—',
        team: e.team ?? null,
      })),
    },
  }
}

/**
 * Keepers declared for the draft run here — `DraftSession.keeperSelections`,
 * written by the draft room's keeper route, next season's draft and draft import.
 */
function keepersFromSession(
  session: { keeperConfig: unknown; keeperSelections: unknown; sleeperDraftId: string | null },
  myRosterIds: ReadonlySet<string>,
): SectionState<KeeperList> {
  const unavailable = (reason: string) => ({ available: false as const, reason })
  const config =
    session.keeperConfig && typeof session.keeperConfig === 'object'
      ? (session.keeperConfig as Partial<KeeperConfig>)
      : null
  const selections = Array.isArray(session.keeperSelections)
    ? (session.keeperSelections as KeeperSelection[]).filter((s) => s && s.rosterId != null)
    : []

  if (!config && selections.length === 0) {
    return unavailable(
      session.sleeperDraftId
        ? 'keepers for this draft are set on Sleeper, and they are not imported until the draft runs'
        : 'this draft has no keepers set up',
    )
  }
  if (myRosterIds.size === 0) {
    return unavailable('no team in this league is claimed by you, so there are no keepers of yours to show')
  }
  const mine = selections.filter((s) => myRosterIds.has(String(s.rosterId)))
  if (mine.length === 0) return unavailable('you have not declared any keepers for this draft')

  return {
    available: true,
    data: {
      source: 'draft',
      season: null,
      maxKeepers: typeof config?.maxKeepers === 'number' ? config.maxKeepers : null,
      players: mine
        .map((s) => ({
          playerName: String(s.playerName ?? '').trim() || 'Unnamed player',
          position: String(s.position ?? '').trim() || '—',
          team: s.team ?? null,
          round: Number(s.roundCost),
        }))
        .sort((a, b) => a.round - b.round),
    },
  }
}

/**
 * Keepers from the draft this league already ran, when AllFantasy is not running
 * the next one: Sleeper's `is_keeper`, kept by `SleeperHistoricalDraftSyncService`
 * as `dw_draft_facts.metadata.isKeeper`.
 *
 * ⚠ SLEEPER ONLY, AND SAID SO. No other provider's sync writes the flag, so for
 * them an absence of flags says nothing about whether anyone kept a player.
 */
async function loadImportedKeepers(
  lc: LeagueContext,
  platform: string,
): Promise<SectionState<KeeperList>> {
  const unavailable = (reason: string) => ({ available: false as const, reason })
  if (platform !== 'sleeper') {
    return unavailable('keepers are only imported from Sleeper drafts, so none can be shown for this league')
  }
  const myTeam = await lc.claimedTeam()
  if (!myTeam?.externalId) {
    return unavailable('no team in this league is claimed by you, so there are no keepers of yours to show')
  }

  const facts = await prisma.draftFact.findMany({
    where: { leagueId: lc.leagueId, managerId: String(myTeam.externalId) },
    orderBy: [{ season: 'desc' }, { pickNumber: 'asc' }],
    select: { season: true, round: true, playerId: true, metadata: true },
  })
  if (facts.length === 0) {
    return unavailable('no imported draft is on file for your team, so there are no keepers to show')
  }
  const season = facts[0]?.season ?? null
  const kept = facts.filter(
    (f) =>
      f.season === season &&
      f.metadata != null &&
      typeof f.metadata === 'object' &&
      (f.metadata as { isKeeper?: unknown }).isKeeper === true,
  )
  if (kept.length === 0) {
    return unavailable(`Sleeper flagged none of your ${season ?? 'latest'} draft picks as keepers`)
  }

  const names = await resolvePlayerNames(
    kept.map((k) => k.playerId),
    platform,
  )
  return {
    available: true,
    data: {
      source: 'imported',
      season,
      maxKeepers: null,
      players: kept.map((k) => {
        const hit = names.get(k.playerId)
        return {
          playerName: hit?.name ?? `Player ${k.playerId} (not yet mapped)`,
          position: hit?.position ?? '—',
          team: hit?.team ?? null,
          round: k.round,
        }
      }),
    },
  }
}

/**
 * The draft this league already played, read from the import.
 *
 * ⚠ NO LIVE DRAFT SESSION DOES NOT MEAN NO DRAFT. `DraftSession` describes a draft this
 * app is RUNNING; an imported league has never had one, so this screen answered "no
 * draft has been set up for this league" to someone whose ten drafted seasons were
 * sitting in `DraftFact` (`dw_draft_facts`), written by the import and read by nothing.
 *
 * ⚠ THIS IS SAFE ONLY BECAUSE `managerId` IS NOW CANONICAL. It used to hold the raw
 * historical `roster_id` — a slot within one season, reused by different managers across
 * seasons — so filtering it by a current team's `externalId` would have shown one manager
 * another manager's draft, plausibly and silently. The draft sync now resolves it the way
 * the matchup sync always has. Picks imported BEFORE that fix keep their raw ids and
 * simply will not match here, which is the correct failure: nothing is shown rather than
 * the wrong thing.
 */
/**
 * Provider player id -> a displayable name, for any provider.
 *
 * `PlayerProviderIdentity` first because it is the only table covering non-Sleeper ids;
 * `SportsPlayer` second because it is the only one carrying position and team. Shared by
 * the personal pick list and the full board so the two can never disagree about who a
 * pick was.
 */
type ResolvedDraftPlayer = {
  name: string
  position: string | null
  team: string | null
  /**
   * The headshot, vetted so it can go straight into a `src`.
   *
   * ⚠ NULL FOR EVERY NON-SLEEPER LEAGUE, AND THAT IS NOT A BUG TO FIX HERE.
   * `PlayerProviderIdentity` carries a display name and nothing else, so an
   * ESPN or Yahoo board resolves a name with no face. Rendering an initial
   * there is the honest outcome; inventing a lookup by name across providers is
   * exactly the collision this function's own note is about.
   */
  imageUrl: string | null
}

async function resolvePlayerNames(
  playerIds: string[],
  platform: string,
): Promise<Map<string, ResolvedDraftPlayer>> {
  const out = new Map<string, ResolvedDraftPlayer>()
  if (playerIds.length === 0) return out

  /*
   * ⚠ AN ID MEANS NOTHING WITHOUT THE PROVIDER THAT ISSUED IT, and BOTH lookups
   * below have been missing that filter at different times.
   *
   * Measured on production, on the first ESPN league ever imported:
   *
   *   pick 13.04 -> "Liutauras Lelevicius"  (rolling_insights 15013, NCAAB)
   *
   * A basketball guard, rendered on an NFL draft board as a confident answer,
   * because an ESPN athlete id was compared against every provider's id space at
   * once. 12,074 provider_player_id values appear under two or more providers,
   * and 16,710 under two or more sports — a collision is the norm, not bad luck.
   *
   * ⚠ THE SLEEPER LOOKUP HAS THE SAME HOLE, and it is the easier one to miss
   * because the column name reads like a filter. `sleeperId` holds numeric
   * strings, so an ESPN id matches one just as readily; scoping the first query
   * achieves nothing while an unscoped second one runs beside it.
   *
   * A wrong name is worse than no name: "(not yet mapped)" is a true statement
   * about a pick we cannot resolve, and a stranger's name is a false one the
   * reader has no way to distinguish.
   */
  const scoped = String(platform ?? '').trim().toLowerCase()
  const [identities, players] = await Promise.all([
    scoped
      ? prisma.playerProviderIdentity
          .findMany({
            where: { provider: scoped, providerPlayerId: { in: playerIds } },
            select: { providerPlayerId: true, displayName: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
    /* Only a Sleeper league has Sleeper ids in its rows. */
    scoped === 'sleeper'
      ? prisma.sportsPlayer
          .findMany({
            where: { sleeperId: { in: playerIds } },
            // `sport` is required by `composePlayerIdentities` — it gates the
            // NFL-only club fold. `imageUrl` is what puts a face on the board.
            select: {
              sleeperId: true, name: true, position: true, team: true,
              sport: true, imageUrl: true,
            },
          })
          .catch(() => [])
      : Promise.resolve([]),
  ])

  /*
   * ⚠ COMPOSED, NOT FIRST-ROW-WINS. This was `if (!out.has(id)) out.set(...)`,
   * and `sleeperId` is not unique in `SportsPlayer` — the duplicates are one
   * athlete as several vendors describe him, and `findMany` carries no
   * `orderBy`. So which vendor described a pick was decided by whatever
   * Postgres returned first: 126 of 11,960 NFL ids disagree about the folded
   * position and 20 about the normalised club, and only one vendor row in three
   * carries a usable headshot for the players that have one at all.
   *
   * Same fix, same module, as /core/matchup, /core/my-team, /core and
   * /core/live. See `composePlayerIdentities` for the measurement.
   */
  for (const [sleeperId, p] of composePlayerIdentities(players)) {
    if (out.has(sleeperId)) continue
    out.set(sleeperId, {
      // `SportsPlayer.name` is non-nullable, so the fallback is unreachable —
      // but `name` is a `string` the board renders and sorts on.
      name: p.name ?? `Player ${sleeperId}`,
      position: p.position,
      team: p.team,
      imageUrl: p.imageUrl,
    })
  }
  for (const i of identities) {
    if (i.displayName && !out.has(i.providerPlayerId)) {
      // Name only — see `ResolvedDraftPlayer.imageUrl` for why there is no face.
      out.set(i.providerPlayerId, {
        name: i.displayName, position: null, team: null, imageUrl: null,
      })
    }
  }
  return out
}

/**
 * Pick-in-round, decided from the numbers rather than the provider name.
 *
 * Sleeper writes `pick_no`, an OVERALL pick; ESPN writes the pick WITHIN the round. If
 * subtracting completed rounds lands inside the round it was overall; if the value
 * already sits inside a round it was a pick-in-round. Returns 0 when neither fits, and
 * the caller then says only what it knows.
 */
function pickInRoundOf(round: number, pickNumber: number, teamCount: number): number {
  if (teamCount <= 0) return 0
  const derived = pickNumber - (round - 1) * teamCount
  if (derived >= 1 && derived <= teamCount) return derived
  if (pickNumber >= 1 && pickNumber <= teamCount) return pickNumber
  return 0
}

/**
 * The last completed draft in full - every team, every round.
 *
 * WHY ORDERED BY `pickNumber` AND NOT BY TEAM: a board is only legible in pick order.
 * Grouping by team first loses the snake, which is the one thing a round view exists to
 * show.
 */
/**
 * Per-team grades for the last completed draft.
 *
 * `getDraftReport` already does the work - value over round median, regraded on points
 * accrued since - and caches it on a 6h cycle. This surfaces it on the screen where the
 * board it grades is actually shown.
 */
async function loadDraftGrades(
  leagueId: string,
  platform: string,
  platformLeagueId: string | null,
): Promise<SectionState<DraftGrades>> {
  const unavailable = (reason: string) => ({ available: false as const, reason })

  /*
   * Two sources, one shape. Sleeper grades live through its own API; every other
   * platform grades from the DraftFact rows we imported, through the same
   * `gradePicks`. Both return a `DraftReportPayload`, so everything below is common.
   */
  const report =
    platform === 'sleeper'
      ? platformLeagueId
        ? await getDraftReport(platformLeagueId).catch(() => null)
        : null
      : await buildImportedDraftReport(leagueId).catch(() => null)

  if (!report) {
    if (platform === 'sleeper' && !platformLeagueId) {
      return unavailable('this league has no Sleeper id on file, and the grader is keyed on one')
    }
    return unavailable('no completed draft has been graded for this league yet')
  }

  const season = [...report.seasons].sort((a, b) => Number(b.season) - Number(a.season))[0]
  if (!season || season.managers.length === 0) {
    return unavailable('no completed draft has been graded for this league yet')
  }

  /*
   * A season with nothing scored yet is refused rather than shown. Every median would
   * be zero, every value-over would be zero, and every manager would come out a C —
   * which in this product is what "no data" already looks like. Publishing that as a
   * grade is worse than saying there is no grade.
   */
  if (season.gradedPicks === 0) {
    return unavailable(
      `the ${season.season} season has not produced scoring yet, so there is nothing to grade a pick against`,
    )
  }

  return {
    available: true,
    data: {
      season: season.season,
      partial: season.partial,
      gradedPicks: season.gradedPicks,
      totalPicks: season.totalPicks,
      scale: report.gradeScale.description,
      /* Not gated on `format-approx`: league-scored with a tenth of the rules
         missing also needs saying. */
      scoringNote: report.scoringNote,
      teams: season.managers.map((m) => ({
        ownerId: m.ownerId,
        name: m.name,
        teamName: m.teamName,
        picks: m.picks,
        initialGrade: m.initialGrade,
        currentGrade: m.currentGrade,
        trend: m.trend,
      })),
    },
  }
}

async function loadCompletedDraftBoard(lc: LeagueContext): Promise<SectionState<CompletedDraft>> {
  const { leagueId } = lc
  const unavailable = (reason: string) => ({ available: false as const, reason })

  const facts = await prisma.draftFact
    .findMany({
      where: { leagueId },
      orderBy: [{ season: 'desc' }, { round: 'asc' }, { pickNumber: 'asc' }],
      select: { season: true, round: true, pickNumber: true, playerId: true, managerId: true },
    })
    .catch(() => [])
  if (facts.length === 0) {
    return unavailable('no completed draft has been imported for this league')
  }

  const season = facts[0]?.season ?? null
  const rows = facts.filter((f) => f.season === season)

  /* The provider that issued these ids — see resolvePlayerNames. Read before the
     fan-out because the name lookup cannot be scoped without it. */
  const boardLeague = await lc.league().catch(() => null)

  const [teams, mine, names] = await Promise.all([
    prisma.leagueTeam
      .findMany({ where: { leagueId }, select: { externalId: true, teamName: true, ownerName: true } })
      .catch(() => []),
    lc.claimedTeams().catch(() => []),
    resolvePlayerNames([...new Set(rows.map((r) => r.playerId))], boardLeague?.platform ?? ''),
  ])

  /* AllFantasy's own projection for every player on the board — one read. */
  const afs = await loadDraftAfProjections({
    platform: boardLeague?.platform,
    playerIds: rows.map((r) => r.playerId),
    leagueSettings: boardLeague?.settings,
  })

  const teamCount = teams.length
  const nameByKey = new Map<string, string>()
  for (const t of teams) {
    const label = t.teamName?.trim() || t.ownerName?.trim()
    if (t.externalId && label) nameByKey.set(t.externalId, label)
  }
  const yours = new Set(mine.map((t) => t.externalId).filter(Boolean) as string[])

  const byRound = new Map<number, BoardPick[]>()
  const teamOrder: string[] = []
  const teamPicks = new Map<string, number>()

  for (const r of rows) {
    const teamKey = r.managerId ?? ''
    const inRound = pickInRoundOf(r.round, r.pickNumber, teamCount)
    const hit = names.get(r.playerId)
    const pick: BoardPick = {
      round: r.round,
      overall: inRound > 0 ? (r.round - 1) * teamCount + inRound : r.pickNumber,
      label: inRound > 0 ? `${r.round}.${String(inRound).padStart(2, '0')}` : `Round ${r.round}`,
      teamKey,
      teamName: nameByKey.get(teamKey) ?? (parseFormerSleeperKey(teamKey) ? 'Former manager' : null),
      isYou: yours.has(teamKey),
      playerName: hit?.name ?? `Player ${r.playerId} (not yet mapped)`,
      position: hit?.position ?? '\u2014',
      ...(afs.byPlayerId.has(r.playerId) ? { af: afs.byPlayerId.get(r.playerId)! } : {}),
    }
    const bucket = byRound.get(r.round)
    if (bucket) bucket.push(pick)
    else byRound.set(r.round, [pick])

    if (teamKey && !teamPicks.has(teamKey)) teamOrder.push(teamKey)
    teamPicks.set(teamKey, (teamPicks.get(teamKey) ?? 0) + 1)
  }

  return {
    available: true,
    data: {
      season: season ?? 0,
      rounds: [...byRound.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([round, picks]) => ({ round, picks })),
      teams: teamOrder.map((teamKey) => ({
        teamKey,
        name: nameByKey.get(teamKey) ?? null,
        isYou: yours.has(teamKey),
        picks: teamPicks.get(teamKey) ?? 0,
      })),
      totalPicks: rows.length,
    },
  }
}

async function loadImportedDraftPicks(lc: LeagueContext): Promise<SectionState<MadePick[]>> {
  const { leagueId } = lc
  const unavailable = (reason: string) => ({ available: false as const, reason })

  const myTeam = await lc.claimedTeam()
  if (!myTeam?.externalId) {
    return unavailable('no draft has been set up, and no team in this league is claimed by you')
  }

  const facts = await prisma.draftFact.findMany({
    where: { leagueId, managerId: String(myTeam.externalId) },
    orderBy: [{ season: 'desc' }, { pickNumber: 'asc' }],
    select: { round: true, pickNumber: true, playerId: true, season: true },
  })
  if (facts.length === 0) {
    return unavailable('no draft has been set up, and no imported draft picks are on file for your team')
  }

  /* The most recent imported season only — a screen headed "your picks" showing ten
     drafts at once is a list, not an answer. */
  const season = facts[0]?.season ?? null
  const rows = facts.filter((f) => f.season === season)

  /* Pick-in-round is derived from the overall pick and the league size, the same
     correction the live path documents: DraftPick.slot is a roster's draft slot, not a
     pick-in-round, and labelling from it prints every round identically. */
  const teamCount = await prisma.leagueTeam.count({ where: { leagueId } })

  /*
   * ⚠ THE PLAYER ID IS THE PROVIDER'S, AND ONLY SLEEPER'S RESOLVES VIA SportsPlayer.
   *
   * This first shipped joining `SportsPlayer.sleeperId`, which can never match an ESPN
   * league — its draft facts carry ESPN player ids, and `SportsPlayer` has no ESPN
   * source at all. Every pick rendered as "Unmatched player 2577417" on a live ESPN
   * league, which reads as broken rather than as unmapped.
   *
   * `PlayerProviderIdentity` is the table built for exactly this: provider +
   * providerPlayerId -> displayName. It is tried first and covers every provider;
   * SportsPlayer stays as the Sleeper-shaped fallback, and is the only one of the two
   * that carries position and team.
   */
  /*
   * ⚠ AN ID MEANS NOTHING WITHOUT THE PROVIDER THAT ISSUED IT, AND BOTH LOOKUPS
   * USED TO OMIT IT. The comment above says this table is keyed on provider +
   * providerPlayerId; the query matched on providerPlayerId ALONE, so an ESPN
   * athlete id was compared against every provider's id space at once.
   *
   * Measured on production, on the first ESPN league ever imported:
   *
   *   pick 13.04 -> "Liutauras Lelevicius"  (rolling_insights 15013, NCAAB)
   *   pick 4.15  -> "Carnell Tate"          (also present under cfbd/NCAAF)
   *
   * A basketball guard, rendered on an NFL draft board as a confident answer. The
   * collision surface is not marginal: 12,074 provider_player_id values appear
   * under two or more providers, and 16,710 under two or more sports.
   *
   * ⚠ THE SLEEPER LOOKUP HAD THE SAME HOLE, and it is easy to miss because the
   * column name reads like a filter. `sleeperId` holds numeric strings, so an
   * ESPN id can match one just as readily; scoping the query by provider is not
   * enough if a second unscoped query runs beside it.
   *
   * A wrong name is worse than no name here. "(not yet mapped)" is a true
   * statement about a pick we cannot resolve; a stranger's name is a false one,
   * and the screen gives the reader no way to tell them apart.
   */
  const league = await lc.league().catch(() => null)

  /*
   * ⚠ THE SHARED RESOLVER, NOT A SECOND COPY. This block used to inline its own
   * scoped lookup while the board called an UNSCOPED `resolvePlayerNames`, so the
   * two surfaces reading the same DraftFact rows could name a pick differently —
   * and the helper's own comment claimed they could not. One resolver, scoped
   * once, is what makes that claim true.
   */
  const byPlayerId = await resolvePlayerNames(
    rows.map((r) => r.playerId),
    league?.platform ?? '',
  )
  const afs = await loadDraftAfProjections({
    platform: league?.platform,
    playerIds: rows.map((r) => r.playerId),
    leagueSettings: league?.settings,
  })

  return {
    available: true,
    data: rows.map((r) => {
      const hit = byPlayerId.get(r.playerId)
      /*
       * ⚠ `pickNumber` DOES NOT MEAN THE SAME THING ACROSS PROVIDERS. Sleeper writes
       * `pick_no`, an OVERALL pick; ESPN writes the pick WITHIN the round. Assuming
       * overall printed six consecutive picks as "Pick 4" on a live ESPN league,
       * because the derived pick-in-round went negative and fell to the raw value.
       *
       * Decided from the numbers rather than from the provider name: if subtracting the
       * completed rounds lands inside the round, it was an overall pick; if the value
       * already sits inside a round, it was a pick-in-round. Neither fits, and the
       * label says only what is known.
       */
      const derived = teamCount > 0 ? r.pickNumber - (r.round - 1) * teamCount : 0
      const inRound =
        teamCount > 0 && derived >= 1 && derived <= teamCount
          ? derived
          : teamCount > 0 && r.pickNumber >= 1 && r.pickNumber <= teamCount
            ? r.pickNumber
            : 0
      return {
        overall: inRound > 0 && teamCount > 0 ? (r.round - 1) * teamCount + inRound : r.pickNumber,
        round: r.round,
        label:
          inRound > 0
            ? `${r.round}.${String(inRound).padStart(2, '0')}`
            : `Round ${r.round}`,
        playerName: hit?.name ?? `Player ${r.playerId} (not yet mapped)`,
        position: hit?.position ?? '—',
        team: hit?.team ?? null,
        imageUrl: hit?.imageUrl ?? null,
        ...(afs.byPlayerId.has(r.playerId) ? { af: afs.byPlayerId.get(r.playerId)! } : {}),
      }
    }),
  }
}

export async function getDraftHqData(
  leagueId: string,
  userId: string,
  /**
   * The render's shared league context — see `leagueContext.ts`. This screen read the league row
   * three times and the viewer's team three times across its own helpers, before the draft board
   * beside it read both again.
   */
  ctx?: LeagueContext | null,
): Promise<DraftHqData | null> {
  const lc = leagueContextFor(leagueId, userId, ctx)
  const league = await lc.league()
  if (!league) return null

  const platform = String(league.platform ?? 'manual').toLowerCase()

  // Beside the session read, not before it: a lottery league reads standings, and that wait
  // should not be serial with the draft's own.
  const [lottery, session] = await Promise.all([
    loadLottery(lc, league).catch(() => ({
      available: false as const,
      reason: 'the lottery odds could not be worked out for this league right now',
    })),
    prisma.draftSession.findFirst({
      where: { leagueId },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      select: {
        id: true, status: true, draftType: true, rounds: true, teamCount: true, slotOrder: true,
        thirdRoundReversal: true, tradedPicks: true, keeperConfig: true, keeperSelections: true,
        sleeperDraftId: true, startedAt: true, playerPool: true, draftModeLabel: true, customRankingsEnabled: true,
      },
    }),
  ])

  const base = {
    league: {
      id: league.id,
      name: leagueDisplayName(league.name),
      platform,
      format: league.leagueType ?? null,
    },
    lottery,
  }

  if (!session) {
    /* Session and slots genuinely do not exist — this app is not running a draft here,
       and saying otherwise would invent one. The picks, however, may well exist. */
    const none = { available: false as const, reason: 'no draft has been set up for this league' }
    const [madePicks, board, grades, keepers] = await Promise.all([
      loadImportedDraftPicks(lc).catch(() => none),
      loadCompletedDraftBoard(lc).catch(() => none),
      loadDraftGrades(leagueId, league.platform, league.platformLeagueId ?? null).catch(() => none),
      loadImportedKeepers(lc, platform).catch(() => ({
        available: false as const,
        reason: 'keepers could not be read for this league right now',
      })),
    ])
    // A queue belongs to a draft AllFantasy runs; with none there is nothing to queue for.
    const queue = {
      available: false as const,
      reason: 'a prepared queue belongs to a draft AllFantasy runs, and none is set up for this league',
    }

    /*
     * ⚠ "NO DRAFT HAS BEEN SET UP" SAT DIRECTLY ABOVE FOURTEEN DRAFTED PICKS.
     *
     * Both statements were true and together they read as nonsense. They answer
     * different questions: `session` and `pickSlots` describe a draft THIS APP
     * WOULD RUN — an imported league has never had one — while `madePicks` and
     * `board` read the draft that already happened on the provider. The old copy
     * named neither, so a reader saw "no draft" on top of that draft's results
     * and reasonably concluded the screen was broken.
     *
     * Reported on a real ESPN league whose fourteen picks were listed, correctly
     * and by name, immediately underneath.
     *
     * The distinction is only worth drawing when there IS something below to
     * contradict — otherwise "no draft has been set up" is the whole truth and
     * qualifying it would add words to an empty screen.
     */
    const importedDraftExists = madePicks.available === true || board.available === true
    const noSession = importedDraftExists
      ? {
          available: false as const,
          reason:
            'no upcoming draft is scheduled in AllFantasy — the picks below are from the draft this league already ran',
        }
      : none

    return { ...base, session: noSession, pickSlots: noSession, madePicks, board, grades, queue, keepers, preparation: unavailablePreparation('Historical imported ADP needs a preserved draft-time context. No upcoming draft is scheduled here.') }
  }

  const myTeam = await lc.claimedTeam()

  const order = Array.isArray(session.slotOrder)
    ? (session.slotOrder as Array<{ slot?: number; rosterId?: string; displayName?: string }>)
    : []

  const mySlotEntry = myTeam?.externalId
    ? order.find((o) => String(o.rosterId) === String(myTeam.externalId))
    : undefined
  const yourSlot = typeof mySlotEntry?.slot === 'number' ? mySlotEntry.slot : null

  const sessionState: DraftHqData['session'] = {
    available: true,
    data: {
      status: session.status,
      draftType: session.draftType,
      rounds: session.rounds,
      teamCount: session.teamCount,
      yourSlot,
    },
  }

  const slotOrder: SlotOrderRow[] = order
    .filter((o) => typeof o.slot === 'number' && o.rosterId != null)
    .map((o) => ({ slot: o.slot as number, rosterId: String(o.rosterId), displayName: String(o.displayName ?? '') }))
  // Ids are compared as strings by the resolver, so a numeric id stored in JSON must not miss.
  const tradedPicks: TradedPickRecord[] = (Array.isArray(session.tradedPicks) ? (session.tradedPicks as unknown[]) : [])
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object')
    .filter((t) => typeof t.round === 'number' && t.originalRosterId != null && t.newRosterId != null)
    .map((t) => ({
      round: t.round as number,
      originalRosterId: String(t.originalRosterId),
      previousOwnerName: String(t.previousOwnerName ?? ''),
      newRosterId: String(t.newRosterId),
      newOwnerName: String(t.newOwnerName ?? ''),
    }))

  const pickSlots: SectionState<PickInventory> =
    !['snake', 'linear'].includes(session.draftType.toLowerCase())
      ? { available: false, reason: 'fixed pick ownership is not shown for this draft format; review the recorded selections on the board' }
      : yourSlot == null
      ? {
          available: false,
          reason:
            order.length === 0
              ? 'this draft has no order set, so pick slots cannot be worked out yet'
              : 'your team is not in this draft’s order, so we cannot say which picks are yours',
        }
      : {
          available: true,
          data: {
            ...computePickInventory({
              myRosterId: String(mySlotEntry?.rosterId),
              slotOrder,
              tradedPicks,
              rounds: session.rounds,
              teamCount: session.teamCount,
              draftType: session.draftType,
              thirdRoundReversal: Boolean(session.thirdRoundReversal),
            }),
            /*
             * ⚠ A PROVIDER-HOSTED LEAGUE TRADES ITS PICKS ON THE PROVIDER, and nothing syncs those
             * trades into this draft (the Sleeper mirror never writes `tradedPicks`). Showing the
             * list bare there would claim a pick traded away on Sleeper is still yours.
             */
            note:
              platform === 'manual'
                ? null
                : `pick trades made on ${PLATFORM_LABEL[platform] ?? 'this league’s own platform'} are not synced into this draft, so a pick shown here may have changed hands there`,
          },
        }

  const made = myTeam?.externalId
    ? await prisma.draftPick.findMany({
        where: { sessionId: session.id, rosterId: String(myTeam.externalId) },
        orderBy: { overall: 'asc' },
        select: {
          overall: true, round: true, slot: true,
          playerName: true, position: true, team: true,
          // Only for the headshot — name, position and club are denormalised on
          // the row already and stay authoritative over anything looked up.
          playerId: true,
        },
      })
    : []

  /*
   * The face for a LIVE draft's picks.
   *
   * ⚠ THIS PATH AND THE IMPORTED-BOARD PATH BUILD THE SAME `MadePick` TYPE, so
   * they have to agree about whether a pick has a face. They resolve it from
   * different places — the imported board joins identities to build the whole
   * row, while a live pick already carries name, position and club denormalised
   * — but the type is shared, and a field that is populated on one path and
   * silently null on the other is the kind of divergence nobody notices until a
   * screen looks broken on one draft and fine on another.
   *
   * `playerId` is nullable here, and only Sleeper ids resolve — see
   * `ResolvedDraftPlayer.imageUrl`. Both cases fall through to a null face and
   * an initial, which is what the row renders for an unresolved pick anyway.
   */
  const madeFaces = await resolvePlayerNames(
    [...new Set(made.map((p) => p.playerId).filter((id): id is string => Boolean(id)))],
    String(league.platform ?? '').toLowerCase(),
  ).catch(() => new Map<string, ResolvedDraftPlayer>())
  const madeAfs = await loadDraftAfProjections({
    platform: league.platform,
    playerIds: made.map((p) => p.playerId),
    leagueSettings: league.settings,
  })

  const madePicks: SectionState<MadePick[]> =
    made.length > 0
      ? {
          available: true,
          data: made.map((p) => ({
            overall: p.overall,
            round: p.round,
            // ⚠ DraftPick.slot is the ROSTER's draft slot, not the pick-in-round.
            // Labelling from it printed every pick as ".02" for a slot-2 team —
            // so a snake draft read as if the same team picked second in every
            // round. The pick-in-round has to come from `overall`: pick 23 of a
            // 12-team round 2 is 2.11, which is what the computed slots above
            // already said, and the two disagreeing is what exposed this.
            label: `${p.round}.${String(p.overall - (p.round - 1) * session.teamCount).padStart(2, '0')}`,
            playerName: p.playerName,
            position: p.position,
            team: p.team,
            imageUrl: p.playerId ? madeFaces.get(p.playerId)?.imageUrl ?? null : null,
            ...(p.playerId && madeAfs.byPlayerId.has(p.playerId) ? { af: madeAfs.byPlayerId.get(p.playerId)! } : {}),
          })),
        }
      : {
          available: false,
          reason:
            session.status === 'pre_draft'
              ? 'this draft has not run yet'
              : 'no picks recorded for your team in this draft',
        }

  /* A live session and a completed board are not exclusive: a league can be mid-draft in
     one season and hold a finished board from the last one. */
  const board = await loadCompletedDraftBoard(lc).catch(() => ({
    available: false as const,
    reason: 'no completed draft has been imported for this league',
  }))

  const grades = await loadDraftGrades(leagueId, league.platform, league.platformLeagueId ?? null).catch(
    () => ({
      available: false as const,
      reason: 'the draft report could not be built for this league',
    }),
  )

  const queue = await loadPreparedQueue(session.id, userId).catch(() => ({
    available: false as const,
    reason: 'your queue could not be read right now',
  }))

  const myRosterIds = new Set(
    [mySlotEntry?.rosterId, myTeam?.externalId].filter((v) => v != null && v !== '').map(String),
  )
  const keepers = keepersFromSession(session, myRosterIds)

  const preparation = await getDraftPreparationData(league, session, userId, mySlotEntry?.rosterId ?? myTeam?.externalId ?? undefined).catch(() => unavailablePreparation('Draft preparation could not be loaded. Retry this page.', 'error'))
  return { ...base, session: sessionState, pickSlots, madePicks, board, grades, queue, keepers, preparation }
}
