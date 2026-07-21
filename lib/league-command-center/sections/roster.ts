import 'server-only'

/**
 * Roster section data — the viewer's own lineup.
 *
 * **Slot eligibility is read from the repo's real source, never re-derived.**
 * The design prototype hardcodes `FLEX = RB/WR/TE` and `SF = QB/RB/WR/TE`, which
 * is wrong in three separate ways here: the canonical tokens are `FLX`/`SF`
 * (see `normalizeToken`, which also folds `D/ST`→`DEF` and `BN`→`BENCH`),
 * eligibility is per-sport (`NBA` uses `G`/`F`/`UTIL`), and leagues can define
 * their own layout in settings. So this module reads
 * `getRedraftSportConfig(sport).flexPositions` — the exact map
 * `lib/redraft/lineupValidation.ts` validates against — and ships the resolved
 * positions per slot to the client. The UI then cannot disagree with the
 * server-side validator about what is legal.
 *
 * Locks come from `hydrateRedraftLineupLocks`, so a player whose game has
 * kicked off is genuinely immovable rather than optimistically draggable.
 */
import { prisma } from '@/lib/prisma'
import { getRedraftSportConfig } from '@/lib/redraft/sportConfig'
import { normalizeToken } from '@/lib/redraft/lineupValidation'
import { hydrateRedraftLineupLocks } from '@/lib/redraft/lineupLock'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'

/** Slots that are never starters. Mirrors `NON_STARTER_SLOTS` in lineupValidation. */
const NON_STARTER_SLOTS = new Set(['BENCH', 'IR', 'TAXI', 'DEVY', 'RESERVE'])

export interface RosterSlotPlayer {
  playerId: string
  playerName: string
  position: string
  team: string | null
  slotType: string
  isLocked: boolean
  injuryStatus: string | null
  byeWeek: number | null
}

export interface RosterSlotGroup {
  /** Canonical slot token, e.g. `QB`, `FLX`, `BENCH`. */
  slotType: string
  /** Display label, e.g. `FLEX`. */
  label: string
  isStarter: boolean
  /** How many players this slot holds, from the league's resolved config. */
  capacity: number
  /**
   * Positions genuinely allowed in this slot, resolved from the same per-sport
   * config the server-side validator uses. Empty for bench/IR/taxi, which accept
   * anything.
   */
  eligiblePositions: string[]
  players: RosterSlotPlayer[]
}

export interface RosterSectionData {
  available: boolean
  rosterId: string | null
  /** Null when the viewer has no roster in this league. */
  groups: RosterSlotGroup[]
  /** Where the slot layout came from — commissioner settings or sport defaults. */
  configSource: 'commissioner' | 'defaults' | null
  week: number | null
  season: number | null
  sport: string | null
  /** True when every starter slot is filled, none is overfilled, and no player sits in an undefined slot. */
  startersComplete: boolean
  emptyStarterSlots: string[]
  /**
   * Starter slots holding more players than the league's layout allows — e.g.
   * two RBs stored in a one-RB slot. A real legality problem, not cosmetic:
   * such a lineup cannot be fielded as-is.
   */
  overfilledSlots: { label: string; capacity: number; count: number }[]
  /** Players whose stored slot the league's layout does not define. */
  unassignedCount: number
  /** Starters flagged OUT/IR/SUSP etc. — real statuses, not guesses. */
  problemStarters: { playerName: string; slotType: string; injuryStatus: string }[]
  lockedCount: number
  warnings: string[]
}

const EMPTY: RosterSectionData = {
  available: false,
  rosterId: null,
  groups: [],
  configSource: null,
  week: null,
  season: null,
  sport: null,
  startersComplete: false,
  emptyStarterSlots: [],
  overfilledSlots: [],
  unassignedCount: 0,
  problemStarters: [],
  lockedCount: 0,
  warnings: [],
}

/** Injury statuses that make a starter a real problem. Mirrors lineupValidation. */
const INJURY_ERROR_STATUSES = new Set([
  'OUT', 'O', 'IR', 'INJURED_RESERVE', 'PUP', 'NFI', 'RESERVE',
  'SUSP', 'SUSPENDED', 'COVID', 'INACTIVE', 'DNR',
])

function slotLabel(token: string): string {
  if (token === 'FLX') return 'FLEX'
  if (token === 'SF') return 'SUPERFLEX'
  if (token === 'BENCH') return 'BN'
  return token
}

export async function loadRosterSection(args: {
  leagueId: string
  userId: string
}): Promise<RosterSectionData> {
  const warnings: string[] = []

  const league = await prisma.league
    .findUnique({
      where: { id: args.leagueId },
      select: { sport: true, settings: true },
    })
    .catch(() => null)

  const season = await prisma.redraftSeason
    .findFirst({
      where: { leagueId: args.leagueId },
      orderBy: { season: 'desc' },
      select: { id: true, sport: true, season: true, currentWeek: true },
    })
    .catch((error) => {
      console.error('[command-center/roster] season lookup failed', { leagueId: args.leagueId, error })
      return null
    })

  if (!season) {
    return { ...EMPTY, warnings: ['No active season — your roster is unavailable for this league.'] }
  }

  // Read-only identity seam. Never the write-capable variant: rendering a page
  // must not repair owner ids as a side effect.
  let rosterId: string | null = null
  try {
    const { resolveRedraftRosterLookupReadOnly } = await import('@/lib/redraft/redraftRosterIdentity')
    const lookup = await resolveRedraftRosterLookupReadOnly({
      userId: args.userId,
      seasonId: season.id,
      leagueId: args.leagueId,
    })
    rosterId = lookup.roster?.id ?? null
  } catch (error) {
    console.error('[command-center/roster] roster identity resolve failed', error)
    warnings.push('Could not identify your roster in this league.')
  }

  if (!rosterId) {
    return { ...EMPTY, warnings: [...warnings, 'You do not have a roster in this league.'] }
  }

  const rawPlayers = await prisma.redraftRosterPlayer
    .findMany({
      where: { rosterId, droppedAt: null },
      select: {
        playerId: true,
        playerName: true,
        position: true,
        team: true,
        slotType: true,
        isLocked: true,
        injuryStatus: true,
        byeWeek: true,
      },
    })
    .catch((error) => {
      console.error('[command-center/roster] player load failed', { rosterId, error })
      return []
    })

  const sport = season.sport || String(league?.sport ?? 'NFL')
  const week = season.currentWeek > 0 ? season.currentWeek : null

  // Real lock state — a kicked-off player is immovable, not optimistically draggable.
  let players = rawPlayers.map((p) => ({ ...p, isLocked: p.isLocked ?? false }))
  if (week !== null) {
    try {
      const hydrated = await hydrateRedraftLineupLocks(prisma, {
        sport,
        season: season.season,
        week,
        rosterId,
        leagueSettings: league?.settings ?? null,
        players,
      })
      players = hydrated.players
      warnings.push(...hydrated.warnings)
    } catch (error) {
      console.error('[command-center/roster] lock hydration failed', error)
      warnings.push('Lock status could not be confirmed — treat move availability as provisional.')
    }
  }

  const rosterConfig = resolveRedraftRosterConfig(sport, league?.settings ?? null)
  const sportConfig = getRedraftSportConfig(sport)

  // Build the slot groups from the league's resolved config, not from whatever
  // slots happen to be occupied — an empty required slot must still render.
  const groups: RosterSlotGroup[] = []

  for (const [token, capacity] of rosterConfig.starterCapacities) {
    const normalized = normalizeToken(token)
    const flex = sportConfig.flexPositions[normalized] ?? sportConfig.flexPositions[token]
    groups.push({
      slotType: normalized,
      label: slotLabel(normalized),
      isStarter: true,
      capacity,
      eligiblePositions: flex?.length ? flex.map(normalizeToken) : [normalized],
      players: [],
    })
  }

  const nonStarters: [string, number][] = [
    ['BENCH', rosterConfig.benchSlots],
    ['IR', rosterConfig.irSlots],
    ['TAXI', rosterConfig.taxiSlots],
  ]
  for (const [token, capacity] of nonStarters) {
    if (capacity <= 0) continue
    groups.push({
      slotType: token,
      label: slotLabel(token),
      isStarter: false,
      capacity,
      eligiblePositions: [], // accepts anything
      players: [],
    })
  }

  // Place players into their groups.
  const byToken = new Map(groups.map((g) => [g.slotType, g]))
  const unplaced: RosterSlotPlayer[] = []

  for (const player of players) {
    const entry: RosterSlotPlayer = {
      playerId: player.playerId,
      playerName: player.playerName,
      position: normalizeToken(player.position),
      team: player.team,
      slotType: normalizeToken(player.slotType),
      isLocked: player.isLocked,
      injuryStatus: player.injuryStatus,
      byeWeek: player.byeWeek,
    }
    const group = byToken.get(entry.slotType)
    if (group) group.players.push(entry)
    else unplaced.push(entry)
  }

  // A player whose stored slot is not in the league's configured layout is a real
  // data inconsistency. Surface it in a bench-like bucket rather than dropping
  // the player silently — a missing player reads as "I was robbed".
  if (unplaced.length > 0) {
    groups.push({
      slotType: 'UNASSIGNED',
      label: 'Unassigned',
      isStarter: false,
      capacity: unplaced.length,
      eligiblePositions: [],
      players: unplaced,
    })
    warnings.push(
      `${unplaced.length} player${unplaced.length === 1 ? '' : 's'} sit in a slot this league's ` +
        'roster layout does not define. They are shown as Unassigned.',
    )
  }

  const starterGroups = groups.filter((g) => g.isStarter && !NON_STARTER_SLOTS.has(g.slotType))

  const emptyStarterSlots: string[] = []
  const overfilledSlots: { label: string; capacity: number; count: number }[] = []
  for (const group of starterGroups) {
    const delta = group.capacity - group.players.length
    for (let i = 0; i < delta; i += 1) emptyStarterSlots.push(group.label)
    if (delta < 0) {
      overfilledSlots.push({
        label: group.label,
        capacity: group.capacity,
        count: group.players.length,
      })
    }
  }

  if (overfilledSlots.length > 0) {
    warnings.push(
      overfilledSlots
        .map(
          (slot) =>
            `${slot.count} players occupy the ${slot.label} slot but this league allows ${slot.capacity}.`,
        )
        .join(' '),
    )
  }

  const problemStarters = starterGroups.flatMap((group) =>
    group.players
      .filter((p) => p.injuryStatus && INJURY_ERROR_STATUSES.has(normalizeToken(p.injuryStatus)))
      .map((p) => ({
        playerName: p.playerName,
        slotType: group.label,
        injuryStatus: p.injuryStatus as string,
      })),
  )

  return {
    available: true,
    rosterId,
    groups,
    configSource: rosterConfig.source,
    week,
    season: season.season,
    sport,
    /*
     * A lineup is only "set" when it could actually be fielded. Empty slots,
     * overfilled slots, out starters, and players parked in slots the league
     * does not define all disqualify it. Reporting "set" while any of those hold
     * would be a false all-clear on a lineup the server would reject.
     */
    startersComplete:
      emptyStarterSlots.length === 0 &&
      overfilledSlots.length === 0 &&
      problemStarters.length === 0 &&
      unplaced.length === 0,
    emptyStarterSlots,
    overfilledSlots,
    unassignedCount: unplaced.length,
    problemStarters,
    lockedCount: players.filter((p) => p.isLocked).length,
    warnings,
  }
}
