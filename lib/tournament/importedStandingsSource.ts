/**
 * Records for a tournament league that lives on ANOTHER platform.
 *
 * 🛑 THE ENGINE WAS WIRED TO THE WRONG SOURCE, WHICH IS WHY A COMMISSIONER
 * RECOMPUTES BY HAND FOR HOURS A WEEK. `calculateLeagueStandings` reads
 * `RedraftRoster` — AllFantasy-native leagues only — and for an imported league
 * falls through to whatever is already stored on `TournamentLeagueParticipant`.
 * Nothing refreshes those, so an imported tournament recomputes its standings
 * from its own stale copy and reports no movement, which is indistinguishable
 * from a week where nobody played.
 *
 * A Sleeper import already writes the real numbers: `lib/league/sleeper-import-process.ts`
 * and `lib/sleeper-sync.ts` both upsert `LeagueTeam.wins/losses/ties/pointsFor/pointsAgainst`,
 * and `LeagueTeam` is indexed on `[leagueId, pointsFor]`. This module is the
 * missing read.
 *
 * ⚠ NOTHING HERE WRITES, AND NOTHING HERE REACHES A PROVIDER. It reads the rows
 * the importer already committed, so it is a DB-first read by construction — the
 * freshness of the answer is the freshness of the last sync, and the caller is
 * told which that was rather than left to assume "now".
 */
import 'server-only'
import { prisma } from '@/lib/prisma'

export type ImportedTeamRecord = {
  /** `LeagueTeam.externalId` — the platform's roster id. Unique per league. */
  externalId: string
  /** The platform's user id (Sleeper `owner_id`), when the import captured one. */
  platformUserId: string | null
  ownerName: string
  teamName: string
  /**
   * The AllFantasy account that claimed this team, when there is one.
   *
   * 🛑 MOST MANAGERS IN AN IMPORTED TOURNAMENT HAVE NO ACCOUNT. KBI has ~240
   * managers on Sleeper and only some have signed up here — so this is the field
   * that decides whether a broadcast can REACH someone or only be handed to the
   * commissioner to paste. Treating a null as "notify anyway" sends nothing to
   * nobody and reports success.
   */
  claimedByUserId: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  /** When the importer last touched this row — the real age of these numbers. */
  lastUpdatedAt: Date
}

export type ImportedLeagueRecords = {
  leagueId: string
  rows: ImportedTeamRecord[]
  /**
   * The OLDEST `lastUpdatedAt` across the league, not the newest.
   *
   * ⚠ A LEAGUE IS AS STALE AS ITS STALEST TEAM. Reporting the newest would let
   * one re-synced row present the whole league as current, and a standings table
   * that is right about eleven teams and wrong about one is worse than one that
   * says so — the wrong team is the one that gets eliminated by mistake.
   */
  oldestUpdatedAt: Date | null
}

/**
 * Every team row an import committed for this league.
 *
 * Returns an empty `rows` for a league with no teams rather than throwing: a
 * tournament league that has been created but not yet imported is an ordinary
 * state during setup, not a failure.
 */
export async function readImportedLeagueRecords(leagueId: string): Promise<ImportedLeagueRecords> {
  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId },
    select: {
      externalId: true,
      platformUserId: true,
      ownerName: true,
      teamName: true,
      claimedByUserId: true,
      wins: true,
      losses: true,
      ties: true,
      pointsFor: true,
      pointsAgainst: true,
      lastUpdatedAt: true,
    },
    orderBy: { pointsFor: 'desc' },
  })

  const rows: ImportedTeamRecord[] = teams.map((t) => ({
    externalId: t.externalId,
    platformUserId: t.platformUserId ?? null,
    ownerName: t.ownerName ?? '',
    teamName: t.teamName ?? '',
    claimedByUserId: t.claimedByUserId ?? null,
    wins: t.wins ?? 0,
    losses: t.losses ?? 0,
    ties: t.ties ?? 0,
    pointsFor: t.pointsFor ?? 0,
    pointsAgainst: t.pointsAgainst ?? 0,
    lastUpdatedAt: t.lastUpdatedAt,
  }))

  const oldestUpdatedAt = rows.reduce<Date | null>(
    (oldest, r) => (oldest == null || r.lastUpdatedAt < oldest ? r.lastUpdatedAt : oldest),
    null,
  )

  return { leagueId, rows, oldestUpdatedAt }
}

/**
 * Loose name comparison, for the fallback match only.
 *
 * ⚠ CASE AND SPACING ONLY — deliberately not fuzzy. A tournament match decides
 * whose season ends, and a near-miss ("TyT1" vs "TyT11") is two different
 * managers in a 240-person field. An unmatched participant is reported as
 * unmatched; it is never guessed at.
 */
function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export type ParticipantLike = {
  /** For an imported tournament this holds the PLATFORM user id, not an AppUser id. */
  userId: string
  displayName?: string | null
}

/**
 * The identity a commissioner's hand-link writes.
 *
 * 🛑 NOT EVERY TEAM ROW HAS A PLATFORM USER ID. `LeagueTeam.platformUserId` is
 * nullable — orphan teams have none, and older imports did not always capture
 * one — so a link that could only be expressed as "this manager is that Sleeper
 * user" would be unable to fix precisely the rows most likely to need fixing.
 *
 * `externalId` is never null, so a link falls back to naming the TEAM. The
 * result is deterministic (the same team always produces the same id), unique
 * within a tournament (which is what `@@unique([tournamentId, userId])` needs),
 * and reversible — it is a pointer, not a rename.
 *
 * ⚠ IT MUST NOT COLLIDE WITH A REAL PLATFORM ID. The `team:` prefix and the
 * embedded league id make that impossible in practice, and a collision would
 * silently hand one manager another's season.
 */
export function teamIdentity(leagueId: string, externalId: string): string {
  return `team:${leagueId}:${externalId}`
}

/** Parse a `teamIdentity`, or null for anything that is a real platform id. */
export function parseTeamIdentity(userId: string): { leagueId: string; externalId: string } | null {
  if (!userId.startsWith('team:')) return null
  const rest = userId.slice('team:'.length)
  /* The league id comes first and cannot contain a colon; an external id can. */
  const cut = rest.indexOf(':')
  if (cut <= 0 || cut === rest.length - 1) return null
  return { leagueId: rest.slice(0, cut), externalId: rest.slice(cut + 1) }
}

export type RecordMatch = {
  participant: ParticipantLike
  record: ImportedTeamRecord | null
  /**
   * How it was matched, so a commissioner can see which links are inferred.
   *
   * ⚠ `commissionerLink` IS REPORTED SEPARATELY FROM `platformUserId` even
   * though both are exact. One is what the platform says; the other is what a
   * human asserted because the platform was wrong or silent. A screen that
   * cannot tell them apart cannot show which links were reviewed.
   */
  matchedBy: 'commissionerLink' | 'platformUserId' | 'ownerName' | 'teamName' | null
}

/**
 * Join the tournament's participants to the imported team rows.
 *
 * 🛑 `TournamentParticipant.userId` IS A BARE STRING WITH NO FOREIGN KEY, which
 * is what makes an imported tournament representable at all: KBI has ~240
 * managers and most have never signed up for AllFantasy, so requiring an
 * `AppUser` would exclude the field this feature exists to serve. For an
 * imported tournament that column holds the Sleeper `owner_id`, which is exactly
 * what `LeagueTeam.platformUserId` stores.
 *
 * ⚠ THE NAME FALLBACKS ARE A FALLBACK, NOT A PEER. `platformUserId` is an
 * identity; a display name is a label the manager can change mid-season. Name
 * matching exists because older imports did not always capture the owner id —
 * and every name match is reported as such so it can be reviewed rather than
 * trusted silently.
 *
 * ⚠ ONE RECORD IS CLAIMED ONCE. Two participants matching the same team row
 * would each be credited with that team's points, which inflates a conference
 * total and can advance a manager over someone who really outscored them.
 */
export function matchParticipantsToRecords(
  participants: ParticipantLike[],
  records: ImportedTeamRecord[],
): RecordMatch[] {
  const byPlatformId = new Map<string, ImportedTeamRecord>()
  const byOwnerName = new Map<string, ImportedTeamRecord>()
  const byTeamName = new Map<string, ImportedTeamRecord>()
  for (const r of records) {
    if (r.platformUserId) byPlatformId.set(r.platformUserId, r)
    const owner = normalizeName(r.ownerName)
    const team = normalizeName(r.teamName)
    /* First writer wins on a duplicate name: a second row under the same label
       is ambiguous, and picking the later one is not more correct than the
       earlier. Both stay unmatched-by-name if the id route also misses. */
    if (owner && !byOwnerName.has(owner)) byOwnerName.set(owner, r)
    if (team && !byTeamName.has(team)) byTeamName.set(team, r)
  }

  const claimed = new Set<string>()
  const out: RecordMatch[] = []

  const take = (
    r: ImportedTeamRecord | undefined,
    how: RecordMatch['matchedBy'],
  ): { record: ImportedTeamRecord; matchedBy: RecordMatch['matchedBy'] } | null => {
    if (!r || claimed.has(r.externalId)) return null
    claimed.add(r.externalId)
    return { record: r, matchedBy: how }
  }

  /*
   * Two passes, and the order is the point: every id match is settled before any
   * name match is attempted. Interleaving them lets a participant with a stale
   * display name claim by name the row that another participant would have
   * claimed by id — the id match then fails and the WRONG manager is credited.
   */
  const byExternalId = new Map(records.map((r) => [r.externalId, r]))

  const pending: Array<{ p: ParticipantLike; hit: ReturnType<typeof take> }> = []
  for (const p of participants) {
    /*
     * A commissioner's explicit link wins over everything, including a platform
     * id — it is the one signal a human asserted on purpose, and the reason it
     * exists is that the automatic routes got that manager wrong.
     */
    const linked = parseTeamIdentity(p.userId)
    const hit = linked
      ? take(byExternalId.get(linked.externalId), 'commissionerLink')
      : take(byPlatformId.get(p.userId), 'platformUserId')
    pending.push({ p, hit })
  }
  for (const entry of pending) {
    if (entry.hit) continue
    const name = normalizeName(entry.p.displayName ?? '')
    if (!name) continue
    entry.hit = take(byOwnerName.get(name), 'ownerName') ?? take(byTeamName.get(name), 'teamName')
  }

  for (const entry of pending) {
    out.push({
      participant: entry.p,
      record: entry.hit?.record ?? null,
      matchedBy: entry.hit?.matchedBy ?? null,
    })
  }
  return out
}
