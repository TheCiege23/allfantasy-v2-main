/**
 * The other half of this league's franchise, for the league home.
 *
 * 🛑 THE ASK WAS "THE 2 LEAGUES NEED TO FEEL LIKE ITS ONE AND BE SHOWN ON 1
 * SCREEN" — click the NFL league and see NFL first with C2C beneath, and the
 * reverse from the other side. Everything needed for that already existed and
 * nothing joined it up:
 *
 *   FranchiseLink / FranchiseLeagueMember   models the pair, roles pro+college
 *   loadFranchiseDetail                     renders BOTH halves as one team
 *   /api/legacy/franchise                   serves it
 *
 * What was missing: no action could attach the pro side (see
 * `lib/franchise/pairableLeagues.ts`), and no screen ever asked. So the pairing
 * could not be created, and would not have been shown if it had been.
 *
 * ⚠ THIS RESOLVES BY LEAGUE, NOT BY FRANCHISE, and that is the whole reason it
 * is a separate module from `franchiseService`. The league home knows one
 * league id and has no idea whether it is the pro or the college half — so the
 * lookup has to run in both directions and report which side the viewer is
 * standing on. `loadFranchiseDetail` takes a linkId, which the league home does
 * not have.
 *
 * ⚠ AND IT RESOLVES THROUGH TWO ID SPACES. `FranchiseLeagueMember.leagueId`
 * holds `League.id` for the pro side and `FantraxLeague.id` for the college
 * side — the schema says so in its own comment. A Fantrax league reached from
 * the league home arrives as a `League` row whose `platformLeagueId` IS that
 * snapshot uuid, so finding its membership means looking up the snapshot id, not
 * the League id. Searching only one space makes a correctly paired Fantrax
 * league report itself unpaired.
 */
import 'server-only'
import { connectedRosterPlayers, type ConnectedRosterPlayer } from './connectedRoster'
import { prisma } from '@/lib/prisma'
import { getDraftHqAll } from './draftHqAll'
import { getLeagueActivity } from './leagueActivity'
import type { FranchiseRole } from '@/lib/franchise/franchiseLink'

/** One half of a franchise, described identically whichever half it is. */
export type FranchiseSide = {
  memberId: string
  role: FranchiseRole
  players?: ConnectedRosterPlayer[]
  sport?: string
  platform: string
  /** Route target, when it is a League we can link to. */
  leagueId: string | null
  /** ID stored on FranchiseLeagueMember; Fantrax uses its snapshot ID here. */
  memberLeagueId: string
  name: string
  season: number | null
  teamLabel: string | null
  /** Provider teams the owner can explicitly map to this franchise member. */
  teamCandidates: Array<{ id: string; label: string }>
  /**
   * That half's team crest.
   *
   * ⚠ NULL MEANS TWO DIFFERENT THINGS AND THE PANEL RENDERS BOTH THE SAME WAY,
   * because the reader does not care which. Measured 2026-08-31: all 12 teams in
   * the paired Sleeper league carry a `sleepercdn.com` avatar, while the Fantrax
   * half can never carry one — Fantrax publishes no image field anywhere in its
   * API, and that was checked rather than assumed (`teamInfo` entries are exactly
   * `{name, id}`, across 269KB of `getLeagueInfo`, with zero image-ish keys in
   * `getStandings` or `getTeamRosters` either).
   *
   * So a Fantrax crest falls back to initials — the same fallback a Sleeper team
   * whose manager never set an avatar already gets everywhere else in the app.
   * Inventing a logo for it would be fabricating data the platform does not have.
   */
  avatarUrl: string | null
  /** Roster size, or null when that half's roster cannot be read. */
  playerCount: number | null
  unavailableReason: string | null
  /**
   * That half's draft, when one is on file.
   *
   * ⚠ READ THROUGH `getDraftHqAll`, THE SAME AGGREGATOR THE LEAGUE HOME USES.
   * Writing a second draft query here is how one screen comes to say "draft has
   * ended" while the panel beside it says "no draft on file" about the same
   * league. Null means no draft row — which for a Fantrax half is the ordinary
   * case, since the snapshot import captures no draft at all.
   */
  draft: { phase: string; headline: string; detail: string | null; href: string | null } | null
  /**
   * Trades, waivers and roster moves for that half.
   *
   * ⚠ `available: false` CARRIES A REASON, BECAUSE "NO TRADES" AND "WE CANNOT
   * READ TRADES" ARE DIFFERENT CLAIMS ABOUT A LEAGUE. Fantrax publishes no
   * transactions endpoint at all — the word does not appear in its
   * documentation, as `fantraxApi.ts` records — so a Fantrax half has zero rows
   * for a reason that has nothing to do with how active the league is. Rendering
   * that as "0 trades" would be a statement about the manager rather than about
   * our data.
   */
  activity:
    | { available: true; trades: number; waivers: number; rosterMoves: number; newest: Date | null }
    | { available: false; reason: string }
    | null
  sync: {
    lastSyncedAt: Date | null
    stale: boolean
    refreshHref: string | null
    detail: string
  }
}

export type PairedHalf = {
  linkId: string
  franchiseName: string
  primaryMemberId: string | null
  /** Which half the league being viewed is. */
  viewingRole: FranchiseRole
  /**
   * The league being VIEWED, described the same way as the other half.
   *
   * ⚠ THIS IS WHAT MAKES THE ORDER RIGHT. The panel renders `self` first and
   * `other` second, so the pro league leads on the pro page and the college
   * league leads on the college page — neither reads as the primary with the
   * other as an afterthought. Null only if the membership row went missing
   * between the two reads.
   */
  self: FranchiseSide | null
  /** The other half. Null when the franchise only has one side attached. */
  other: FranchiseSide | null
  /**
   * Every readable league in the connected franchise, with the league being
   * viewed first. `self` and `other` remain for older consumers, while new
   * surfaces use this collection so tournament and specialty hubs are not
   * silently reduced to two leagues.
   */
  sides: FranchiseSide[]
}

/**
 * The (platform, leagueId) pair that identifies this league to the franchise
 * tables — which is NOT always the League row's own id.
 */
async function membershipKeyFor(
  leagueId: string,
): Promise<{ platform: string; memberLeagueId: string } | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, platform: true, platformLeagueId: true },
  })
  if (!league) return null
  const platform = String(league.platform ?? '').toLowerCase()
  /*
   * ⚠ FANTRAX IS STORED UNDER THE SNAPSHOT ID. `importFantraxLeague` writes a
   * `FantraxLeague` row and the League's `platformLeagueId` is that row's uuid;
   * `attachToFranchise` is called with the snapshot id. Using `League.id` here
   * finds nothing and the league reports itself unpaired while it is paired.
   */
  if (platform === 'fantrax' && league.platformLeagueId) {
    return { platform, memberLeagueId: league.platformLeagueId }
  }
  return { platform, memberLeagueId: league.id }
}

/**
 * Resolve the franchise this league belongs to, and its other half.
 *
 * Returns null when the league is in no franchise — which is the ordinary case
 * and not an error. The caller decides whether to offer pairing.
 */
export async function resolvePairedHalf(
  leagueId: string,
  ownerUserId: string,
  options?: { includeOperationalSummary?: boolean },
): Promise<PairedHalf | null> {
  const includeOperationalSummary = options?.includeOperationalSummary ?? true
  const key = await membershipKeyFor(leagueId)
  if (!key) return null

  // Legacy imports may retain the snapshot ID, mirror ID, or provider ID.
  const aliases = new Set([leagueId, key.memberLeagueId])
  if (key.platform === 'fantrax') {
    const snapshots = await prisma.fantraxLeague.findMany({
      where: { appUserId: ownerUserId, OR: [{ id: key.memberLeagueId }, { sourceLeagueId: key.memberLeagueId }] },
      select: { id: true, sourceLeagueId: true },
    })
    for (const snapshot of snapshots) {
      aliases.add(snapshot.id)
      if (snapshot.sourceLeagueId) aliases.add(snapshot.sourceLeagueId)
    }
  }

  const membership = await prisma.franchiseLeagueMember.findFirst({
    where: {
      platform: key.platform,
      leagueId: { in: [...aliases] },
      /* Gated on ownership like every other franchise read — a franchise says
         which teams belong to someone. */
      link: { ownerUserId },
    },
    select: {
      role: true,
      link: { select: { id: true, name: true, primaryMemberId: true, members: true } },
    },
  })
  if (!membership?.link) return null

  const viewingRole = membership.role as FranchiseRole
  const selfMember = membership.link.members.find(
    (m) => m.platform === key.platform && aliases.has(m.leagueId),
  )
  const otherMembers = membership.link.members.filter(
    (m) => !(m.platform === key.platform && aliases.has(m.leagueId)),
  )

  const base = {
    linkId: membership.link.id,
    franchiseName: membership.link.name,
    primaryMemberId: membership.link.primaryMemberId,
    viewingRole,
  }

  /*
   * ⚠ ONE DESCRIBER FOR BOTH HALVES, NOT TWO.
   *
   * The panel used to render only the OTHER league, so only the other league was
   * ever resolved. Showing both — with the one you are standing in first — needs
   * the same summary for each, and writing that twice is how the two sides drift
   * into disagreeing about what "your roster" means. The Fantrax and League
   * branches below differ because the STORAGE differs (a snapshot's resolved
   * array vs a `Roster` row), not because the halves do.
   */
  const describeSide = async (member: {
    id: string
    role: string
    platform: string
    leagueId: string
    teamExternalId: string | null
  }): Promise<FranchiseSide> => {
    const platform = String(member.platform ?? '').toLowerCase()
    const role = member.role as FranchiseRole

    if (platform === 'fantrax') {
      const snap = await prisma.fantraxLeague.findUnique({
        where: { id: member.leagueId },
        select: { id: true, leagueName: true, season: true, userTeam: true, roster: true, sport: true, sourceLeagueId: true, updatedAt: true },
      })
      /*
       * The League row that mirrors this snapshot, so the side is clickable.
       * Null is fine — the panel still names the league, it just does not link.
       */
      const mirror = snap
        ? await prisma.league.findFirst({
            where: { platform: 'fantrax', userId: ownerUserId, OR: [{ id: member.leagueId }, { platformLeagueId: snap.id }, ...(snap.sourceLeagueId ? [{ platformLeagueId: snap.sourceLeagueId }] : [])] },
            select: { id: true },
          })
        : null
      /*
       * 🛑 `FantraxLeague.roster` IS THE WHOLE LEAGUE, NOT YOUR TEAM.
       *
       * Measured on production: 466 entries across 12 distinct `teamName`
       * values, ~39 per manager. Counting the array reported "466 players on
       * your roster" — a number no fantasy team can have, and the kind of wrong
       * that reads as a broken feature rather than a miscount. Each entry
       * carries `teamName`; `userTeam` names which of them is the viewer's.
       *
       * ⚠ AN EMPTY FILTER IS NOT AN EMPTY ROSTER. If `userTeam` matches nothing
       * — a rename on Fantrax's side, or a snapshot taken before the team was
       * identified — that is a gap we cannot see past, so it reports a reason
       * rather than "0 players", which would claim the viewer rosters nobody.
       */
      const allRows = Array.isArray(snap?.roster) ? (snap?.roster as unknown[]) : null
      const teamNames = Array.from(
        new Set(
          (allRows ?? [])
            .map((row) => {
              const value = (row as { teamName?: unknown })?.teamName
              return typeof value === 'string' ? value.trim() : ''
            })
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b))
      const requestedTeam = String(member.teamExternalId ?? snap?.userTeam ?? '').trim()
      const selectedTeam = teamNames.find((name) => name.toLowerCase() === requestedTeam.toLowerCase()) ?? requestedTeam
      const userTeam = selectedTeam.toLowerCase()
      const teamOf = (r: unknown): string => {
        const t = (r as { teamName?: unknown })?.teamName
        return typeof t === 'string' ? t.trim().toLowerCase() : ''
      }
      /*
       * ⚠ ONLY FILTER WHEN THE ROWS ACTUALLY CARRY A TEAM. Two snapshot shapes
       * exist: the current one stores the WHOLE league and tags each row with
       * `teamName` (466 rows over 12 teams on production), while older ones store
       * the viewer's roster alone with no team on it. Filtering the second shape
       * matches nothing and would report a manager who owns nobody — turning a
       * correct count into a false gap. If no row names a team, the array is
       * already the team.
       */
      const rowsCarryTeams = allRows?.some((r) => teamOf(r) !== '') ?? false
      const mine =
        allRows == null
          ? null
          : !rowsCarryTeams
            ? allRows
            : userTeam
              ? allRows.filter((r) => teamOf(r) === userTeam)
              : null
      const claimedTeam = mirror ? await prisma.leagueTeam.findFirst({
        where: { leagueId: mirror.id, claimedByUserId: ownerUserId },
        select: { avatarUrl: true },
      }) : null
      return {
        memberId: member.id,
        role,
        platform,
        leagueId: mirror?.id ?? null,
        memberLeagueId: member.leagueId,
        sport: snap?.sport ?? 'NCAAF',
        players: mine ? await connectedRosterPlayers(platform, snap?.sport ?? 'NCAAF', mine).catch(() => []) : [],
        name: snap?.leagueName ?? 'Fantrax league',
        season: snap?.season ?? null,
        teamLabel: selectedTeam || null,
        teamCandidates: teamNames.map((name) => ({ id: name, label: name })),
        /* Not a gap to be filled later: Fantrax publishes no image field at all,
           so this half renders initials. See the type for the measurement. */
        avatarUrl: claimedTeam?.avatarUrl ?? null,
        playerCount: mine && mine.length > 0 ? mine.length : null,
        draft: null,
        /*
         * Stated as a PLATFORM limit, not as an empty league. Measured on
         * production: this half has 0 activity rows while its paired Sleeper
         * half has 181 — the gap is the vendor's API, not the manager.
         */
        activity: includeOperationalSummary
          ? {
              available: false,
              reason: 'Fantrax publishes no transactions endpoint, so trades and waivers cannot be read',
            }
          : null,
        unavailableReason:
          snap == null
            ? 'the linked Fantrax league no longer exists'
            : allRows == null
              ? 'this Fantrax snapshot holds no roster — re-run the import'
              : rowsCarryTeams && !userTeam
                ? 'this Fantrax snapshot does not record which team is yours — re-run the import'
                : mine && mine.length > 0
                  ? null
                : `no players are filed under “${selectedTeam || 'your selected team'}” in this snapshot — choose the correct team or re-run the import`,
        sync: {
          lastSyncedAt: snap?.updatedAt ?? null,
          stale: !snap?.updatedAt || Date.now() - snap.updatedAt.getTime() > 24 * 60 * 60 * 1000,
          refreshHref: snap?.sourceLeagueId
            ? `/import?provider=fantrax&leagueId=${encodeURIComponent(snap.sourceLeagueId)}&returnTo=${encodeURIComponent(`/core/war-room?league=${mirror?.id ?? leagueId}`)}`
            : '/import?provider=fantrax',
          detail: snap?.sourceLeagueId
            ? 'Fantrax is a stored snapshot. Re-import to pull the newest roster and standings.'
            : 'This CSV-era snapshot has no saved Fantrax league ID. Upload a new export to refresh it.',
        },
      }
    }

    const lg = await prisma.league.findUnique({
      where: { id: member.leagueId },
      /* platformLeagueId is required by getLeagueActivity — imported rows are
         keyed on the PROVIDER league id, not ours. */
      select: { id: true, name: true, season: true, platformLeagueId: true, sport: true, lastSyncedAt: true },
    })
    /*
     * ⚠ THE ROSTER COUNT IS READ FROM THE CLAIMED TEAM, NOT FROM THE LEAGUE. A
     * league-wide count would report every manager's players as yours.
     */
    const teams = lg
      ? await prisma.leagueTeam.findMany({
          where: { leagueId: lg.id },
          select: {
            teamName: true,
            ownerName: true,
            externalId: true,
            platformUserId: true,
            avatarUrl: true,
            claimedByUserId: true,
          },
          orderBy: { teamName: 'asc' },
        })
      : []
    /* An explicit hub mapping wins. The claimed team remains the automatic
       default, so existing connections need no setup step. */
    const team =
      teams.find((candidate) => candidate.externalId === member.teamExternalId) ??
      teams.find((candidate) => candidate.claimedByUserId === ownerUserId) ??
      null
    /*
     * ⚠ `Roster.platformUserId` CARRIES TWO ID SPACES, AND THE VIEWER'S OWN TEAM
     * IS THE ONE THAT USES THE OTHER ONE.
     *
     * For managers we only imported it holds the PLATFORM user id, which is what
     * `LeagueTeam.platformUserId` also holds — so the join works for all of them.
     * For the team the viewer has CLAIMED it holds the AllFantasy `AppUser.id`,
     * which is how the rest of the app reads a viewer's own roster
     * (`leagueSync.ts`, the waiver and Chimmy paths all query
     * `{ leagueId, platformUserId: userId }`).
     *
     * Measured on production: of 12 teams in the paired Sleeper league, 11 keys
     * matched and exactly one did not — the viewer's. Reading only the team's key
     * therefore fails for precisely the roster this panel exists to show, and
     * renders as "no roster on file", which reads as broken ingestion rather than
     * a missed join.
     *
     * The viewer key is tried only when this is still their claimed team. An
     * explicit franchise mapping may point at another provider team, in which
     * case its provider/external keys must win or the old roster can leak back
     * into the newly selected identity.
     */
    const rosterKeys = [
      team?.claimedByUserId === ownerUserId ? ownerUserId : null,
      team?.platformUserId,
      team?.externalId,
    ].filter(
      (k): k is string => typeof k === 'string' && k.length > 0,
    )
    const roster =
      lg && team && rosterKeys.length > 0
        ? await prisma.roster
            .findFirst({
              where: { leagueId: lg.id, platformUserId: { in: rosterKeys } },
              select: { playerData: true },
            })
            .catch(() => null)
        : null
    const players = (() => {
      const data = roster?.playerData as { players?: unknown[] } | null | undefined
      return Array.isArray(data?.players) ? data.players.length : null
    })()

    return {
      memberId: member.id,
      role,
      platform,
      leagueId: lg?.id ?? null,
      memberLeagueId: member.leagueId,
      sport: lg?.sport ?? 'NFL',
      players: roster ? await connectedRosterPlayers(platform, lg?.sport ?? 'NFL', (roster.playerData as { players?: unknown[] })?.players ?? []).catch(() => []) : [],
      name: lg?.name?.trim() || 'League',
      season: lg?.season ?? null,
      teamLabel: team?.teamName?.trim() || team?.ownerName?.trim() || member.teamExternalId,
      teamCandidates: teams.map((candidate) => ({
        id: candidate.externalId,
        label: candidate.teamName?.trim() || candidate.ownerName?.trim() || candidate.externalId,
      })),
      /* The claimed team by default, or the team explicitly selected for this
         franchise member in the command center. */
      avatarUrl: team?.avatarUrl?.trim() || null,
      playerCount: players,
      draft: null,
      activity: includeOperationalSummary && lg
        ? await getLeagueActivity({
            leagueId: lg.id,
            platformLeagueId: lg.platformLeagueId ?? null,
            limit: 1,
          })
            .then((a) =>
              a
                ? ({
                    available: true as const,
                    trades: a.counts.trade,
                    waivers: a.counts.waiver,
                    rosterMoves: a.counts.rosterMove,
                    newest: a.newest,
                  })
                : ({ available: false as const, reason: 'no transactions are on file for this league' }),
            )
            .catch(() => ({ available: false as const, reason: 'we could not read the transactions for this league' }))
        : null,
      unavailableReason:
        lg == null
          ? 'the linked league no longer exists'
          : players == null
            ? 'no roster is on file for your team'
            : null,
      sync: {
        lastSyncedAt: lg?.lastSyncedAt ?? null,
        stale: !lg?.lastSyncedAt || Date.now() - lg.lastSyncedAt.getTime() > 24 * 60 * 60 * 1000,
        refreshHref: lg?.id ? `/core/sync?league=${encodeURIComponent(lg.id)}` : null,
        detail: 'League data refreshes through its connected provider.',
      },
    }
  }

  /*
   * ⚠ `self` IS RESOLVED EVEN THOUGH THE VIEWER IS STANDING IN IT. The panel puts
   * the league you are on FIRST and the connected half second, so on the pro
   * league the pro side leads and on the college league the college side does.
   * That ordering is only possible if both sides carry the same summary — the
   * viewed league's own roster count included.
   */
  const self = selfMember ? await describeSide(selfMember) : null
  const describedOthers = await Promise.all(otherMembers.map((member) => describeSide(member)))
  const other = describedOthers[0] ?? null
  const sides = [self, ...describedOthers].filter((side): side is FranchiseSide => side != null)

  /*
   * ⚠ ONE LOOKUP FOR BOTH HALVES, AFTER THEY ARE RESOLVED. `getDraftHqAll` takes
   * a LIST, so asking it once for both leagues costs one round trip rather than
   * two — and, more importantly, both halves are then described by the same call,
   * so they cannot disagree about a draft the way two separate queries could.
   *
   * ⚠ A FANTRAX HALF USUALLY HAS NO ROW, AND THAT IS NOT AN ERROR. The snapshot
   * import captures no draft, so `draft` stays null and the panel simply says
   * nothing rather than claiming the league never drafted.
   */
  const draftIds = Array.from(
    new Set(sides.map((side) => side.leagueId).filter((id): id is string => typeof id === 'string')),
  )
  if (includeOperationalSummary && draftIds.length > 0) {
    const draftAll = await getDraftHqAll(
      ownerUserId,
      draftIds.map((id) => ({ id })),
    ).catch(() => null)
    const byLeague = new Map((draftAll?.rows ?? []).map((r) => [r.leagueId, r]))
    for (const side of sides) {
      if (!side?.leagueId) continue
      const row = byLeague.get(side.leagueId)
      if (!row) continue
      side.draft = {
        phase: row.phase,
        headline:
          row.phase === 'live'
            ? 'Draft is live'
            : row.phase === 'done'
              ? /* The season is the useful half — "draft complete" on a dynasty
                   league says nothing about WHICH draft. Same reasoning the
                   league home applies to the identical string. */
                `${side.season ?? ''} draft has ended`.trim()
              : row.phase === 'unknown'
                ? row.rawStatus
                : 'Draft not started',
        detail:
          [
            row.rounds != null ? `${row.rounds} rounds` : null,
            row.draftType,
            row.yourSlot != null ? `you pick ${row.yourSlot}` : null,
            row.picksMade != null
              ? `${row.picksMade} ${row.picksMade === 1 ? 'pick' : 'picks'} recorded`
              : null,
          ]
            .filter(Boolean)
            .join(' · ') || null,
        href: `/core/draft-hq?league=${encodeURIComponent(side.leagueId)}`,
      }
    }
  }

  /*
   * 🛑 NO DRAFT ROW ON A LEAGUE WITH FULL ROSTERS IS A GAP IN OUR DATA, NOT A
   * FACT ABOUT THE LEAGUE.
   *
   * `getDraftHqAll` returns nothing for either half here — measured on
   * production, both Peach Bowl and Cream Bowl — because no DraftSession was
   * ingested. Rendering silence would imply there was no draft, while the league
   * home one panel down already says "…draft has ended · rosters are populated,
   * so this league drafted, but we did not capture the board itself". Saying two
   * different things about one league on one screen is the failure; this mirrors
   * the wording rather than inventing a second story.
   *
   * ⚠ GATED ON A ROSTER WE ACTUALLY READ. `playerCount` is null exactly when the
   * roster could not be read, and inferring a draft from a roster we never saw
   * would be a guess dressed as a finding.
   */
  for (const side of includeOperationalSummary ? sides : []) {
    if (!side || side.draft || side.unavailableReason) continue
    if ((side.playerCount ?? 0) <= 0) continue
    side.draft = {
      phase: 'done',
      headline: `${side.season ?? ''} draft has ended`.trim(),
      detail: 'rosters are populated, but we did not capture the board',
      href: null,
    }
  }

  return { ...base, self, other, sides }
}
