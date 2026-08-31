/**
 * Stand a tournament up from leagues that are already imported.
 *
 * 🛑 WITHOUT THIS, THE HUB RENDERS AN EMPTY PAGE. The board, the export and the
 * manager linking all read `TournamentShell` → `TournamentConference` →
 * `TournamentLeague` → participants, and nothing in the app creates those rows
 * from leagues a commissioner already has. A twenty-league tournament with 240
 * managers is not something anybody is going to hand-enter, so the on-ramp is
 * the feature.
 *
 * ⚠ IT CREATES NOTHING ON ANY PLATFORM AND CHANGES NO LEAGUE. Every row it
 * writes is AllFantasy-side bookkeeping that says "these twenty leagues are one
 * tournament, and these are its conferences". The leagues themselves are read.
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { teamIdentity } from '@/lib/tournament/importedStandingsSource'
import { buildRoundScaffold } from '@/lib/tournament/roundScaffold'

export type ConferenceInput = {
  name: string
  /** `League.id` for each league in this conference, in display order. */
  leagueIds: string[]
}

export type ImportTournamentInput = {
  commissionerUserId: string
  name: string
  sport?: string
  /** First week of the opening round — `TournamentShell.openingWeekStart` is required. */
  openingWeekStart: number
  openingWeekEnd: number
  conferences: ConferenceInput[]
  /** Direct qualifiers per league. KBI cuts conference-wide, so this is 0 there. */
  advancersPerLeague?: number
  /** Conference-wide cut. KBI's "top 64 per conference" is this. */
  wildcardCount?: number
  bubbleEnabled?: boolean
  bubbleSize?: number
  /**
   * The rest of the calendar.
   *
   * 🛑 WITHOUT THESE THE TOURNAMENT HAS ONE ROUND AND DECLARES ITSELF COMPLETE
   * the moment the regular season advances — `executeAdvancement` marks a shell
   * `complete` when it finds no next play round. Optional because a commissioner
   * may not have decided the later weeks yet, but a tournament with none of them
   * cannot progress past its opening round.
   */
  bubbleWeek?: number | null
  redraftWeek?: number | null
  eliteRedraftWeek?: number | null
  championshipWeek?: number | null
}

export type ImportTournamentResult =
  | {
      ok: true
      tournamentId: string
      leagueCount: number
      participantCount: number
      /**
       * Leagues whose name had to be qualified to stay unique in the tournament.
       *
       * ⚠ REPORTED, NOT SILENT. A commissioner who sees "BEAST" in two
       * conferences and finds "BLACK BEAST" in the app should be told why rather
       * than left to wonder whether they mis-typed it.
       */
      renamedLeagues: Array<{ leagueId: string; from: string; to: string }>
      /** The calendar it laid out, so the caller can show what will happen. */
      rounds: Array<{ roundNumber: number; roundLabel: string; weekStart: number; weekEnd: number }>
      /** Teams with no manager on file — imported, but nobody to advance. */
      orphanTeamCount: number
    }
  | { ok: false; error: string; status: 400 | 404 | 409 }

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'league'
  )
}

export async function importTournamentFromLeagues(
  input: ImportTournamentInput,
): Promise<ImportTournamentResult> {
  const name = input.name?.trim()
  if (!name) return { ok: false, error: 'The tournament needs a name.', status: 400 }

  const conferences = (input.conferences ?? []).filter((c) => c?.name?.trim())
  if (conferences.length === 0) {
    return { ok: false, error: 'Add at least one conference.', status: 400 }
  }

  const allLeagueIds = conferences.flatMap((c) => c.leagueIds ?? [])
  if (allLeagueIds.length === 0) {
    return { ok: false, error: 'Add at least one league.', status: 400 }
  }

  /* ⚠ A league in two conferences would be scored in both and its managers
     ranked against two different cuts. Caught here rather than by a constraint,
     because the constraint's message names a column, not the mistake. */
  const seen = new Set<string>()
  for (const id of allLeagueIds) {
    if (seen.has(id)) {
      return { ok: false, error: 'The same league is listed in more than one conference.', status: 400 }
    }
    seen.add(id)
  }

  /*
   * ⚠ OWNERSHIP IS CHECKED IN THE QUERY. League ids arrive from a request, so
   * filtering afterwards would let someone build a tournament out of a
   * stranger's leagues and then read every roster in them through the board.
   */
  const leagues = await prisma.league.findMany({
    where: { id: { in: allLeagueIds }, userId: input.commissionerUserId },
    select: { id: true, name: true, sport: true },
  })
  if (leagues.length !== allLeagueIds.length) {
    /* Same answer for "not yours" and "does not exist" — a distinct 403 would
       confirm a league exists to someone who cannot see it. */
    return { ok: false, error: 'One or more of those leagues could not be found.', status: 404 }
  }
  const leagueById = new Map(leagues.map((l) => [l.id, l]))

  /*
   * 🛑 `TournamentLeague.leagueId` IS GLOBALLY UNIQUE. A league already in a
   * tournament cannot join a second one, and letting the constraint say so
   * produces an error naming a column rather than the league.
   */
  const alreadyUsed = await prisma.tournamentLeague.findMany({
    where: { leagueId: { in: allLeagueIds } },
    select: { leagueId: true },
  })
  if (alreadyUsed.length > 0) {
    const names = alreadyUsed
      .map((t) => leagueById.get(t.leagueId ?? '')?.name ?? t.leagueId)
      .join(', ')
    return { ok: false, error: `Already part of another tournament: ${names}`, status: 409 }
  }

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: { in: allLeagueIds } },
    select: {
      leagueId: true,
      externalId: true,
      platformUserId: true,
      ownerName: true,
      teamName: true,
      isOrphan: true,
    },
  })
  const teamsByLeague = new Map<string, typeof teams>()
  for (const t of teams) {
    const arr = teamsByLeague.get(t.leagueId) ?? []
    arr.push(t)
    teamsByLeague.set(t.leagueId, arr)
  }

  /*
   * 🛑 ONE MANAGER, ONE ENTRY — `@@unique([tournamentId, userId])` enforces it.
   * A manager who plays in two of the twenty leagues would be two participants
   * under one identity, and the insert fails halfway with a constraint error
   * that names neither the manager nor the leagues. Refusing up front and NAMING
   * them lets the commissioner decide which entry is the real one.
   */
  const identityOwner = new Map<string, { leagueId: string; label: string }>()
  const duplicates: string[] = []
  for (const t of teams) {
    const identity = t.platformUserId || teamIdentity(t.leagueId, t.externalId)
    const label = t.ownerName?.trim() || t.teamName?.trim() || t.externalId
    const prior = identityOwner.get(identity)
    if (prior) {
      const a = leagueById.get(prior.leagueId)?.name ?? prior.leagueId
      const b = leagueById.get(t.leagueId)?.name ?? t.leagueId
      duplicates.push(`${label} (${a} and ${b})`)
      continue
    }
    identityOwner.set(identity, { leagueId: t.leagueId, label })
  }
  if (duplicates.length > 0) {
    return {
      ok: false,
      error: `These managers appear in more than one league, so they cannot each have an entry: ${duplicates.join('; ')}`,
      status: 409,
    }
  }

  /*
   * ⚠ THE WHOLE CALENDAR, BUILT BEFORE ANYTHING IS WRITTEN. A scaffold that
   * cannot be laid out is a setup mistake — overlapping stages, a final before
   * the semis — and it is far cheaper to refuse here than to create a tournament
   * whose rounds run in an order nobody intended.
   */
  const scaffold = buildRoundScaffold({
    openingWeekStart: input.openingWeekStart,
    openingWeekEnd: input.openingWeekEnd,
    bubbleWeek: input.bubbleWeek ?? null,
    redraftWeek: input.redraftWeek ?? null,
    eliteRedraftWeek: input.eliteRedraftWeek ?? null,
    championshipWeek: input.championshipWeek ?? null,
  })
  if (!scaffold.ok) return { ok: false, error: scaffold.error, status: 400 }

  const tournamentId = randomUUID()
  const roundIdByNumber = new Map(scaffold.rounds.map((r) => [r.roundNumber, randomUUID()]))
  /* Round 1 is where the leagues being imported actually play. */
  const roundId = roundIdByNumber.get(1)!
  const sport = input.sport?.trim() || leagues[0]?.sport || 'NFL'

  /*
   * ⚠ THE SAME LEAGUE NAME IN TWO CONFERENCES IS THE NORMAL CASE, NOT AN EDGE
   * ONE. KBI runs BEAST, GOAT, GRIZZ… in BOTH Black and Gold — and
   * `@@unique([tournamentId, name])` rejects the second set. Qualifying the
   * duplicate with its conference keeps both, and the caller is told which were
   * changed so the rename is visible rather than mysterious.
   */
  const usedNames = new Set<string>()
  const usedSlugs = new Set<string>()
  const renamedLeagues: Array<{ leagueId: string; from: string; to: string }> = []

  const conferenceRows: Array<{ id: string; name: string; slug: string; conferenceNumber: number }> = []
  const leagueRows: Array<{
    id: string
    conferenceId: string
    leagueId: string
    name: string
    slug: string
    leagueNumber: number
    teamSlots: number
    currentTeamCount: number
  }> = []
  const participantRows: Array<{
    id: string
    tournamentId: string
    userId: string
    displayName: string
    currentConferenceId: string
    originalConferenceId: string
  }> = []
  const leagueParticipantRows: Array<{
    id: string
    tournamentLeagueId: string
    participantId: string
    userId: string
  }> = []

  let orphanTeamCount = 0
  let leagueNumber = 0

  conferences.forEach((conf, confIndex) => {
    const conferenceId = randomUUID()
    const confName = conf.name.trim()
    conferenceRows.push({
      id: conferenceId,
      name: confName,
      slug: slugify(confName),
      conferenceNumber: confIndex + 1,
    })

    for (const leagueId of conf.leagueIds) {
      const source = leagueById.get(leagueId)!
      const baseName = source.name?.trim() || 'League'
      let finalName = baseName
      if (usedNames.has(finalName.toLowerCase())) {
        finalName = `${confName} ${baseName}`
        renamedLeagues.push({ leagueId, from: baseName, to: finalName })
      }
      /* A qualified name can itself collide in a three-conference tournament;
         the numeric suffix is the last resort rather than the first move. */
      let attempt = 2
      while (usedNames.has(finalName.toLowerCase())) {
        finalName = `${confName} ${baseName} ${attempt++}`
      }
      usedNames.add(finalName.toLowerCase())

      let slug = slugify(finalName)
      let slugAttempt = 2
      while (usedSlugs.has(slug)) slug = `${slugify(finalName)}-${slugAttempt++}`
      usedSlugs.add(slug)

      const leagueTeams = teamsByLeague.get(leagueId) ?? []
      const tournamentLeagueId = randomUUID()
      leagueNumber += 1
      leagueRows.push({
        id: tournamentLeagueId,
        conferenceId,
        leagueId,
        name: finalName,
        slug,
        leagueNumber,
        teamSlots: leagueTeams.length,
        currentTeamCount: leagueTeams.length,
      })

      for (const t of leagueTeams) {
        /*
         * ⚠ AN ORPHAN TEAM STILL BECOMES A PARTICIPANT. It has a record and it
         * occupies a slot in the league, so leaving it out would shrink the
         * field the cut is measured against and quietly promote everyone below
         * it. It is counted and reported instead.
         */
        if (t.isOrphan) orphanTeamCount += 1
        const identity = t.platformUserId || teamIdentity(t.leagueId, t.externalId)
        const participantId = randomUUID()
        participantRows.push({
          id: participantId,
          tournamentId,
          userId: identity,
          displayName: t.ownerName?.trim() || t.teamName?.trim() || `Team ${t.externalId}`,
          currentConferenceId: conferenceId,
          originalConferenceId: conferenceId,
        })
        leagueParticipantRows.push({
          id: randomUUID(),
          tournamentLeagueId,
          participantId,
          userId: identity,
        })
      }
    }
  })

  /*
   * ⚠ ONE TRANSACTION. A half-built tournament — conferences with no leagues, or
   * leagues with no participants — reads on the board as a tournament where
   * everybody is unmatched, which is indistinguishable from a real data problem
   * and would send a commissioner hunting for the wrong bug.
   */
  await prisma.$transaction([
    prisma.tournamentShell.create({
      data: {
        id: tournamentId,
        name,
        sport,
        status: 'active',
        commissionerId: input.commissionerUserId,
        createdBy: input.commissionerUserId,
        conferenceCount: conferences.length,
        leaguesPerConference: Math.max(...conferences.map((c) => c.leagueIds.length)),
        teamsPerLeague: Math.max(1, ...leagueRows.map((l) => l.teamSlots)),
        maxParticipants: participantRows.length,
        currentParticipantCount: participantRows.length,
        currentRoundNumber: 1,
        totalRounds: scaffold.rounds.length,
        openingWeekStart: input.openingWeekStart,
        /* Stored on the shell too, because the engines read them from there
           rather than re-deriving the calendar from the rounds. */
        bubbleWeek: input.bubbleWeek ?? null,
        redraftWeek: input.redraftWeek ?? null,
        eliteRedraftWeek: input.eliteRedraftWeek ?? null,
        championshipWeek: input.championshipWeek ?? null,
        advancersPerLeague: input.advancersPerLeague ?? 0,
        wildcardCount: input.wildcardCount ?? 0,
        bubbleEnabled: input.bubbleEnabled ?? false,
        bubbleSize: input.bubbleSize ?? 0,
      },
    }),
    prisma.tournamentRound.createMany({
      data: scaffold.rounds.map((r) => ({
        id: roundIdByNumber.get(r.roundNumber)!,
        tournamentId,
        roundNumber: r.roundNumber,
        roundType: r.roundType,
        roundLabel: r.roundLabel,
        weekStart: r.weekStart,
        weekEnd: r.weekEnd,
        /* Only the opening round is under way; the rest are waiting their turn,
           and a round that claims to be active before it starts would be picked
           up as the current one. */
        status: r.roundNumber === 1 ? 'active' : 'pending',
      })),
    }),
    prisma.tournamentConference.createMany({
      data: conferenceRows.map((c) => ({ ...c, tournamentId })),
    }),
    prisma.tournamentLeague.createMany({
      data: leagueRows.map((l) => ({ ...l, tournamentId, roundId, status: 'active' })),
    }),
    prisma.tournamentParticipant.createMany({ data: participantRows }),
    prisma.tournamentLeagueParticipant.createMany({ data: leagueParticipantRows }),
    prisma.tournamentAuditLog.create({
      data: {
        tournamentId,
        roundNumber: 1,
        action: 'tournament.imported_from_leagues',
        actorType: 'commissioner',
        actorId: input.commissionerUserId,
        data: {
          leagueIds: allLeagueIds,
          conferenceCount: conferences.length,
          participantCount: participantRows.length,
          renamedLeagues,
        },
      },
    }),
  ])

  return {
    ok: true,
    tournamentId,
    leagueCount: leagueRows.length,
    participantCount: participantRows.length,
    renamedLeagues,
    rounds: scaffold.rounds.map((r) => ({
      roundNumber: r.roundNumber,
      roundLabel: r.roundLabel,
      weekStart: r.weekStart,
      weekEnd: r.weekEnd,
    })),
    orphanTeamCount,
  }
}
