import 'server-only'

import { prisma } from '@/lib/prisma'
import { myRosterCandidates } from './myRoster'
import { leagueDisplayName, type SectionState } from './leagueHome'
import { leagueContextFor, type LeagueContext } from './leagueContext'
import { describeTiebreakRule } from './waiverRuleLabels'
import { waiverScheduleIsImported } from './waiverRowMeta'
import type { WaiverSchedule } from './waiverRunClock'
import { loadSleeperWaiverSchedules } from '@/lib/waivers/sleeperWaiverSchedule'
import { normalizeSourcePlatform } from '@/lib/league-links/sourceLinkResolver'
import { platformLabel } from './platformLinks'

/**
 * Waivers — "targets, bids and claim order, priced against this league's FAAB
 * and your holes".
 *
 * The handoff writes the honesty rule for this screen into the design itself:
 * "Some platforms don't publish remaining FAAB. When that happens AllFantasy
 * says so." That case is REAL — 735 of 1,032 stored rosters carry
 * faabRemaining, so roughly three in ten genuinely cannot show a budget — and it
 * is handled as the design asks rather than defaulted to $0, which would read as
 * "you have nothing to bid" instead of "we do not know what you have".
 *
 * What is real: your FAAB, your waiver priority, how you rank on budget against
 * the rest of the league, how many players you hold, and — as of now — how this
 * league's waivers actually run. Measured across all 120 production leagues:
 * waiver type resolves for 90 and the run schedule for 82.
 *
 * Suggested claims used to be withheld here on the grounds that ranking targets
 * needs projections and rostered-percentage data. The principle was right — a
 * bid figure invented from nothing is the most actionable wrong number this
 * screen could carry — but the premise was wrong: `WaiverIntel`
 * (/api/league/waiver-intel) computes bids from this league's own winning-claim
 * history against market value, and had simply never been mounted on this tab.
 * The screen renders that panel now, and it keeps its own no-data state, so the
 * honesty rule is intact and the field that encoded it is gone rather than
 * sitting here contradicting the panel beside it.
 */

export type WaiverBudget = {
  faabRemaining: number
  /** Rank among league rosters by budget left, 1 = most. */
  rankByBudget: number | null
  leagueRosters: number
  /** How many rosters in this league publish a budget at all. */
  rostersWithBudget: number
}

export type WaiverTypeInfo = {
  /** Raw ingested value: faab | rolling | fcfs | off | standard. */
  kind: string
  label: string
  /** FAAB budget for the league, when the type is FAAB and a budget was read. */
  budget: number | null
}

export type WaiverRunInfo = {
  /**
   * The schedule, in the zone it is kept in. ⚠ A STORED schedule is UTC and labelled as such:
   * `processingTimeUtc` is definitionally UTC and `League.timezone` cannot localise it (it is
   * `@default("America/New_York")` on every production league, so converting would dress a schema
   * default up as the league's real timezone). An OBSERVED Sleeper schedule is Pacific wall-clock
   * (lib/waivers/observedWaiverSchedule.ts). The viewer always sees their own time beside it.
   */
  schedule: WaiverSchedule
  /** "Wednesday", or "Every day" for daily waivers. */
  dayLabel: string
  /** "09:00 UTC", "03:00 Pacific". */
  timeLabel: string
  /** Set when the schedule was read off this league's own processed claims: how many runs agree. */
  observedRuns: number | null
  /** True when it is Sleeper's own daily-hour setting (lib/waivers/sleeperWaiverSchedule.ts). */
  fromSleeperSetting: boolean
}

export type WaiversData = {
  /** `platformLeagueId` is carried so the screen can link to the provider's own player page. */
  league: { id: string; name: string; platform: string; format: string | null; platformLeagueId: string | null }
  budget: SectionState<WaiverBudget>
  waiverPriority: SectionState<{ priority: number; leagueRosters: number }>
  rosterLoad: SectionState<{ playersHeld: number; starters: number; bench: number; reserve: number }>
  claimsQueued: SectionState<{ count: number; committed: number | null }>
  waiverType: SectionState<WaiverTypeInfo>
  processTime: SectionState<WaiverRunInfo>
  /**
   * How a tie between equal bids is broken. Real column (`tiebreakRule`) and
   * genuinely nullable — most imported leagues have never published it.
   */
  tiebreak: SectionState<string>
  /** Claims allowed per waiver period, and the minimum bid when one is set. */
  claimLimits: SectionState<string>
}

const WAIVER_TYPE_LABEL: Record<string, string> = {
  faab: 'FAAB blind bidding',
  rolling: 'Rolling waiver priority',
  reverse_standings: 'Reverse standings priority',
  fcfs: 'First come, first served',
  standard: 'Standard waiver priority',
  off: 'No waivers — free agents are instant',
}

const DAY_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Waiver rules, read from LeagueWaiverSettings.
 *
 * ⚠ NOT FROM `League.waiverType` / `League.waiverProcessTime`, WHICH ARE DEFAULTS.
 * Those columns are `@default("rolling")` and `@default("02:00")`, and production
 * proves the difference: all 120 leagues carry `waiverProcessTime = "02:00"`,
 * every single one, because nothing writes it. Reading it would have printed
 * "waivers run at 02:00" for every league in the product — a schema default
 * rendered as an ingested fact, which is the exact failure this codebase keeps
 * having to undo.
 *
 * LeagueWaiverSettings holds the rule mirror, but it also receives bootstrap
 * defaults. In particular, Sleeper's mapper does not import the processing day
 * or UTC time, so a populated mirror field is not proof of a provider schedule.
 */
async function resolveWaiverRules(leagueId: string, platform: string): Promise<{
  waiverType: SectionState<WaiverTypeInfo>
  processTime: SectionState<WaiverRunInfo>
  tiebreak: SectionState<string>
  claimLimits: SectionState<string>
}> {
  const s = await prisma.leagueWaiverSettings.findUnique({
    where: { leagueId },
    select: {
      waiverType: true,
      faabBudget: true,
      processingDayOfWeek: true,
      processingTimeUtc: true,
      tiebreakRule: true,
      claimLimitPerPeriod: true,
      waiverEngineConfig: true,
    },
  })

  /*
   * A Sleeper league's schedule is OBSERVED from when this league's claims actually processed, else
   * read off Sleeper's own daily-hour setting for a league Sleeper says runs daily — the hour is
   * measured to be the Pacific run hour; the weekly day is not (contracts/sleeper/GAPS.md S-05/S-06,
   * lib/waivers/sleeperWaiverSchedule.ts). Read before the settings row, because a league with no
   * ingested settings row can still have a processing history.
   */
  const observed = !waiverScheduleIsImported(platform)
    ? ((await loadSleeperWaiverSchedules(prisma, [leagueId]).catch(() => null))?.get(leagueId) ?? null)
    : null
  const observedRun: SectionState<WaiverRunInfo> | null = observed
    ? {
        available: true,
        data: {
          schedule: observed.schedule,
          dayLabel: observed.schedule.dayOfWeek == null ? 'Every day' : DAY_LABEL[observed.schedule.dayOfWeek],
          timeLabel: `${observed.schedule.time} Pacific`,
          observedRuns: observed.source === 'observed' ? observed.agreeingRuns : null,
          fromSleeperSetting: observed.source === 'sleeper_setting',
        },
      }
    : null
  const notYetObserved = {
    available: false as const,
    reason:
      'Sleeper’s waiver day is not imported (only its hour, for a league that runs daily), and this league’s waivers have not been seen processing often enough to read the schedule yet — check the league’s waiver settings on Sleeper.',
  }

  if (!s) {
    const reason = 'no waiver settings were ingested for this league'
    return {
      waiverType: { available: false, reason },
      processTime: observedRun ?? (observed === null && !waiverScheduleIsImported(platform) ? notYetObserved : { available: false, reason }),
      tiebreak: { available: false, reason },
      claimLimits: { available: false, reason },
    }
  }

  const kind = String(s.waiverType || '').toLowerCase()
  const waiverType: SectionState<WaiverTypeInfo> = kind
    ? {
        available: true,
        data: {
          kind,
          label: WAIVER_TYPE_LABEL[kind] ?? kind,
          // Only meaningful for FAAB; a budget on a rolling-priority league would
          // be a number with nothing to spend it on.
          budget: kind === 'faab' ? s.faabBudget ?? null : null,
        },
      }
    : { available: false, reason: 'this league’s waiver type was not read' }

  const day = s.processingDayOfWeek
  const time = s.processingTimeUtc?.trim()
  const processTime: SectionState<WaiverRunInfo> =
    kind === 'off'
      ? {
          available: false,
          reason: 'this league has waivers turned off — free agents are claimed instantly',
        }
      // The Sleeper mapper does not import the schedule, so this mirror can hold AllFantasy
      // bootstrap defaults there. Sleeper's comes from its own processed claims, or not at all.
      : !waiverScheduleIsImported(platform)
        ? (observedRun ?? notYetObserved)
      : day != null && day >= 0 && day <= 6 && time
        ? {
            available: true,
            data: {
              schedule: { dayOfWeek: day, time, timeZone: 'UTC' },
              dayLabel: DAY_LABEL[day],
              timeLabel: `${time} UTC`,
              observedRuns: null,
              fromSleeperSetting: false,
            },
          }
        : { available: false, reason: 'no waiver run schedule was ingested for this league' }

  /*
   * Tiebreak, verbatim-ish from the stored rule.
   *
   * ⚠ ONLY MEANINGFUL WHEN THERE IS SOMETHING TO TIE. On a FAAB league the tie
   * is between equal bids; on rolling priority the order IS the tiebreak and
   * printing a separate rule would imply a second mechanism that does not
   * exist.
   */
  const rawTiebreak = s.tiebreakRule?.trim()
  const tiebreak: SectionState<string> =
    kind === 'off'
      ? { available: false, reason: 'no waivers to tie — free agents are claimed instantly' }
      : kind === 'rolling' || kind === 'standard' || kind === 'reverse_standings'
          ? { available: true, data: 'Waiver priority order' }
          : rawTiebreak
            ? /*
               * ⚠ "Highest FAAB bid" IS NOT A TIEBREAK ON A FAAB LEAGUE — a tie is two EQUAL bids, so
               * printing it as the answer to "how is a tie broken" was circular. The stored value is
               * the claim-priority rule (`claim_priority_behavior`). For a league AllFantasy runs,
               * the engine's own order is known (`orderClaimsForProcessing`: equal bids go to waiver
               * priority); for an imported one it was never published, and says so.
               */
              kind === 'faab' && describeTiebreakRule(rawTiebreak) === 'Highest FAAB bid'
              ? normalizeSourcePlatform(platform)
                ? { available: false, reason: 'highest bid wins — how two equal bids are split was not published' }
                : { available: true, data: 'Highest bid wins · equal bids go to waiver priority' }
              : { available: true, data: describeTiebreakRule(rawTiebreak) }
            : { available: false, reason: 'this league’s tiebreak rule was not published' }

  /*
   * Claim limits. `claimLimitPerPeriod` is a real nullable column; the minimum
   * bid lives inside the `waiverEngineConfig` JSON blob as `faab_min_bid`,
   * which is the only place the importer puts it.
   */
  const minBid = readEngineNumber(s.waiverEngineConfig, 'faab_min_bid')
  const limitParts: string[] = []
  if (s.claimLimitPerPeriod != null) {
    limitParts.push(`${s.claimLimitPerPeriod} per period`)
  }
  if (minBid != null && kind === 'faab') {
    limitParts.push(`$${minBid} minimum bid`)
  }
  const claimLimits: SectionState<string> =
    limitParts.length > 0
      ? { available: true, data: limitParts.join(' · ') }
      : {
          available: false,
          reason: 'no claim limit was published — this platform does not expose one',
        }

  return { waiverType, processTime, tiebreak, claimLimits }
}

/**
 * Pulls one number out of `waiverEngineConfig`.
 *
 * ⚠ THE BLOB IS `Json?` AND ITS SHAPE IS NOT GUARANTEED. Every access is
 * defensive on purpose: this column is written by several importers and a
 * malformed one must yield "not published", never a crash on a screen someone
 * is about to spend budget from.
 */
function readEngineNumber(config: unknown, key: string): number | null {
  if (!config || typeof config !== 'object') return null
  const raw = (config as Record<string, unknown>)[key]
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return Number(raw)
  }
  return null
}

export async function getWaiversData(
  leagueId: string,
  userId: string,
  /** The render's shared league context — see `leagueContext.ts`. */
  ctx?: LeagueContext | null,
): Promise<WaiversData | null> {
  const lc = leagueContextFor(leagueId, userId, ctx)
  const league = await lc.league()
  if (!league) return null

  const rules = await resolveWaiverRules(leagueId, String(league.platform ?? 'manual').trim().toLowerCase())

  const base = {
    league: {
      id: league.id,
      name: leagueDisplayName(league.name),
      platform: String(league.platform ?? 'manual').toLowerCase(),
      format: league.leagueType ?? null,
      platformLeagueId: league.platformLeagueId ?? null,
    },
    waiverType: rules.waiverType,
    processTime: rules.processTime,
    tiebreak: rules.tiebreak,
    claimLimits: rules.claimLimits,
  }

  const myTeam = await lc.claimedTeam()

  /*
   * ⚠ THIS WAS THE TWO-CANDIDATE JOIN, AND IT IS WHY ALL FOUR TILES READ "we cannot tell which
   * roster in this league is yours" ON A LEAGUE THE MANAGER PLAYS IN. Measured on production and
   * written up in `myRoster.ts`: with only `platformUserId` and `externalId`, 38 of 106 claimed
   * teams joined to a roster; adding the caller's own user id takes it to 93, and matches more
   * than one roster for exactly zero teams.
   *
   * It also no longer gives up when no LeagueTeam is CLAIMED. `Roster.platformUserId` sometimes
   * holds our own User uuid directly, so a manager with an imported roster and an unclaimed team
   * row is still findable — and telling him we cannot identify his roster, on the page whose
   * whole job is his FAAB and his holes, is the worst place to be wrong.
   */
  const candidates = myRosterCandidates(myTeam ?? {}, userId)

  /*
   * 🛑 `playerData` IS A WHOLE ROSTER, AND THIS READ WANTED EXACTLY ONE OF THEM.
   *
   * The league-wide columns below are all used league-wide — the FAAB ranking, the roster count
   * behind the waiver priority. `playerData` is not: the only read of it is `mine.playerData`,
   * for the caller's own roster holes. Every other manager's blob was fetched, transferred,
   * parsed and thrown away.
   *
   * Measured on the test database: 1,187 bytes per roster, so a typical 13-roster league moved
   * 15,347 bytes to use 1,187 — 92% discarded — and the heaviest leagues in the set (32 rosters)
   * moved 48,741 bytes to use the same one, 96.9% discarded.
   *
   * ⚠ TWO READS RATHER THAN ONE PARALLEL PAIR, AND THAT IS A CORRECTNESS CHOICE. Selecting the
   * blob in a second query filtered on `candidates` would run in parallel and look tidier, but it
   * re-decides WHICH roster is the caller's — and this repo has production leagues with duplicate
   * roster rows, so two independent resolutions of "mine" can disagree with each other.
   * Resolving once, exactly as before, and then fetching that row's blob by id keeps
   * the selection byte-identical to what shipped. The second hop is a few milliseconds now that
   * the database sits in the same region as the app.
   */
  const allRosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true, platformUserId: true, faabRemaining: true, waiverPriority: true },
  })

  const mineRow =
    candidates.length > 0
      ? allRosters.find((r) => candidates.includes(r.platformUserId)) ?? null
      : null

  const minePlayerData = mineRow
    ? (
        await prisma.roster
          .findUnique({ where: { id: mineRow.id }, select: { playerData: true } })
          .catch(() => null)
      )?.playerData ?? null
    : null

  const mine = mineRow ? { ...mineRow, playerData: minePlayerData } : null

  if (!mine) {
    const unknown = {
      available: false as const,
      reason: 'we cannot tell which roster in this league is yours',
    }
    return {
      ...base,
      budget: unknown,
      waiverPriority: unknown,
      rosterLoad: unknown,
      claimsQueued: unknown,
    }
  }

  const withBudget = allRosters.filter((r) => r.faabRemaining != null)

  const budget: SectionState<WaiverBudget> =
    rules.waiverType.available && rules.waiverType.data.kind !== 'faab'
      ? { available: false, reason: 'This league does not use FAAB bidding.' }
      : mine.faabRemaining == null
      ? {
          available: false,
          // Exactly the case the handoff calls out. NOT defaulted to 0 — "$0"
          // reads as "you have nothing to bid", which is a different claim from
          // "we do not know what you have".
          reason:
            'your platform does not publish remaining FAAB for this league, so we cannot show a budget — this is not the same as having none',
        }
      : {
          available: true,
          data: {
            faabRemaining: mine.faabRemaining,
            rankByBudget:
              withBudget.length > 0
                ? /* Competition rank: rosters tied on budget share a rank, so a tie cannot read as "2nd". */
                  withBudget.filter((r) => (r.faabRemaining ?? 0) > (mine.faabRemaining ?? 0)).length + 1
                : null,
            leagueRosters: allRosters.length,
            rostersWithBudget: withBudget.length,
          },
        }

  const waiverPriority: SectionState<{ priority: number; leagueRosters: number }> =
    mine.waiverPriority == null
      ? {
          available: false,
          reason: 'this league does not publish a waiver priority, or runs blind bidding instead',
        }
      : { available: true, data: { priority: mine.waiverPriority, leagueRosters: allRosters.length } }

  /*
   * 🛑 SLEEPER'S `players` ALREADY CONTAINS IR AND TAXI. Bench used to be `players − starters`, so
   * every reserve and taxi player was counted twice — once in "bench" and again in "IR/taxi" —
   * and a 10-starter roster with 3 stashed read "10 starting · 12 bench · 3 IR/taxi" for a bench
   * of nine. Counted as sets now: bench is held, not starting, and not stashed.
   */
  const pd = (mine.playerData ?? {}) as Record<string, unknown>
  const ids = (v: unknown) =>
    new Set(Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter((x) => x !== '' && x !== '0') : [])
  const starterIds = ids(pd.starters)
  const stashIds = new Set([...ids(pd.reserve), ...ids(pd.taxi)])
  const heldIds = new Set([...ids(pd.players), ...starterIds, ...stashIds])
  const players = heldIds.size
  const starters = starterIds.size
  const reserve = stashIds.size
  const bench = [...heldIds].filter((id) => !starterIds.has(id) && !stashIds.has(id)).length

  const rosterLoad: SectionState<{
    playersHeld: number
    starters: number
    bench: number
    reserve: number
  }> =
    players + starters + reserve === 0
      ? { available: false, reason: 'no roster contents stored for your team' }
      : {
          available: true,
          data: {
            playersHeld: players,
            starters,
            bench,
            reserve,
          },
        }

  /*
   * 🛑 TWO WAYS THIS TILE WAS WRONG.
   *
   * 1. It counted EVERY claim — processed, failed and cancelled included — under the label
   *    "Claims queued". One awarded claim and the tile said one was still waiting.
   * 2. On an imported league it read "0 · nothing pending", always. `WaiverClaim` is written only by
   *    AllFantasy's own claim service, so a Sleeper manager's claims never reach it; zero was a
   *    fact about our table, presented as a fact about the manager's week. Now an imported league says we
   *    cannot see them, and only a league AllFantasy runs counts its own pending claims.
   */
  const importedFrom = normalizeSourcePlatform(league.platform)
  const claimCount = importedFrom
    ? null
    : await prisma.waiverClaim
        .count({ where: { status: 'pending', roster: { leagueId, platformUserId: mine.platformUserId } } })
        .catch(() => null)

  const claimsQueued: SectionState<{ count: number; committed: number | null }> = importedFrom
    ? {
        available: false,
        reason: `claims you place on ${platformLabel(importedFrom)} are not visible to AllFantasy, so we cannot count them`,
      }
    : claimCount == null
      ? { available: false, reason: 'waiver claims could not be read for this league' }
      : { available: true, data: { count: claimCount, committed: null } }

  return { ...base, budget, waiverPriority, rosterLoad, claimsQueued }
}
