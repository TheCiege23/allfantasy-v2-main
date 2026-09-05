import 'server-only'

import { prisma } from '@/lib/prisma'
import type { SectionState } from './leagueHome'
import { leagueDisplayName } from './leagueHome'
import { normalizePosition } from './positionNormalization'
import { coverageReason, rosterIdCoverage, sampleRosterIds } from './rosterIdCoverage'
import { activityWindow, DEFAULT_TIME_ZONE, zoneLabel, type ActivityWindow } from './managerActivityWindow'

/**
 * Player Finder — "TRADE WINDOW": who to pitch for this player in a league,
 * and when they usually move.
 *
 * The handoff's panel says "@mikeD is usually on Sun 10a–12p · Online now".
 * Half of that is buildable and half is not, and this loader is careful about
 * which half is which (Guap, 2026-09-02: ingest it if possible, otherwise drop
 * it — never print a guess beside a real name):
 *
 *   BUILT   the usual window and the last move, from `decision_os_imported_activity`
 *           — every processed Sleeper transaction with the provider's own
 *           timestamp (measured 2026-09-05 on production: 5,045 roster moves,
 *           2,315 waivers and 578 trades across ~87 leagues, 24 distinct hours,
 *           fresh to the day before). Attribution is `normalized.managerKeys`:
 *           the AllFantasy user id when the manager linked their Sleeper account
 *           (reversed through `UserProfile.sleeperUserId`), else `sleeper:<id>`.
 *           The row's own `externalManagerId`/`appUserId`/`rosterId` columns
 *           are NULL on every row, so they are not consulted.
 *   BUILT   the roster need at his position, and the record — from rosters and
 *           `LeagueTeam`, both already read by the rest of this screen.
 *   DROPPED "online now" / "usually on". Nothing we hold says when a manager is
 *           IN the app: `engagement_events` is empty in production and is only
 *           written once a day from five niche pages; sessions carry an expiry,
 *           not a last-seen. So the sentence is "usually MOVES", and the dot
 *           pulses only for a manager who moved in the last day.
 *   ABSENT  ESPN and Yahoo activity — not ingested for any league. The panel
 *           still names the manager, need and record and says the window is
 *           missing, rather than rendering a window it does not have.
 */

export type MoveKind = 'trade' | 'waiver' | 'roster_move'

export type PresenceNeed = {
  position: string
  /** Players at that position on the roster. */
  held: number
  /** Dedicated starting slots at that position in this league (FLEX not counted). */
  starters: number
  level: 'thin' | 'set' | 'deep'
}

export type PresenceManager = {
  /** `owner` has him; a `buyer` is a manager whose roster wants his position. */
  role: 'owner' | 'buyer'
  teamName: string
  ownerName: string
  avatarUrl: string | null
  /** The team's platform id (LeagueTeam.externalId), for the trade deep link. */
  externalId: string
  record: string | null
  rank: number | null
  /** Roster need at the player's position — buyers only. */
  need: PresenceNeed | null
  /** Owner rows: whether he sits in a starting slot on their roster. */
  startsHim: boolean | null
  window: ActivityWindow | null
  lastMove: { at: string; kind: MoveKind } | null
  /** Moves we hold for this manager in this league. */
  moves: number
}

export type ManagerPresence = {
  leagueId: string
  leagueName: string
  platform: string
  platformLeagueId: string | null
  season: number | null
  /** The league's own zone; every window is stated in it. */
  timeZone: string
  zone: string
  player: { sleeperId: string; position: string | null }
  /** Whether the viewer holds him here (buyers listed) or someone else does (the owner listed). */
  holder: 'yours' | 'other'
  managers: PresenceManager[]
  /** True when we hold any of this league's transaction history. */
  activityIngested: boolean
  /** Newest move we hold in the league, ISO. */
  newestMove: string | null
  /** Moves in the league we could not put a name to. */
  unattributed: number
}

const KINDS: MoveKind[] = ['trade', 'waiver', 'roster_move']
/** Rows read per league. A busy dynasty league writes a few hundred a season. */
const MAX_ROWS = 4000
export const MAX_BUYERS = 3

function asIds(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))).filter(Boolean) : []
}

function allIds(pd: Record<string, unknown>): string[] {
  return [...new Set([...asIds(pd.players), ...asIds(pd.starters), ...asIds(pd.reserve), ...asIds(pd.taxi)])]
}

function contains(pd: Record<string, unknown>, id: string): boolean {
  return allIds(pd).includes(id)
}

function recordOf(t: { wins: number; losses: number; ties: number }): string | null {
  if (t.wins + t.losses + t.ties === 0) return null
  return t.ties ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`
}

function needLevel(held: number, starters: number): PresenceNeed['level'] {
  if (held <= starters) return 'thin'
  if (held === starters + 1) return 'set'
  return 'deep'
}

function isMoveKind(v: unknown): v is MoveKind {
  return typeof v === 'string' && (KINDS as string[]).includes(v)
}

type TeamRow = {
  externalId: string
  platformUserId: string | null
  claimedByUserId: string | null
  ownerName: string
  teamName: string
  avatarUrl: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  currentRank: number | null
}

export async function getManagerPresence(
  leagueId: string,
  sleeperId: string,
  userId: string | null,
  opts: { position?: string | null } = {},
): Promise<SectionState<ManagerPresence>> {
  if (!userId) return { available: false, reason: 'sign in to see who to pitch' }

  const league = await prisma.league
    .findUnique({
      where: { id: leagueId },
      select: { id: true, name: true, platform: true, platformLeagueId: true, season: true, settings: true, timezone: true },
    })
    .catch(() => null)
  if (!league) return { available: false, reason: 'league not found' }

  const platform = String(league.platform ?? 'manual').toLowerCase()

  const [teams, rosters, rows] = await Promise.all([
    prisma.leagueTeam
      .findMany({
        where: { leagueId },
        select: {
          externalId: true,
          platformUserId: true,
          claimedByUserId: true,
          ownerName: true,
          teamName: true,
          avatarUrl: true,
          wins: true,
          losses: true,
          ties: true,
          pointsFor: true,
          currentRank: true,
        },
      })
      .catch(() => [] as TeamRow[]),
    prisma.roster
      .findMany({ where: { leagueId }, select: { platformUserId: true, playerData: true } })
      .catch(() => [] as Array<{ platformUserId: string; playerData: unknown }>),
    prisma.decisionOsImportedActivity
      .findMany({
        where: {
          activityType: { in: KINDS },
          OR: [{ afLeagueId: leagueId }, ...(league.platformLeagueId ? [{ providerLeagueId: league.platformLeagueId }] : [])],
        },
        orderBy: { occurredAt: 'desc' },
        take: MAX_ROWS,
        select: { occurredAt: true, activityType: true, normalized: true },
      })
      .catch(() => [] as Array<{ occurredAt: Date; activityType: string; normalized: unknown }>),
  ])

  if (rosters.length === 0) {
    return { available: false, reason: 'no rosters have been imported for this league, so we cannot tell who has him' }
  }

  /*
   * The same id-vocabulary guard the ownership card uses: an ESPN roster full of
   * ESPN ids matches nothing in a Sleeper-id scan, and "nobody has him" would
   * then be a lie. See rosterIdCoverage.ts.
   */
  const sample = sampleRosterIds(rosters.map((r) => r.playerData))
  const knownRows =
    sample.length > 0
      ? await prisma.sportsPlayer
          .findMany({ where: { sleeperId: { in: sample } }, select: { sleeperId: true } })
          .catch(() => [] as Array<{ sleeperId: string | null }>)
      : []
  const coverage = rosterIdCoverage(sample, new Set(knownRows.map((r) => r.sleeperId).filter((x): x is string => Boolean(x))))

  const holder = rosters.find((r) => contains((r.playerData ?? {}) as Record<string, unknown>, sleeperId)) ?? null
  if (!holder && !coverage.usable) return { available: false, reason: coverageReason(platform) }
  if (!holder) return { available: false, reason: 'nobody has him here — he is a free agent, so there is nobody to pitch; claim him' }

  const yours = teams.find((t) => t.claimedByUserId === userId) ?? null
  const yourIds = new Set([yours?.platformUserId, yours?.externalId, userId].filter((x): x is string => Boolean(x)))
  const holderIsYou = yourIds.has(holder.platformUserId)

  const teamOfRoster = (platformUserId: string): TeamRow | null =>
    teams.find((t) => t.platformUserId === platformUserId) ?? teams.find((t) => t.externalId === platformUserId) ?? null

  /* ── Attribution: manager key → team ─────────────────────────────────── */
  const byKey = new Map<string, TeamRow>()
  for (const t of teams) {
    if (t.platformUserId) {
      byKey.set(t.platformUserId, t)
      byKey.set(`sleeper:${t.platformUserId}`, t)
      byKey.set(`sleeper:manager:${t.platformUserId}`, t)
    }
    if (t.claimedByUserId) byKey.set(t.claimedByUserId, t)
    byKey.set(t.externalId, t)
  }
  const keysOf = (normalized: unknown): string[] => {
    const raw = (normalized as { managerKeys?: unknown } | null)?.managerKeys
    return Array.isArray(raw) ? raw.map((k) => String(k)).filter(Boolean) : []
  }
  const resolveKey = (k: string): TeamRow | undefined => {
    const direct = byKey.get(k)
    if (direct) return direct
    const tail = k.includes(':') ? k.slice(k.lastIndexOf(':') + 1) : null
    return tail ? byKey.get(tail) : undefined
  }

  /*
   * A key that resolves to nothing is usually an AllFantasy user id for a
   * manager whose team row was never claimed. The profile's linked Sleeper id
   * is the persisted reverse lookup the ingest used to mint that key, so it is
   * read back the same way — one query, only when something is unresolved.
   */
  const unresolved = new Set<string>()
  for (const r of rows) for (const k of keysOf(r.normalized)) if (!resolveKey(k)) unresolved.add(k)
  if (unresolved.size > 0) {
    const profiles = await prisma.userProfile
      .findMany({ where: { userId: { in: [...unresolved] } }, select: { userId: true, sleeperUserId: true } })
      .catch(() => [] as Array<{ userId: string; sleeperUserId: string | null }>)
    for (const p of profiles) {
      const t = p.sleeperUserId ? byKey.get(p.sleeperUserId) : undefined
      if (t) byKey.set(p.userId, t)
    }
  }

  const stats = new Map<string, { times: Date[]; last: { at: Date; kind: MoveKind } | null }>()
  let unattributed = 0
  for (const r of rows) {
    if (!isMoveKind(r.activityType)) continue
    const hit = new Set<TeamRow>()
    for (const k of keysOf(r.normalized)) {
      const t = resolveKey(k)
      if (t) hit.add(t)
    }
    if (hit.size === 0) {
      unattributed += 1
      continue
    }
    for (const t of hit) {
      const s = stats.get(t.externalId) ?? { times: [], last: null }
      s.times.push(r.occurredAt)
      if (!s.last || r.occurredAt > s.last.at) s.last = { at: r.occurredAt, kind: r.activityType }
      stats.set(t.externalId, s)
    }
  }

  const timeZone = league.timezone?.trim() || DEFAULT_TIME_ZONE
  const zone = zoneLabel(timeZone)

  const manager = (t: TeamRow, role: PresenceManager['role'], extra: Pick<PresenceManager, 'need' | 'startsHim'>): PresenceManager => {
    const s = stats.get(t.externalId)
    return {
      role,
      teamName: t.teamName,
      ownerName: t.ownerName,
      avatarUrl: t.avatarUrl ?? null,
      externalId: t.externalId,
      record: recordOf(t),
      rank: t.currentRank ?? null,
      window: s ? activityWindow(s.times, timeZone) : null,
      lastMove: s?.last ? { at: s.last.at.toISOString(), kind: s.last.kind } : null,
      moves: s?.times.length ?? 0,
      ...extra,
    }
  }

  /* ── Position, for the need ─────────────────────────────────────────── */
  let position = opts.position ? normalizePosition(opts.position) || null : null
  if (!position) {
    const row = await prisma.sportsPlayer
      .findFirst({ where: { sleeperId }, select: { position: true } })
      .catch(() => null)
    position = row?.position ? normalizePosition(row.position) || null : null
  }

  const base = {
    leagueId: league.id,
    leagueName: leagueDisplayName(league.name),
    platform,
    platformLeagueId: league.platformLeagueId ?? null,
    season: league.season ?? null,
    timeZone,
    zone,
    player: { sleeperId, position },
    activityIngested: rows.length > 0,
    newestMove: rows[0]?.occurredAt ? rows[0].occurredAt.toISOString() : null,
    unattributed,
  }

  if (!holderIsYou) {
    const owner = teamOfRoster(holder.platformUserId)
    if (!owner) return { available: false, reason: 'the roster that holds him has no team row we can name' }
    const startsHim = asIds(((holder.playerData ?? {}) as Record<string, unknown>).starters).includes(sleeperId)
    return { available: true, data: { ...base, holder: 'other', managers: [manager(owner, 'owner', { need: null, startsHim })] } }
  }

  /*
   * He is yours: who would want him. Every roster's count at his position
   * against the league's dedicated slots for it — a manager with one TE for
   * one TE slot is thin, and the pitch goes there first.
   */
  if (!position) return { available: true, data: { ...base, holder: 'yours', managers: [] } }

  const settings = (league.settings ?? {}) as Record<string, unknown>
  const slots = Array.isArray(settings.roster_positions) ? settings.roster_positions.map((s) => normalizePosition(String(s))) : []
  const starters = slots.filter((s) => s === position).length

  const ids = [...new Set(rosters.flatMap((r) => allIds((r.playerData ?? {}) as Record<string, unknown>)))]
  const posRows = ids.length
    ? await prisma.sportsPlayer
        .findMany({ where: { sleeperId: { in: ids } }, select: { sleeperId: true, position: true }, distinct: ['sleeperId'] })
        .catch(() => [] as Array<{ sleeperId: string | null; position: string | null }>)
    : []
  const posOf = new Map(posRows.filter((r) => r.sleeperId).map((r) => [r.sleeperId as string, r.position ? normalizePosition(r.position) : null]))

  const buyers = rosters
    .filter((r) => !yourIds.has(r.platformUserId))
    .flatMap((r) => {
      const t = teamOfRoster(r.platformUserId)
      if (!t) return []
      const held = allIds((r.playerData ?? {}) as Record<string, unknown>).filter((id) => posOf.get(id) === position).length
      return [{ t, need: { position, held, starters, level: needLevel(held, starters) } satisfies PresenceNeed }]
    })
    .sort((a, b) => a.need.held - a.need.starters - (b.need.held - b.need.starters) || b.t.wins - a.t.wins || b.t.pointsFor - a.t.pointsFor)
    .slice(0, MAX_BUYERS)
    .map(({ t, need }) => manager(t, 'buyer', { need, startsHim: null }))

  return { available: true, data: { ...base, holder: 'yours', managers: buyers } }
}
