import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName, type SectionState, type UnavailableSection } from './leagueHome'

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
 * What is not: suggested claims. Ranking targets by confidence needs projections
 * and rostered-percentage data, neither of which is ingested, and a bid figure
 * invented without them would be the most actionable wrong number on the screen.
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
  /** 0–6, Sunday = 0, as stored. */
  dayOfWeek: number
  dayLabel: string
  /**
   * ⚠ UTC, and labelled as such wherever this renders. `processingTimeUtc` is
   * definitionally UTC and `League.timezone` cannot localise it: that column is
   * `@default("America/New_York")` and all 120 production leagues carry exactly
   * the default, so converting would dress a schema default up as the league's
   * real timezone and shift the hour by a number nobody chose.
   */
  timeUtc: string
}

export type WaiversData = {
  league: { id: string; name: string; platform: string; format: string | null }
  budget: SectionState<WaiverBudget>
  waiverPriority: SectionState<{ priority: number; leagueRosters: number }>
  rosterLoad: SectionState<{ playersHeld: number; starters: number; bench: number; reserve: number }>
  claimsQueued: SectionState<{ count: number; committed: number | null }>
  waiverType: SectionState<WaiverTypeInfo>
  processTime: SectionState<WaiverRunInfo>
  suggestedClaims: UnavailableSection
}

const WAIVER_TYPE_LABEL: Record<string, string> = {
  faab: 'FAAB blind bidding',
  rolling: 'Rolling waiver priority',
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
 * LeagueWaiverSettings is the ingested table: 90 rows, four distinct waiver types,
 * and 85 carrying a real processing day and time. The section was never missing
 * data — it was reading the wrong table.
 */
async function resolveWaiverRules(leagueId: string): Promise<{
  waiverType: SectionState<WaiverTypeInfo>
  processTime: SectionState<WaiverRunInfo>
}> {
  const s = await prisma.leagueWaiverSettings.findUnique({
    where: { leagueId },
    select: {
      waiverType: true,
      faabBudget: true,
      processingDayOfWeek: true,
      processingTimeUtc: true,
    },
  })

  if (!s) {
    const reason = 'no waiver settings were ingested for this league'
    return {
      waiverType: { available: false, reason },
      processTime: { available: false, reason },
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
      : day != null && day >= 0 && day <= 6 && time
        ? { available: true, data: { dayOfWeek: day, dayLabel: DAY_LABEL[day], timeUtc: time } }
        : { available: false, reason: 'no waiver run schedule was ingested for this league' }

  return { waiverType, processTime }
}

export async function getWaiversData(leagueId: string, userId: string): Promise<WaiversData | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, platform: true, leagueType: true },
  })
  if (!league) return null

  const rules = await resolveWaiverRules(leagueId)

  const base = {
    league: {
      id: league.id,
      name: leagueDisplayName(league.name),
      platform: String(league.platform ?? 'manual').toLowerCase(),
      format: league.leagueType ?? null,
    },
    waiverType: rules.waiverType,
    processTime: rules.processTime,
    suggestedClaims: {
      available: false as const,
      reason:
        'ranking targets needs weekly projections and rostered-percentage data; neither is ingested, and a suggested bid without them would be a number to act on that nothing supports',
    },
  }

  const myTeam = await prisma.leagueTeam.findFirst({
    where: { leagueId, claimedByUserId: userId },
    select: { platformUserId: true, externalId: true },
  })

  const candidates = [myTeam?.platformUserId, myTeam?.externalId].filter(Boolean) as string[]

  const allRosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { platformUserId: true, faabRemaining: true, waiverPriority: true, playerData: true },
  })

  const mine =
    candidates.length > 0
      ? allRosters.find((r) => candidates.includes(r.platformUserId)) ?? null
      : null

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
    mine.faabRemaining == null
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
                ? withBudget
                    .slice()
                    .sort((a, b) => (b.faabRemaining ?? 0) - (a.faabRemaining ?? 0))
                    .findIndex((r) => r.platformUserId === mine.platformUserId) + 1
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

  const pd = (mine.playerData ?? {}) as Record<string, unknown>
  const count = (v: unknown) => (Array.isArray(v) ? v.filter((x) => String(x) !== '0').length : 0)
  const players = count(pd.players)
  const starters = count(pd.starters)
  const reserve = count(pd.reserve) + count(pd.taxi)

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
            // `players` is the catch-all list, so bench is what is not starting.
            bench: Math.max(0, players - starters),
            reserve,
          },
        }

  const claimCount = await prisma.waiverClaim
    .count({ where: { roster: { leagueId, platformUserId: mine.platformUserId } } })
    .catch(() => null)

  const claimsQueued: SectionState<{ count: number; committed: number | null }> =
    claimCount == null
      ? { available: false, reason: 'waiver claims are not ingested for this league' }
      : { available: true, data: { count: claimCount, committed: null } }

  return { ...base, budget, waiverPriority, rosterLoad, claimsQueued }
}
