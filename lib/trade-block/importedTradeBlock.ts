import 'server-only'

import { prisma } from '@/lib/prisma'
import { matchTeamIdForRoster } from '@/lib/decision-os/world/assemble'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

/**
 * The trade block for an IMPORTED Sleeper league — the players its managers have marked, in
 * AllFantasy, as available.
 *
 * ── 🛑 SLEEPER DOES NOT SHARE ITS OWN TRADE BLOCK ─────────────────────────────────────────────
 * Measured 2026-09-17 (user-approved capture of one league's public rosters): no field in Sleeper's
 * public roster payload carries the block, and the only other route — its GraphQL API — needs a
 * user's login token, which this app must not hold. So Chimmy cannot see a Sleeper league's own
 * block, and nothing here can. User decision, same day: say so plainly, and let managers mark their
 * OWN players here instead.
 *
 * Stored in the existing `TradeBlockEntry` table (`trade_block_entries`), which is keyed exactly the
 * way a Sleeper league is: the Sleeper league id, the Sleeper integer roster id, the Sleeper player
 * id. Its production columns were checked against the schema before this was written; it held no
 * rows, and the legacy readers (trades panel, OTB tagging) already read it in this shape.
 *
 * ⚠ ONLY YOUR OWN PLAYERS. Ownership is proven on the server by the rule every "is this yours"
 * read in /core uses — the team you claimed, its roster, and the player on that roster — never by a
 * flag from the client.
 *
 * ⚠ A LISTING GOES STALE THE MOMENT THE PLAYER MOVES. The row is unique per (league, player), so a
 * player traded after he was listed would still read as "on the block" for a team that no longer
 * has him. Every read keeps a listing only while the roster that listed him still holds him.
 */

export type TradeBlockSupport =
  | { supported: true; note: string }
  | { supported: false; note: string }

const PLATFORM_LABEL: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  fantrax: 'Fantrax',
  mfl: 'MyFantasyLeague',
  fleaflicker: 'Fleaflicker',
  nfl: 'NFL Fantasy',
  cbs: 'CBS',
}

/** What this league's trade block can show, said the way a manager should read it. */
export function tradeBlockSupport(platform: string | null | undefined): TradeBlockSupport {
  const key = String(platform ?? '').trim().toLowerCase()
  if (key === 'sleeper') {
    return {
      supported: true,
      note: "Sleeper doesn't share its trade block with outside apps, so this only includes players managers put on the block in AllFantasy.",
    }
  }
  const label = PLATFORM_LABEL[key] ?? 'This platform'
  return {
    supported: false,
    note: `${label} doesn't share its trade block with AllFantasy, and marking players here is only available for Sleeper leagues so far.`,
  }
}

type RosterRow = { platformUserId: string; playerData: unknown }
type TeamRow = {
  id: string
  externalId: string
  platformUserId: string | null
  claimedByUserId: string | null
  ownerName: string | null
  teamName: string | null
}
export type TradeBlockEntryRow = {
  playerId: string
  rosterId: number
  playerName: string
  position: string | null
  team: string | null
  createdByUsername: string
  updatedAt: Date
}

const SLOT_KEYS = ['players', 'starters', 'reserve', 'taxi'] as const

function playerIdsOf(playerData: unknown): Set<string> {
  const pd = (playerData ?? {}) as Record<string, unknown>
  const out = new Set<string>()
  for (const key of SLOT_KEYS) {
    const v = pd[key]
    if (Array.isArray(v)) for (const x of v) if (x != null && String(x)) out.add(String(x))
  }
  return out
}

/*
 * Sleeper numbers rosters 1..N. The import falls back to the OWNER id when a roster id is missing
 * (`sleeper-import-process.ts`), and an owner id is also all digits — an 18-digit one — so anything
 * past a league's plausible size is not a roster id, whatever it looks like.
 */
const MAX_SLEEPER_ROSTER_ID = 1000

function asRosterId(v: unknown): number | null {
  const s = v == null ? '' : String(v).trim()
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_SLEEPER_ROSTER_ID ? n : null
}

/**
 * The Sleeper integer `roster_id` of a roster. The import writes it to `playerData.source_team_id`
 * and to the team's `externalId`; the team's value is used only when the roster does not carry one.
 */
export function sleeperRosterIdOf(roster: RosterRow, team: TeamRow | null): number | null {
  const fromRoster = asRosterId(((roster.playerData ?? {}) as Record<string, unknown>).source_team_id)
  return fromRoster ?? asRosterId(team?.externalId)
}

/*
 * The team row for a roster, by the shared rule (`matchTeamIdForRoster`): the Sleeper roster id, then
 * the owner id, then the claimant. Exported because the player card names a holder's team the same way.
 *
 * ⚠ A CLAIMED TEAM'S ROSTER IS KEYED BY THE CLAIMANT'S ALLFANTASY ID, not the Sleeper owner id.
 * Measured 2026-09-17 on production: matching by owner id alone found no team for 5 of Draft Junkies'
 * 12 rosters, the league owner's among them, so a listing from that team read "listed by <username>"
 * with no team name.
 *
 * The roster id is compared as a NUMBER first: the shared rule reads `source_team_id` only when it is
 * a string.
 */
export function teamForRoster<T extends TeamRow>(roster: RosterRow, teams: T[]): T | null {
  const rosterId = sleeperRosterIdOf(roster, null)
  const bySource = rosterId == null ? undefined : teams.find((t) => asRosterId(t.externalId) === rosterId)
  if (bySource) return bySource
  const id = matchTeamIdForRoster(roster, teams)
  const byRule = id ? teams.find((t) => t.id === id) : undefined
  // The earlier fallback, kept: an import that keyed a roster by its team's external id.
  return byRule ?? teams.find((t) => t.externalId === roster.platformUserId) ?? null
}

/** The roster you manage in this league — the claimed-team rule every /core ownership read uses. */
export function yourRoster(
  userId: string,
  rosters: RosterRow[],
  teams: TeamRow[],
): { roster: RosterRow; team: TeamRow } | null {
  const team = teams.find((t) => t.claimedByUserId === userId) ?? null
  if (!team) return null
  const ids = new Set([team.platformUserId, team.externalId, userId].filter((x): x is string => Boolean(x)))
  const roster = rosters.find((r) => ids.has(r.platformUserId)) ?? null
  return roster ? { roster, team } : null
}

export type TradeBlockListing = {
  sleeperId: string
  playerName: string
  position: string | null
  nflTeam: string | null
  rosterId: number
  /** The fantasy team that listed him, when its row is on file. */
  teamName: string | null
  ownerName: string | null
  /** When the listing was last set, ISO. */
  since: string
}

/**
 * Listings that are still true: the roster that listed each player still has him.
 * Pure, so the player card can apply it to rosters it has already loaded.
 */
export function currentListings(entries: TradeBlockEntryRow[], rosters: RosterRow[], teams: TeamRow[]): TradeBlockListing[] {
  /*
   * ⚠ TWO ROWS CAN CARRY ONE SLEEPER ROSTER ID, so arrival order must not decide which one answers.
   * Production holds 33 ghost roster rows across 29 leagues (staging 14) — an owner change leaves the
   * old row behind with stale or empty `playerData`. If a ghost answered for its roster id, every
   * listing from that team would test against the wrong roster and silently disappear. The row holding
   * the most players wins; a ghost holds fewer, or none.
   */
  const byRosterId = new Map<number, { roster: RosterRow; team: TeamRow | null; held: number }>()
  for (const roster of rosters) {
    const team = teamForRoster(roster, teams)
    const id = sleeperRosterIdOf(roster, team)
    if (id == null) continue
    const held = playerIdsOf(roster.playerData).size
    const seen = byRosterId.get(id)
    if (!seen || held > seen.held) byRosterId.set(id, { roster, team, held })
  }
  const out: TradeBlockListing[] = []
  for (const e of entries) {
    const holder = byRosterId.get(e.rosterId)
    if (!holder || !playerIdsOf(holder.roster.playerData).has(e.playerId)) continue
    out.push({
      sleeperId: e.playerId,
      playerName: e.playerName,
      position: e.position,
      nflTeam: e.team,
      rosterId: e.rosterId,
      teamName: holder.team?.teamName ?? null,
      ownerName: holder.team?.ownerName ?? e.createdByUsername,
      since: e.updatedAt.toISOString(),
    })
  }
  return out
}

export const TRADE_BLOCK_ENTRY_SELECT = {
  playerId: true,
  rosterId: true,
  playerName: true,
  position: true,
  team: true,
  createdByUsername: true,
  updatedAt: true,
} as const

/*
 * Null only when the league is not there. A failed read THROWS: swallowing it into empty rosters would
 * drop every listing and report "nobody is on the block", which is the one answer this must not invent.
 */
async function loadLeague(leagueId: string) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, platform: true, platformLeagueId: true },
  })
  if (!league) return null
  const [rosters, teams] = await Promise.all([
    prisma.roster.findMany({ where: { leagueId }, select: { platformUserId: true, playerData: true } }),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { id: true, externalId: true, platformUserId: true, claimedByUserId: true, ownerName: true, teamName: true },
    }),
  ])
  return { league, rosters: rosters as RosterRow[], teams: teams as TeamRow[] }
}

/** Upper bound on one league's listings; a 12-team league with every bench player listed fits. */
const MAX_LISTINGS = 200

export type TradeBlockRead = {
  support: TradeBlockSupport
  listings: TradeBlockListing[]
}

/**
 * The league's current trade block, or null when it could not be read (the league is missing, or a
 * read failed) — never an empty list standing in for a failure. The caller must have proved
 * membership: this reads every roster in the league.
 */
export async function readTradeBlock(leagueId: string): Promise<TradeBlockRead | null> {
  try {
    const loaded = await loadLeague(leagueId)
    if (!loaded) return null
    const support = tradeBlockSupport(loaded.league.platform)
    if (!support.supported || !loaded.league.platformLeagueId) return { support, listings: [] }
    const entries = await activeTradeBlockEntries(loaded.league.platformLeagueId)
    return { support, listings: currentListings(entries, loaded.rosters, loaded.teams) }
  } catch {
    return null
  }
}

/**
 * This league's active listing ROWS, unfiltered, newest first.
 *
 * For a caller that has already loaded the league's rosters and teams: pass these to
 * `currentListings` with those rows rather than making `readTradeBlock` read them again. Throws if
 * the read fails — an empty list must not stand in for "we could not look".
 */
export async function activeTradeBlockEntries(sleeperLeagueId: string): Promise<TradeBlockEntryRow[]> {
  return prisma.tradeBlockEntry.findMany({
    where: { sleeperLeagueId, isActive: true },
    orderBy: { updatedAt: 'desc' },
    take: MAX_LISTINGS,
    select: TRADE_BLOCK_ENTRY_SELECT,
  })
}

/**
 * One player's current listing in this league, or null when he is not listed. Same staleness rule
 * as the full read. THROWS when the block could not be read: "unreadable" is not "not listed".
 */
export async function tradeBlockListingFor(leagueId: string, sleeperId: string): Promise<TradeBlockListing | null> {
  const read = await readTradeBlock(leagueId)
  if (!read) throw new Error('The trade block could not be read.')
  return read.listings.find((l) => l.sleeperId === sleeperId) ?? null
}

export type SetTradeBlockResult =
  | { ok: true; onBlock: boolean }
  | {
      ok: false
      reason: 'league_not_found' | 'unsupported_platform' | 'no_team' | 'not_your_player' | 'no_roster_id'
      message: string
    }

/**
 * Put one of YOUR players on this league's trade block, or take him off.
 * The caller must have proved membership; ownership of the player is proved here.
 */
export async function setTradeBlock(args: {
  leagueId: string
  userId: string
  sleeperId: string
  onBlock: boolean
}): Promise<SetTradeBlockResult> {
  const loaded = await loadLeague(args.leagueId)
  if (!loaded) return { ok: false, reason: 'league_not_found', message: 'League not found.' }
  const support = tradeBlockSupport(loaded.league.platform)
  if (!support.supported || !loaded.league.platformLeagueId) {
    return { ok: false, reason: 'unsupported_platform', message: support.note }
  }

  const mine = yourRoster(args.userId, loaded.rosters, loaded.teams)
  if (!mine) {
    return { ok: false, reason: 'no_team', message: 'Claim your team in this league to use its trade block.' }
  }
  if (!playerIdsOf(mine.roster.playerData).has(args.sleeperId)) {
    return { ok: false, reason: 'not_your_player', message: 'Only players on your own roster can go on your trade block.' }
  }
  const rosterId = sleeperRosterIdOf(mine.roster, mine.team)
  if (rosterId == null) {
    return { ok: false, reason: 'no_roster_id', message: "This league's roster ids are not on file yet; try again after the next sync." }
  }

  const sleeperLeagueId = loaded.league.platformLeagueId

  if (!args.onBlock) {
    // He is on your roster, so any listing of him in this league is yours to withdraw.
    await prisma.tradeBlockEntry.updateMany({
      where: { sleeperLeagueId, playerId: args.sleeperId },
      data: { isActive: false },
    })
    return { ok: true, onBlock: false }
  }

  // The snapshot comes from our player row, never from the request. A missing row is a placeholder
  // name, not a refusal: the listing is keyed by id, and the name is only what the block displays.
  const player = await prisma.sportsPlayer
    .findFirst({
      where: { sleeperId: args.sleeperId, sport: { equals: 'NFL', mode: 'insensitive' } },
      orderBy: [{ fetchedAt: 'desc' }],
      select: { name: true, position: true, team: true },
    })
    .catch(() => null)

  /*
   * ⚠ `SportsPlayer.team` IS NOT ALWAYS AN ABBREVIATION — production holds "Las Vegas Raiders" for some
   * rows (2026-09-17), and the column is 8 characters, so a plain slice stored "Las Vega". Folded to the
   * club code; anything that still does not fit is left out rather than cut.
   */
  const club = normalizeTeamAbbrev(player?.team)
  const snapshot = {
    rosterId,
    playerName: (player?.name ?? `Player ${args.sleeperId}`).slice(0, 128),
    position: player?.position?.slice(0, 16) ?? null,
    team: club && club.length <= 8 ? club : null,
    createdByUsername: (mine.team.ownerName ?? mine.team.teamName ?? 'manager').slice(0, 64),
    isActive: true,
  }
  await prisma.tradeBlockEntry.upsert({
    where: { sleeperLeagueId_playerId: { sleeperLeagueId, playerId: args.sleeperId } },
    create: { sleeperLeagueId, playerId: args.sleeperId, ...snapshot },
    update: snapshot,
  })
  return { ok: true, onBlock: true }
}
